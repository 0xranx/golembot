import { mkdtemp, rm } from 'node:fs/promises';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Assistant } from '../index.js';
import { createGolemServer, type GolemServer } from '../server.js';

/**
 * The server reads request bodies with readBody (src/server.ts:30-37), which
 * used to accumulate every chunk with no cap. Past V8's maximum string length
 * the `Buffer.concat(chunks).toString()` at the end of the stream throws
 * ERR_STRING_TOO_LONG inside the stream's 'end' callback — not inside the
 * promise the route awaits — so no route catch sees it and the process exits.
 *
 * These cases stay below that limit in size (17 MiB, not 512 MiB) because the
 * cap is what is under test: a body over MAX_BODY_BYTES must answer 413 at
 * once, and the process must stay up.
 */

const MAX_BODY_BYTES = 16 * 1024 * 1024;
const oversized = Buffer.alloc(MAX_BODY_BYTES + 1024 * 1024, 0x20); // 17 MiB of spaces

function createStubAssistant(): Assistant {
  return {
    chat: async () => ({ text: 'stub' }),
    streamChat: async function* () {},
    abort: () => {},
    cancel: async () => false,
    resetSession: async () => {},
    getStatus: async () => ({ engine: 'stub', model: 'stub' }),
  } as unknown as Assistant;
}

function send(
  server: GolemServer,
  method: string,
  path: string,
  body: Buffer,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const { port } = server.address() as { port: number };
    let settled = false;
    const done = (value: { status: number; body: string }) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path,
        method,
        headers: { 'Content-Type': 'application/json', 'Content-Length': body.length },
      },
      (res) => {
        let text = '';
        res.on('data', (c) => {
          text += c;
        });
        res.on('end', () => done({ status: res.statusCode ?? 0, body: text }));
      },
    );
    req.on('error', (err: NodeJS.ErrnoException) => {
      // The server answers 413 and drops the connection while the client is
      // still writing; a reset after that answer is not a test failure.
      if (settled || err.code === 'ECONNRESET' || err.code === 'EPIPE') return;
      reject(err);
    });
    req.end(body);
  });
}

describe('HTTP body size limit', () => {
  let dir: string;
  let server: GolemServer;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'golem-body-limit-'));
    server = createGolemServer(createStubAssistant(), {}, undefined, dir);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  });

  afterEach(async () => {
    if (server?.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
    server?.forceClose();
    await rm(dir, { recursive: true, force: true });
  });

  it('answers 413 to a body over the cap and keeps serving', async () => {
    const reply = await send(server, 'POST', '/chat', oversized);
    expect(reply.status).toBe(413);
    expect(JSON.parse(reply.body)).toEqual({ error: `Request body exceeds ${MAX_BODY_BYTES} bytes` });

    // The process is still up and the next request is read normally.
    const next = await send(server, 'POST', '/chat', Buffer.from('{"message":"hi"}'));
    expect(next.status).toBe(200);
  }, 15000);

  it('still parses a body under the cap', async () => {
    const reply = await send(server, 'POST', '/chat', Buffer.from('not json'));
    expect(reply.status).toBe(400);
    expect(JSON.parse(reply.body)).toEqual({ error: 'Invalid JSON body' });
  });

  it.each([
    ['POST', '/command'],
    ['POST', '/reset'],
    ['POST', '/abort'],
    ['PATCH', '/api/config'],
  ])(
    'answers 413 on %s %s',
    async (method, path) => {
      const reply = await send(server, method, path, oversized);
      expect(reply.status).toBe(413);
    },
    15000,
  );
});
