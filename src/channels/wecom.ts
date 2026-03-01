import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { ChannelAdapter, ChannelMessage } from '../channel.js';
import type { WecomChannelConfig } from '../workspace.js';

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
  private config: WecomChannelConfig;
  private server: ReturnType<typeof createServer> | null = null;
  private accessToken: string = '';
  private tokenExpiresAt: number = 0;

  constructor(config: WecomChannelConfig) {
    this.config = config;
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
      wecomCrypto = await import('@wecom/crypto');
    } catch {
      throw new Error(
        'WeCom adapter requires @wecom/crypto. Install it: npm install @wecom/crypto',
      );
    }
    try {
      xml2js = await import('xml2js');
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

          if (msgXml.MsgType !== 'text') {
            res.writeHead(200);
            res.end('ok');
            return;
          }

          const channelMsg: ChannelMessage = {
            channelType: 'wecom',
            senderId: msgXml.FromUserName || '',
            chatId: msgXml.FromUserName || '',
            chatType: 'dm',
            text: msgXml.Content || '',
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

  async reply(msg: ChannelMessage, text: string): Promise<void> {
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
