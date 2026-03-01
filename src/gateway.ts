import { resolve } from 'node:path';
import { createAssistant, type Assistant } from './index.js';
import { createGolemServer, type ServerOpts } from './server.js';
import { loadConfig, type GolemConfig, type ChannelsConfig } from './workspace.js';
import { buildSessionKey, stripMention, type ChannelAdapter, type ChannelMessage } from './channel.js';

// ── IM channel message limits ───────────────────────────
const CHANNEL_LIMITS: Record<string, number> = {
  feishu: 4000,
  dingtalk: 4000,
  wecom: 2048,
};

export function splitMessage(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > maxLen) {
    let splitIdx = remaining.lastIndexOf('\n\n', maxLen);
    if (splitIdx <= 0) splitIdx = remaining.lastIndexOf('\n', maxLen);
    if (splitIdx <= 0) splitIdx = remaining.lastIndexOf(' ', maxLen);
    if (splitIdx <= 0) splitIdx = maxLen;

    chunks.push(remaining.slice(0, splitIdx));
    remaining = remaining.slice(splitIdx).replace(/^\n+/, '');
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

interface GatewayOpts {
  dir?: string;
  port?: number;
  host?: string;
  token?: string;
  apiKey?: string;
  verbose?: boolean;
}

function log(verbose: boolean, ...args: unknown[]): void {
  if (verbose) console.log(...args);
}

async function createChannelAdapter(
  type: string,
  channelConfig: Record<string, unknown>,
): Promise<ChannelAdapter> {
  switch (type) {
    case 'feishu': {
      const { FeishuAdapter } = await import('./channels/feishu.js');
      return new FeishuAdapter(channelConfig as any);
    }
    case 'dingtalk': {
      const { DingtalkAdapter } = await import('./channels/dingtalk.js');
      return new DingtalkAdapter(channelConfig as any);
    }
    case 'wecom': {
      const { WecomAdapter } = await import('./channels/wecom.js');
      return new WecomAdapter(channelConfig as any);
    }
    default:
      throw new Error(`Unknown channel type: ${type}`);
  }
}

export async function startGateway(opts: GatewayOpts): Promise<void> {
  const dir = resolve(opts.dir || '.');
  const config: GolemConfig = await loadConfig(dir);
  const verbose = opts.verbose ?? false;

  const assistant: Assistant = createAssistant({ dir, apiKey: opts.apiKey });

  const gatewayConfig = config.gateway || {};
  const port = opts.port ?? gatewayConfig.port ?? 3000;
  const host = opts.host ?? gatewayConfig.host ?? '127.0.0.1';
  const token = opts.token ?? gatewayConfig.token;

  const serverOpts: ServerOpts = { port, token, hostname: host };
  const httpServer = createGolemServer(assistant, serverOpts);

  httpServer.listen(port, host, () => {
    const tokenStatus = token ? 'enabled' : 'disabled';
    console.log(`🤖 Golem Gateway started at http://${host}:${port}`);
    console.log(`   HTTP API: POST /chat, POST /reset, GET /health`);
    console.log(`   Auth: ${tokenStatus}`);
  });

  const adapters: ChannelAdapter[] = [];
  const channels: ChannelsConfig | undefined = config.channels;

  if (channels) {
    for (const [type, channelConfig] of Object.entries(channels)) {
      if (!channelConfig) continue;

      try {
        const adapter = await createChannelAdapter(type, channelConfig);
        await adapter.start(async (msg: ChannelMessage) => {
          const sessionKey = buildSessionKey(msg);
          const userText = msg.chatType === 'group' ? stripMention(msg.text) : msg.text;

          if (!userText) return;

          const prefix = msg.senderName ? `[user:${msg.senderName}] ` : '';
          const fullText = msg.chatType === 'group' ? `${prefix}${userText}` : userText;

          log(
            verbose,
            `[${type}] received from ${msg.senderName || msg.senderId}: "${userText}" → session ${sessionKey}`,
          );

          try {
            let reply = '';
            let hasError = false;
            for await (const event of assistant.chat(fullText, { sessionKey })) {
              if (event.type === 'text') {
                reply += event.content;
              } else if (event.type === 'warning') {
                log(verbose, `[${type}] warning: ${event.message}`);
              } else if (event.type === 'error') {
                hasError = true;
                console.error(`[${type}] Engine error: ${event.message}`);
              }
            }

            if (!reply.trim() && hasError) {
              reply = 'Sorry, an error occurred while processing your message. Please try again later.';
            }

            if (reply.trim()) {
              const maxLen = CHANNEL_LIMITS[type] ?? 4000;
              const chunks = splitMessage(reply.trim(), maxLen);
              for (const chunk of chunks) {
                await adapter.reply(msg, chunk);
              }
              log(verbose, `[${type}] replied to ${msg.senderName || msg.senderId}: "${reply.trim().slice(0, 80)}..." (${chunks.length} chunk(s))`);
            }
          } catch (e) {
            console.error(`[${type}] Failed to process message:`, e);
            try {
              await adapter.reply(msg, 'Sorry, an error occurred while processing your message. Please try again later.');
            } catch {
              // best effort
            }
          }
        });

        adapters.push(adapter);
        console.log(`   ✅ ${type} channel connected`);
      } catch (e) {
        console.error(`   ❌ ${type} channel failed to start: ${(e as Error).message}`);
      }
    }
  }

  if (adapters.length === 0 && !channels) {
    console.log(`   (no IM channels configured, HTTP API only)`);
  }

  const shutdown = async () => {
    console.log('\nShutting down Gateway...');
    for (const adapter of adapters) {
      try {
        await adapter.stop();
      } catch {
        // best effort
      }
    }
    httpServer.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
