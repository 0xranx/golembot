import type { ChannelAdapter, ChannelMessage, ReplyOptions, ImageAttachment } from '../channel.js';
import type { DingtalkChannelConfig } from '../workspace.js';
import { importPeer } from '../peer-require.js';

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
      sdk = await importPeer('dingtalk-stream');
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
        const msgtype = data.msgtype;
        let text = '';
        const images: ImageAttachment[] = [];

        if (msgtype === 'text' || !msgtype) {
          text = data.text?.content?.trim() || '';
        } else if (msgtype === 'picture') {
          // DingTalk picture messages include a download URL
          const picURL = data.content?.downloadCode || data.content?.picURL;
          if (picURL) {
            try {
              const accessToken = await this.dwClient?.getAccessToken?.();
              const headers: Record<string, string> = {};
              if (accessToken) headers['x-acs-dingtalk-access-token'] = accessToken;
              const resp = await fetch(picURL, { headers });
              if (resp.ok) {
                const buf = Buffer.from(await resp.arrayBuffer());
                const ct = resp.headers.get('content-type') || 'image/jpeg';
                images.push({ mimeType: ct.split(';')[0], data: buf });
              }
            } catch (e) {
              console.error('[dingtalk] Failed to download image:', (e as Error).message);
            }
          }
          text = '(image)';
        } else if (msgtype === 'richText') {
          // Rich text may contain text + images
          const richText = data.content?.richText;
          if (Array.isArray(richText)) {
            for (const section of richText) {
              if (section.text) text += section.text;
              if (section.downloadCode || section.picURL) {
                const picURL = section.downloadCode || section.picURL;
                try {
                  const accessToken = await this.dwClient?.getAccessToken?.();
                  const headers: Record<string, string> = {};
                  if (accessToken) headers['x-acs-dingtalk-access-token'] = accessToken;
                  const resp = await fetch(picURL, { headers });
                  if (resp.ok) {
                    const buf = Buffer.from(await resp.arrayBuffer());
                    const ct = resp.headers.get('content-type') || 'image/jpeg';
                    images.push({ mimeType: ct.split(';')[0], data: buf });
                  }
                } catch (e) {
                  console.error('[dingtalk] Failed to download rich text image:', (e as Error).message);
                }
              }
            }
            text = text.trim();
            if (!text && images.length > 0) text = '(image)';
          }
        } else {
          // Unsupported message type — skip
          this.dwClient.socketCallBackResponse(res.headers.messageId, { status: 'SUCCESS' });
          return;
        }

        if (!text && images.length === 0) return;

        const isGroup = data.conversationType === '2';

        const channelMsg: ChannelMessage = {
          channelType: 'dingtalk',
          senderId: data.senderStaffId || data.senderId || '',
          senderName: data.senderNick,
          chatId: data.conversationId || '',
          chatType: isGroup ? 'group' : 'dm',
          text,
          images: images.length > 0 ? images : undefined,
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
