import type { ChannelAdapter, ChannelMessage, ReplyOptions } from '../channel.js';
import type { DingtalkChannelConfig } from '../workspace.js';

export class DingtalkAdapter implements ChannelAdapter {
  readonly name = 'dingtalk';
  readonly maxMessageLength = 4000;
  private config: DingtalkChannelConfig;
  private dwClient: any;
  private seenMsgIds = new Set<string>();
  private static readonly MAX_SEEN = 500;

  constructor(config: DingtalkChannelConfig) {
    this.config = config;
  }

  async start(onMessage: (msg: ChannelMessage) => void): Promise<void> {
    let sdk: any;
    try {
      sdk = await import('dingtalk-stream');
    } catch {
      throw new Error(
        'DingTalk adapter requires dingtalk-stream. Install it: npm install dingtalk-stream',
      );
    }

    const { DWClient, TOPIC_ROBOT } = sdk;

    this.dwClient = new DWClient({
      clientId: this.config.clientId,
      clientSecret: this.config.clientSecret,
    });

    this.dwClient.registerCallbackListener(
      TOPIC_ROBOT,
      async (res: any) => {
        // Deduplicate re-delivered events.
        const msgId: string | undefined = res.headers?.messageId || JSON.parse(res.data).msgId;
        if (msgId) {
          if (this.seenMsgIds.has(msgId)) {
            this.dwClient.socketCallBackResponse(res.headers.messageId, { status: 'SUCCESS' });
            return;
          }
          this.seenMsgIds.add(msgId);
          if (this.seenMsgIds.size > DingtalkAdapter.MAX_SEEN) {
            const entries = [...this.seenMsgIds];
            this.seenMsgIds = new Set(entries.slice(entries.length >> 1));
          }
        }

        const data = JSON.parse(res.data);
        const text = data.text?.content?.trim() || '';
        if (!text) return;

        const isGroup = data.conversationType === '2';

        const channelMsg: ChannelMessage = {
          channelType: 'dingtalk',
          senderId: data.senderStaffId || data.senderId || '',
          senderName: data.senderNick,
          chatId: data.conversationId || '',
          chatType: isGroup ? 'group' : 'dm',
          text,
          mentioned: isGroup ? true : undefined,
          raw: { ...data, _sessionWebhook: data.sessionWebhook },
        };

        onMessage(channelMsg);

        this.dwClient.socketCallBackResponse(res.headers.messageId, { status: 'SUCCESS' });
      },
    );

    await this.dwClient.connect();
    console.log(`[dingtalk] Stream connection established`);
  }

  async reply(msg: ChannelMessage, text: string, options?: ReplyOptions): Promise<void> {
    const raw = msg.raw as { _sessionWebhook?: string; senderStaffId?: string };
    const webhook = raw?._sessionWebhook;
    if (!webhook) return;

    const body = {
      msgtype: 'text',
      text: { content: text },
    };

    const accessToken = await this.dwClient?.getAccessToken?.();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (accessToken) {
      headers['x-acs-dingtalk-access-token'] = accessToken;
    }

    await fetch(webhook, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
  }

  async stop(): Promise<void> {
    this.dwClient = null;
  }
}
