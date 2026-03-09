import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { ChannelAdapter, ChannelMessage, ReplyOptions, ImageAttachment } from '../channel.js';
import type { WecomChannelConfig } from '../workspace.js';
import { importPeer } from '../peer-require.js';

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

export class WecomAdapter implements ChannelAdapter {
  readonly name = 'wecom';
  readonly maxMessageLength = 2048;
  private config: WecomChannelConfig;
  private server: ReturnType<typeof createServer> | null = null;
  private accessToken: string = '';
  private tokenExpiresAt: number = 0;

  private userNameCache = new Map<string, string>();
  private seenMsgIds = new Set<string>();
  private static readonly MAX_SEEN = 500;

  constructor(config: WecomChannelConfig) {
    this.config = config;
  }

  private async resolveUserName(userId: string): Promise<string | undefined> {
    const cached = this.userNameCache.get(userId);
    if (cached) return cached;
    try {
      const token = await this.getAccessToken();
      const res = await fetch(`https://qyapi.weixin.qq.com/cgi-bin/user/get?access_token=${token}&userid=${userId}`);
      const data = await res.json() as { name?: string; errcode?: number };
      if (data.name) this.userNameCache.set(userId, data.name);
      return data.name;
    } catch {
      return undefined;
    }
  }

  private async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiresAt) {
      return this.accessToken;
    }
    const url = `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${this.config.corpId}&corpsecret=${this.config.secret}`;
    const res = await fetch(url);
    const data = await res.json() as { access_token: string; expires_in: number; errcode?: number; errmsg?: string };
    if (data.errcode && data.errcode !== 0) {
      throw new Error(`WeCom getAccessToken failed: ${data.errmsg}`);
    }
    this.accessToken = data.access_token;
    this.tokenExpiresAt = Date.now() + (data.expires_in - 300) * 1000;
    return this.accessToken;
  }

  async start(onMessage: (msg: ChannelMessage) => void): Promise<void> {
    let wecomCrypto: any;
    let xml2js: any;
    try {
      wecomCrypto = await importPeer('@wecom/crypto');
    } catch {
      throw new Error(
        'WeCom adapter requires @wecom/crypto. Install it: npm install @wecom/crypto',
      );
    }
    try {
      xml2js = await importPeer('xml2js');
    } catch {
      throw new Error(
        'WeCom adapter requires xml2js. Install it: npm install xml2js',
      );
    }

    const { getSignature, decrypt } = wecomCrypto;

    this.server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

      if (!url.pathname.startsWith('/wecom')) {
        res.writeHead(404);
        res.end();
        return;
      }

      const msgSignature = url.searchParams.get('msg_signature') || '';
      const timestamp = url.searchParams.get('timestamp') || '';
      const nonce = url.searchParams.get('nonce') || '';

      if (req.method === 'GET') {
        const echostr = url.searchParams.get('echostr') || '';
        try {
          const signature = getSignature(this.config.token, timestamp, nonce, echostr);
          if (signature === msgSignature) {
            const { message } = decrypt(this.config.encodingAESKey, echostr);
            res.writeHead(200, { 'Content-Type': 'text/plain' });
            res.end(message);
          } else {
            res.writeHead(403);
            res.end('Signature mismatch');
          }
        } catch {
          res.writeHead(500);
          res.end('Verification failed');
        }
        return;
      }

      if (req.method === 'POST') {
        try {
          const body = await readBody(req);
          const parsed = await xml2js.parseStringPromise(body, { explicitArray: false });
          const xmlRoot = parsed.xml;
          const encryptedMsg = xmlRoot.Encrypt;

          const signature = getSignature(this.config.token, timestamp, nonce, encryptedMsg);
          if (signature !== msgSignature) {
            res.writeHead(403);
            res.end('Signature mismatch');
            return;
          }

          const { message } = decrypt(this.config.encodingAESKey, encryptedMsg);
          const msgParsed = await xml2js.parseStringPromise(message, { explicitArray: false });
          const msgXml = msgParsed.xml;

          const msgType = msgXml.MsgType;
          if (msgType !== 'text' && msgType !== 'image') {
            res.writeHead(200);
            res.end('ok');
            return;
          }

          // Deduplicate re-delivered webhooks.
          const msgId: string | undefined = msgXml.MsgId;
          if (msgId) {
            if (this.seenMsgIds.has(msgId)) {
              res.writeHead(200);
              res.end('ok');
              return;
            }
            this.seenMsgIds.add(msgId);
            if (this.seenMsgIds.size > WecomAdapter.MAX_SEEN) {
              const entries = [...this.seenMsgIds];
              this.seenMsgIds = new Set(entries.slice(entries.length >> 1));
            }
          }

          const senderId = msgXml.FromUserName || '';
          const senderName = await this.resolveUserName(senderId);

          let text = '';
          const images: ImageAttachment[] = [];

          if (msgType === 'text') {
            text = msgXml.Content || '';
          } else if (msgType === 'image') {
            // WeCom image message: download via media API
            const mediaId = msgXml.MediaId;
            if (mediaId) {
              try {
                const token = await this.getAccessToken();
                const mediaResp = await fetch(
                  `https://qyapi.weixin.qq.com/cgi-bin/media/get?access_token=${token}&media_id=${mediaId}`,
                );
                if (mediaResp.ok) {
                  const buf = Buffer.from(await mediaResp.arrayBuffer());
                  const ct = mediaResp.headers.get('content-type') || 'image/jpeg';
                  images.push({ mimeType: ct.split(';')[0], data: buf });
                }
              } catch (e) {
                console.error('[wecom] Failed to download image:', (e as Error).message);
              }
            }
            text = '(image)';
          }

          const channelMsg: ChannelMessage = {
            channelType: 'wecom',
            senderId,
            senderName,
            chatId: senderId,
            chatType: 'dm',
            text,
            images: images.length > 0 ? images : undefined,
            raw: msgXml,
          };

          onMessage(channelMsg);

          res.writeHead(200);
          res.end('ok');
        } catch (e) {
          console.error('[wecom] Failed to process message:', e);
          res.writeHead(500);
          res.end('Internal error');
        }
        return;
      }

      res.writeHead(405);
      res.end();
    });

    const port = this.config.port ?? 9000;
    this.server.listen(port, () => {
      console.log(`[wecom] Webhook server started on port ${port}, callback path: /wecom`);
    });
  }

  async reply(msg: ChannelMessage, text: string, options?: ReplyOptions): Promise<void> {
    const token = await this.getAccessToken();
    const url = `https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${token}`;
    const body = {
      touser: msg.senderId,
      msgtype: 'text',
      agentid: Number(this.config.agentId),
      text: { content: text },
    };
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => resolve());
      } else {
        resolve();
      }
    });
  }
}
