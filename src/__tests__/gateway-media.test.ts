import { mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ChannelMessage } from '../channel.js';
import type { StreamEvent } from '../engine.js';
import type { GroupMessage } from '../gateway.js';
import type { GolemConfig } from '../workspace.js';

// ── extractMediaMarkers (pure helper) ──────────────────────────────────────────

describe('extractMediaMarkers', () => {
  let extractMediaMarkers: typeof import('../gateway.js').extractMediaMarkers;

  beforeEach(async () => {
    const mod = await import('../gateway.js');
    extractMediaMarkers = mod.extractMediaMarkers;
  });

  it('returns original text unchanged when no markers are present', () => {
    const result = extractMediaMarkers('hello world\nhow are you?');
    expect(result.body).toBe('hello world\nhow are you?');
    expect(result.markers).toEqual([]);
  });

  it('extracts and strips a single SEND_IMAGE marker', () => {
    const result = extractMediaMarkers('[SEND_IMAGE: /tmp/photo.png]');
    expect(result.body).toBe('');
    expect(result.markers).toEqual([{ kind: 'image', path: '/tmp/photo.png' }]);
  });

  it('extracts and strips a single SEND_FILE marker', () => {
    const result = extractMediaMarkers('[SEND_FILE: /tmp/report.pdf]');
    expect(result.body).toBe('');
    expect(result.markers).toEqual([{ kind: 'file', path: '/tmp/report.pdf' }]);
  });

  it('strips markers but preserves surrounding text', () => {
    const result = extractMediaMarkers('before text\n[SEND_IMAGE: img.png]\nafter text');
    expect(result.markers).toEqual([{ kind: 'image', path: 'img.png' }]);
    expect(result.body).toMatch(/before text/);
    expect(result.body).toMatch(/after text/);
    expect(result.body).not.toContain('[SEND_IMAGE:');
  });

  it('handles multiple markers in one reply', () => {
    const result = extractMediaMarkers(
      'start\n[SEND_IMAGE: a.png]\nmiddle\n[SEND_FILE: b.pdf]\n[SEND_IMAGE: c.jpg]\nend',
    );
    expect(result.markers).toEqual([
      { kind: 'image', path: 'a.png' },
      { kind: 'file', path: 'b.pdf' },
      { kind: 'image', path: 'c.jpg' },
    ]);
    expect(result.body).not.toContain('[SEND_IMAGE:');
    expect(result.body).not.toContain('[SEND_FILE:');
    expect(result.body).toMatch(/start/);
    expect(result.body).toMatch(/middle/);
    expect(result.body).toMatch(/end/);
  });

  it('trims whitespace around paths', () => {
    const result = extractMediaMarkers('[SEND_IMAGE:   /tmp/foo.png  ]');
    expect(result.markers).toEqual([{ kind: 'image', path: '/tmp/foo.png' }]);
  });

  it('normalises IMAGE/FILE case to lowercase in kind (case-insensitive match)', () => {
    const r1 = extractMediaMarkers('[SEND_image: x.png]');
    const r2 = extractMediaMarkers('[SEND_File: y.pdf]');
    expect(r1.markers).toHaveLength(1);
    expect(r1.markers[0].kind).toBe('image');
    expect(r2.markers).toHaveLength(1);
    expect(r2.markers[0].kind).toBe('file');
  });

  it('does NOT match markers that are not on standalone lines', () => {
    const text = 'I will send [SEND_IMAGE: x.png] inline here.';
    const result = extractMediaMarkers(text);
    expect(result.markers).toEqual([]);
    expect(result.body).toBe(text);
  });

  it('does NOT match malformed markers with missing path', () => {
    const text = '[SEND_IMAGE:]\n[SEND_FILE]\n[SEND_IMAGE]';
    const result = extractMediaMarkers(text);
    expect(result.markers).toEqual([]);
    expect(result.body).toBe(text);
  });

  it('returns empty body and empty markers for empty input', () => {
    const result = extractMediaMarkers('');
    expect(result.body).toBe('');
    expect(result.markers).toEqual([]);
  });

  it('does NOT match marker with trailing content on same line', () => {
    const result = extractMediaMarkers('some [SEND_IMAGE: x.png] trailing text');
    expect(result.markers).toEqual([]);
  });

  it('is idempotent - second call on stripped body yields no markers', () => {
    const first = extractMediaMarkers('hello\n[SEND_IMAGE: x.png]\nworld');
    expect(first.markers).toHaveLength(1);
    const second = extractMediaMarkers(first.body);
    expect(second.markers).toEqual([]);
    expect(second.body).toBe(first.body);
  });
});

// ── resolveOutboundPath (path security helper) ─────────────────────────────────

describe('resolveOutboundPath', () => {
  let resolveOutboundPath: typeof import('../gateway.js').resolveOutboundPath;
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'golem-rp-'));
    const mod = await import('../gateway.js');
    resolveOutboundPath = mod.resolveOutboundPath;
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('resolves a relative path inside the base directory', async () => {
    const result = await resolveOutboundPath(dir, 'foo/bar.txt');
    expect(result).not.toBeNull();
  });

  it('rejects a relative path that escapes via ../', async () => {
    const result = await resolveOutboundPath(dir, '../../../etc/passwd');
    expect(result).toBeNull();
  });

  it('rejects a relative path that escapes via .. after valid prefix', async () => {
    const result = await resolveOutboundPath(dir, 'subdir/../../../etc/passwd');
    expect(result).toBeNull();
  });

  it('rejects an absolute path outside the base directory', async () => {
    const result = await resolveOutboundPath(dir, '/etc/passwd');
    expect(result).toBeNull();
  });

  it('accepts an absolute path that stays inside the base directory', async () => {
    const absInside = resolve(dir, 'inside.txt');
    const result = await resolveOutboundPath(dir, absInside);
    expect(result).not.toBeNull();
  });

  it('resolves through realpath when the file exists (symlink to inside)', async () => {
    const realFile = join(dir, 'real.txt');
    await writeFile(realFile, 'hello');
    const linkFile = join(dir, 'link.txt');
    await symlink(realFile, linkFile);
    const result = await resolveOutboundPath(dir, 'link.txt');
    expect(result).not.toBeNull();
  });

  it('rejects a symlink that points outside the base directory', async () => {
    const outsideTarget = join(tmpdir(), 'outside.txt');
    await writeFile(outsideTarget, 'secret');
    const linkFile = join(dir, 'escape-link.txt');
    await symlink(outsideTarget, linkFile);
    const result = await resolveOutboundPath(dir, 'escape-link.txt');
    expect(result).toBeNull();
  });

  it('returns candidate path when file does not exist (no realpath)', async () => {
    const result = await resolveOutboundPath(dir, 'nonexistent.png');
    expect(result).not.toBeNull();
  });

  it('rejects a path inside the OS temp directory', async () => {
    const tempFile = join(tmpdir(), 'golem-gen-image.png');
    await writeFile(tempFile, 'tmp-data');
    try {
      const result = await resolveOutboundPath(dir, tempFile);
      expect(result).toBeNull();
    } finally {
      await rm(tempFile, { force: true });
    }
  });

  it('accepts a relative temp dir path resolved against baseDir (still inside baseDir)', async () => {
    const result = await resolveOutboundPath(dir, 'still-inside.png');
    expect(result).not.toBeNull();
  });

  it('rejects an absolute path inside the OS temp directory (different file)', async () => {
    const tmpFile = join(tmpdir(), 'gen-abs-only-in-tmp.png');
    await writeFile(tmpFile, 'tmp-content');
    try {
      const result = await resolveOutboundPath(dir, tmpFile);
      expect(result).toBeNull();
    } finally {
      await rm(tmpFile, { force: true });
    }
  });

  it('resolves a relative filename that exists only in the assistant dir', async () => {
    const baseFile = join(dir, 'gen-only-in-base.png');
    await writeFile(baseFile, 'base-content');
    try {
      const result = await resolveOutboundPath(dir, 'gen-only-in-base.png');
      expect(result).not.toBeNull();
      expect(result).toBe(await realpath(baseFile));
    } finally {
      await rm(baseFile, { force: true });
    }
  });

  it('still rejects /etc/passwd (outside all allowed roots)', async () => {
    const result = await resolveOutboundPath(dir, '/etc/passwd');
    expect(result).toBeNull();
  });

  it('still rejects path that escapes via ../', async () => {
    const result = await resolveOutboundPath(dir, '../../../etc/passwd');
    expect(result).toBeNull();
  });

  it('rejects a file under POSIX /tmp (or /private/tmp on macOS)', async () => {
    let tmpRoot = '/private/tmp';
    try {
      await writeFile(join(tmpRoot, 'golem-posix-tmp-file.png'), 'posix-tmp-data');
    } catch {
      tmpRoot = '/tmp';
      await writeFile(join(tmpRoot, 'golem-posix-tmp-file.png'), 'posix-tmp-data');
    }
    const tmpFile = join(tmpRoot, 'golem-posix-tmp-file.png');
    try {
      const result = await resolveOutboundPath(dir, tmpFile);
      expect(result).toBeNull();
    } finally {
      await rm(tmpFile, { force: true });
    }
  });

  it('rejects an absolute path under /private/tmp (different root, file exists)', async () => {
    const tmpFile = join('/private/tmp', 'golem-abs-posix-tmp.png');
    const created = await writeFile(tmpFile, 'posix-abs-data').then(
      () => true,
      () => false,
    );
    try {
      const result = await resolveOutboundPath(dir, tmpFile);
      expect(result).toBeNull();
    } finally {
      if (created) await rm(tmpFile, { force: true });
    }
  });
});

// ── Gateway handleMessage media integration ────────────────────────────────────

const mockAssistantStubs = {
  setEngine(_e: string) {},
  setModel(_m: string) {},
  async getStatus() {
    return {
      config: { name: 'test', engine: 'mock' } as any,
      skills: [] as never[],
      engine: 'mock',
      model: undefined,
    };
  },
  async cancel(_k?: string) {
    return true;
  },
  async resetSession(_k?: string) {},
  async listModels() {
    return ['mock-model-1', 'mock-model-2'];
  },
};

type MockAssistant = {
  chat(message: string, opts?: { sessionKey?: string }): AsyncIterable<StreamEvent>;
  setEngine(engine: string): void;
  setModel(model: string): void;
  getStatus(): Promise<{
    config: { name: string; engine: string };
    skills: never[];
    engine: string;
    model: string | undefined;
  }>;
  cancel(sessionKey?: string): Promise<boolean>;
  resetSession(sessionKey?: string): Promise<void>;
  listModels(): Promise<string[]>;
  callCount: number;
  lastSessionKey: string | undefined;
  lastPrompt: string | undefined;
};

function makeMockAssistant(replyText: string): MockAssistant {
  const obj: MockAssistant = {
    ...mockAssistantStubs,
    callCount: 0,
    lastSessionKey: undefined,
    lastPrompt: undefined,
    async *chat(message: string, opts: { sessionKey?: string } = {}) {
      obj.callCount++;
      obj.lastPrompt = message;
      obj.lastSessionKey = opts.sessionKey;
      yield { type: 'text' as const, content: replyText };
      yield { type: 'done' as const, sessionId: 'mock-sid' };
    },
  };
  return obj;
}

/** Scripted mock: returns next script on each chat call (last script repeats). */
function makeScriptedAssistant(scripts: string[]): MockAssistant {
  const obj: MockAssistant = {
    ...mockAssistantStubs,
    callCount: 0,
    lastSessionKey: undefined,
    lastPrompt: undefined,
    async *chat(message: string, opts: { sessionKey?: string } = {}) {
      const idx = obj.callCount++;
      obj.lastPrompt = message;
      obj.lastSessionKey = opts.sessionKey;
      yield { type: 'text' as const, content: scripts[Math.min(idx, scripts.length - 1)] };
      yield { type: 'done' as const, sessionId: 'mock-sid' };
    },
  };
  return obj;
}

/** Streaming mock assistant that yields events in sequence. */
function makeStreamingMockAssistant(events: StreamEvent[]): MockAssistant {
  const obj: MockAssistant = {
    ...mockAssistantStubs,
    callCount: 0,
    lastSessionKey: undefined,
    lastPrompt: undefined,
    async *chat(message: string, opts: { sessionKey?: string } = {}) {
      obj.callCount++;
      obj.lastPrompt = message;
      obj.lastSessionKey = opts.sessionKey;
      for (const e of events) {
        yield e;
      }
    },
  };
  return obj;
}

type MockAdapter = {
  replies: Array<{ msg: ChannelMessage; text: string }>;
  mediaSends: Array<{
    msg: ChannelMessage;
    kind: 'image' | 'file';
    fileName?: string;
    size: number;
  }>;
  reply(msg: ChannelMessage, text: string): Promise<void>;
  sendMedia?: (
    msg: ChannelMessage,
    media: { kind: 'image' | 'file'; data: Buffer; fileName?: string },
  ) => Promise<void>;
};

function makeMockAdapter(withSendMedia: boolean): MockAdapter {
  const obj: MockAdapter = {
    replies: [],
    mediaSends: [],
    async reply(_msg: ChannelMessage, text: string) {
      obj.replies.push({ msg: _msg, text });
    },
  };
  if (withSendMedia) {
    obj.sendMedia = async (msg: ChannelMessage, media) => {
      obj.mediaSends.push({
        msg,
        kind: media.kind,
        fileName: media.fileName,
        size: media.data.length,
      });
    };
  }
  return obj;
}

function makeConfig(overrides: Partial<GolemConfig> = {}): GolemConfig {
  return { name: 'golem', engine: 'cursor', ...overrides } as GolemConfig;
}

function makeDmMsg(overrides: Partial<ChannelMessage> = {}): ChannelMessage {
  return {
    channelType: 'slack',
    senderId: 'U001',
    senderName: 'alice',
    chatId: 'C001',
    chatType: 'dm',
    text: 'hello',
    raw: {},
    ...overrides,
  };
}

describe('handleMessage - media marker integration', () => {
  let dir: string;
  let handleMessage: typeof import('../gateway.js').handleMessage;
  let groupHistories: Map<string, Array<{ senderName: string; text: string; isBot: boolean }>>;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'golem-mt-'));
    const mod = await import('../gateway.js');
    handleMessage = mod.handleMessage;
    groupHistories = mod.groupHistories;
    // Clear group histories between tests to avoid cross-test pollution
    groupHistories.clear();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('sends image via adapter.sendMedia and strips marker from text reply', async () => {
    const imagePath = join(dir, 'test-image.png');
    await writeFile(imagePath, Buffer.from('fake-png-data'));

    const assistant = makeMockAssistant('Here is the chart:\n[SEND_IMAGE: test-image.png]\nLooks good?');
    const adapter = makeMockAdapter(true);

    await handleMessage(makeDmMsg(), makeConfig(), assistant, adapter, 'slack', false, dir);

    const allText = adapter.replies.map((r) => r.text).join('\n');
    expect(allText).toContain('Here is the chart:');
    expect(allText).toContain('Looks good?');
    expect(allText).not.toContain('[SEND_IMAGE:');

    expect(adapter.mediaSends).toHaveLength(1);
    expect(adapter.mediaSends[0].kind).toBe('image');
    expect(adapter.mediaSends[0].fileName).toBe('test-image.png');
    expect(adapter.mediaSends[0].size).toBe(13);
  });

  it('sends file via adapter.sendMedia with correct kind', async () => {
    const filePath = join(dir, 'report.pdf');
    await writeFile(filePath, Buffer.from('pdf-content'));

    const assistant = makeMockAssistant('Here is the report:\n[SEND_FILE: report.pdf]');
    const adapter = makeMockAdapter(true);

    await handleMessage(makeDmMsg(), makeConfig(), assistant, adapter, 'slack', false, dir);

    expect(adapter.mediaSends).toHaveLength(1);
    expect(adapter.mediaSends[0].kind).toBe('file');
    expect(adapter.mediaSends[0].fileName).toBe('report.pdf');
    const allText = adapter.replies.map((r) => r.text).join('\n');
    expect(allText).toContain('Here is the report:');
  });

  it('gracefully skips when adapter lacks sendMedia (strips marker, no error)', async () => {
    const imagePath = join(dir, 'x.png');
    await writeFile(imagePath, 'data');

    const assistant = makeMockAssistant('text\n[SEND_IMAGE: x.png]\nmore');
    const adapter = makeMockAdapter(false);

    await handleMessage(makeDmMsg(), makeConfig(), assistant, adapter, 'slack', false, dir);

    const allText = adapter.replies.map((r) => r.text).join('\n');
    expect(allText).toContain('text');
    expect(allText).toContain('more');
    expect(allText).not.toContain('[SEND_IMAGE:');
    expect(adapter.mediaSends).toHaveLength(0);
  });

  it('sends error notice when file is missing', async () => {
    const assistant = makeMockAssistant('text\n[SEND_IMAGE: nonexistent.png]\nmore');
    const adapter = makeMockAdapter(true);

    await handleMessage(makeDmMsg(), makeConfig(), assistant, adapter, 'slack', false, dir);

    expect(adapter.replies.some((r) => r.text.includes('无法发送'))).toBe(true);
    expect(adapter.replies.some((r) => r.text.includes('nonexistent.png'))).toBe(true);
    expect(adapter.mediaSends).toHaveLength(0);
  });

  it('sends error notice when image exceeds 10MB limit', async () => {
    const bigPath = join(dir, 'big.png');
    await writeFile(bigPath, Buffer.alloc(11 * 1024 * 1024));

    const assistant = makeMockAssistant('[SEND_IMAGE: big.png]');
    const adapter = makeMockAdapter(true);

    await handleMessage(makeDmMsg(), makeConfig(), assistant, adapter, 'slack', false, dir);

    expect(adapter.replies.some((r) => r.text.includes('10MB'))).toBe(true);
    expect(adapter.mediaSends).toHaveLength(0);
  });

  it('sends error notice when file exceeds 20MB limit', async () => {
    const bigPath = join(dir, 'big.bin');
    await writeFile(bigPath, Buffer.alloc(21 * 1024 * 1024));

    const assistant = makeMockAssistant('[SEND_FILE: big.bin]');
    const adapter = makeMockAdapter(true);

    await handleMessage(makeDmMsg(), makeConfig(), assistant, adapter, 'slack', false, dir);

    expect(adapter.replies.some((r) => r.text.includes('20MB'))).toBe(true);
    expect(adapter.mediaSends).toHaveLength(0);
  });

  it('sends error notice when path escapes assistant directory', async () => {
    const assistant = makeMockAssistant('[SEND_FILE: ../../../etc/passwd]');
    const adapter = makeMockAdapter(true);

    await handleMessage(makeDmMsg(), makeConfig(), assistant, adapter, 'slack', false, dir);

    expect(adapter.replies.some((r) => r.text.includes('路径超出助手目录范围'))).toBe(true);
    expect(adapter.mediaSends).toHaveLength(0);
  });

  it('handles multiple media markers in one reply', async () => {
    const imgPath = join(dir, 'a.png');
    const filePath = join(dir, 'b.pdf');
    await writeFile(imgPath, 'img-data');
    await writeFile(filePath, 'file-data');

    const assistant = makeMockAssistant('intro\n[SEND_IMAGE: a.png]\nmid\n[SEND_FILE: b.pdf]\noutro');
    const adapter = makeMockAdapter(true);

    await handleMessage(makeDmMsg(), makeConfig(), assistant, adapter, 'slack', false, dir);

    expect(adapter.mediaSends).toHaveLength(2);
    expect(adapter.mediaSends[0].kind).toBe('image');
    expect(adapter.mediaSends[1].kind).toBe('file');
    const allText = adapter.replies.map((r) => r.text).join('\n');
    expect(allText).not.toContain('[SEND_IMAGE:');
    expect(allText).not.toContain('[SEND_FILE:');
    expect(allText).toContain('intro');
    expect(allText).toContain('mid');
    expect(allText).toContain('outro');
  });

  it('does NOT treat inline [SEND_IMAGE: ...] as a marker', async () => {
    const assistant = makeMockAssistant('I will use [SEND_IMAGE: x.png] to explain.');
    const adapter = makeMockAdapter(true);

    await handleMessage(makeDmMsg(), makeConfig(), assistant, adapter, 'slack', false, dir);

    expect(adapter.replies[0].text).toContain('[SEND_IMAGE: x.png]');
    expect(adapter.mediaSends).toHaveLength(0);
  });

  it('media failure does not break the text reply', async () => {
    const goodImg = join(dir, 'good.png');
    await writeFile(goodImg, 'good-data');

    const assistant = makeMockAssistant('start\n[SEND_IMAGE: good.png]\n[SEND_FILE: ../../../etc/passwd]\nend');
    const adapter = makeMockAdapter(true);

    await handleMessage(makeDmMsg(), makeConfig(), assistant, adapter, 'slack', false, dir);

    expect(adapter.mediaSends).toHaveLength(1);
    expect(adapter.mediaSends[0].fileName).toBe('good.png');
    expect(adapter.replies.some((r) => r.text.includes('路径超出助手目录范围'))).toBe(true);
  });

  it('handles a reply consisting only of media markers (no text body)', async () => {
    const img = join(dir, 'only.png');
    await writeFile(img, 'data');

    const assistant = makeMockAssistant('[SEND_IMAGE: only.png]');
    const adapter = makeMockAdapter(true);

    await handleMessage(makeDmMsg(), makeConfig(), assistant, adapter, 'slack', false, dir);

    expect(adapter.mediaSends).toHaveLength(1);
  });

  it('handles buffered mode with media markers', async () => {
    const img = join(dir, 'buf.png');
    await writeFile(img, 'buf-data');

    const assistant = makeMockAssistant('Result:\n[SEND_IMAGE: buf.png]');
    const adapter = makeMockAdapter(true);

    await handleMessage(makeDmMsg(), makeConfig(), assistant, adapter, 'slack', false, dir);

    expect(adapter.mediaSends).toHaveLength(1);
    const allText = adapter.replies.map((r) => r.text).join('\n');
    expect(allText).toContain('Result:');
  });

  it('handles streaming mode with media markers', async () => {
    const img = join(dir, 'stream.png');
    await writeFile(img, 'stream-data');

    const assistant = makeStreamingMockAssistant([
      { type: 'text', content: 'First part.\n\n' },
      { type: 'text', content: '[SEND_IMAGE: stream.png]\n\n' },
      { type: 'text', content: 'Last part.' },
      { type: 'done', sessionId: 'x' },
    ]);
    const adapter = makeMockAdapter(true);
    const config = makeConfig({ streaming: { mode: 'streaming' } } as any);

    await handleMessage(makeDmMsg(), config, assistant, adapter, 'slack', false, dir);

    expect(adapter.mediaSends).toHaveLength(1);
    expect(adapter.mediaSends[0].kind).toBe('image');
    const allText = adapter.replies.map((r) => r.text).join('\n');
    expect(allText).toContain('First part.');
    expect(allText).toContain('Last part.');
    expect(allText).not.toContain('[SEND_IMAGE:');
  });

  it('sendMedia error is caught and reported without breaking the pipeline', async () => {
    const img = join(dir, 'err.png');
    await writeFile(img, 'data');

    const assistant = makeMockAssistant('text\n[SEND_IMAGE: err.png]\nmore');
    const adapter = makeMockAdapter(true);
    adapter.sendMedia = async () => {
      throw new Error('upload rejected');
    };

    await handleMessage(makeDmMsg(), makeConfig(), assistant, adapter, 'slack', false, dir);

    expect(adapter.replies.some((r) => r.text.includes('upload rejected'))).toBe(true);
    const allText = adapter.replies.map((r) => r.text).join('\n');
    expect(allText).toContain('text');
    expect(allText).toContain('more');
  });

  it('interaction with [CONTINUE]: only sends media once, sentinel stripped', async () => {
    const img = join(dir, 'cont.png');
    await writeFile(img, 'data');

    // First call returns [CONTINUE], second call returns plain text
    const assistant = makeScriptedAssistant(['Working\n[SEND_IMAGE: cont.png]\n[CONTINUE]', 'All done.']);
    const adapter = makeMockAdapter(true);

    await handleMessage(makeDmMsg(), makeConfig(), assistant, adapter, 'slack', false, dir);

    // Media sent only once (not re-sent on each auto-continue relay round)
    expect(adapter.mediaSends).toHaveLength(1);
    expect(adapter.mediaSends[0].fileName).toBe('cont.png');
    const allText = adapter.replies.map((r) => r.text).join('\n');
    expect(allText).not.toContain('[CONTINUE]');
    expect(allText).not.toContain('[SEND_IMAGE:');
    expect(allText).toContain('Working');
    expect(allText).toContain('All done.');
  });

  it('does NOT leak media markers into group conversation history', async () => {
    const img = join(dir, 'group_img.png');
    await writeFile(img, 'group-data');

    const assistant = makeMockAssistant('Hello team!\n[SEND_IMAGE: group_img.png]\nHow is everyone?');
    const adapter = makeMockAdapter(true);

    const groupMsg = makeDmMsg({ chatType: 'group', chatId: 'G001', text: '@golem hello' });
    await handleMessage(groupMsg, makeConfig(), assistant, adapter, 'slack', false, dir);

    // Group history must not contain media marker lines
    const key = `${groupMsg.channelType}:${groupMsg.chatId}`;
    const hist = groupHistories.get(key);
    expect(hist).toBeDefined();
    expect(hist!.length).toBeGreaterThan(0);
    const botText = hist!.find((m) => m.isBot)?.text ?? '';
    expect(botText).not.toContain('[SEND_IMAGE:');
    expect(botText).not.toContain('[SEND_FILE:');
    expect(botText).toContain('Hello team!');
    expect(botText).toContain('How is everyone?');
  });

  it('streaming mode with [CONTINUE] + media: marker and CONTINUE stripped, media sent once', async () => {
    const img = join(dir, 'cont_s.png');
    await writeFile(img, 'sdata');

    const assistant = makeStreamingMockAssistant([
      { type: 'text', content: 'Working\n' },
      { type: 'text', content: '[SEND_IMAGE: cont_s.png]\n' },
      { type: 'text', content: '[CONTINUE]\n' },
      { type: 'done', sessionId: 'x' },
    ]);
    const adapter = makeMockAdapter(true);
    // Disable auto-continue so the relay loop does not re-invoke the mock
    const config = makeConfig({ streaming: { mode: 'streaming' }, autoContinue: 0 } as any);

    await handleMessage(makeDmMsg(), config, assistant, adapter, 'slack', false, dir);

    expect(adapter.mediaSends).toHaveLength(1);
    expect(adapter.mediaSends[0].kind).toBe('image');
    const allText = adapter.replies.map((r) => r.text).join('\n');
    expect(allText).not.toContain('[SEND_IMAGE:');
    expect(allText).not.toContain('[CONTINUE]');
    expect(allText).toContain('Working');
  });
});

// ── MEDIA_MARKER_RE export ─────────────────────────────────────────────────────

describe('MEDIA_MARKER_RE', () => {
  let MEDIA_MARKER_RE: RegExp;

  beforeEach(async () => {
    const mod = await import('../gateway.js');
    MEDIA_MARKER_RE = mod.MEDIA_MARKER_RE;
  });

  /** Helper: test regex with fresh lastIndex to avoid global-flag state bleed. */
  function testRe(text: string): boolean {
    const re = new RegExp(MEDIA_MARKER_RE.source, MEDIA_MARKER_RE.flags);
    return re.test(text);
  }

  it('matches a standalone SEND_IMAGE line', () => {
    expect(testRe('[SEND_IMAGE: /tmp/photo.png]')).toBe(true);
  });

  it('matches a standalone SEND_FILE line', () => {
    expect(testRe('[SEND_FILE: /tmp/report.pdf]')).toBe(true);
  });

  it('does not match inline sentinel in a sentence', () => {
    expect(testRe('I will [SEND_IMAGE: x.png] now.')).toBe(false);
  });

  it('does not match sentinel without a path', () => {
    expect(testRe('[SEND_IMAGE:]')).toBe(false);
    expect(testRe('[SEND_FILE]')).toBe(false);
  });

  it('global flag finds multiple matches', () => {
    const re = new RegExp(MEDIA_MARKER_RE.source, MEDIA_MARKER_RE.flags);
    const text = '[SEND_IMAGE: a.png]\nmiddle\n[SEND_FILE: b.pdf]';
    const matches = Array.from(text.matchAll(re));
    expect(matches).toHaveLength(2);
    expect(matches[0][1]).toBe('IMAGE');
    expect(matches[1][1]).toBe('FILE');
  });
});

// ── buildGroupPrompt injects MEDIA_PROTOCOL_HINT ──────────────────────────────

describe('buildGroupPrompt - MEDIA_PROTOCOL_HINT', () => {
  let buildGroupPrompt: typeof import('../gateway.js').buildGroupPrompt;
  let MEDIA_PROTOCOL_HINT: string;

  beforeEach(async () => {
    const mod = await import('../gateway.js');
    buildGroupPrompt = mod.buildGroupPrompt;
    MEDIA_PROTOCOL_HINT = mod.MEDIA_PROTOCOL_HINT;
  });

  it('includes MEDIA_PROTOCOL_HINT in group prompt output', () => {
    const history: GroupMessage[] = [];
    const prompt = buildGroupPrompt(
      history,
      'alice',
      'send me a chart',
      false, // injectPass
      'slack-C001',
      '/assistant',
    );

    expect(prompt).toContain('[SEND_IMAGE:');
    expect(prompt).toContain(MEDIA_PROTOCOL_HINT);
  });

  it('includes MEDIA_PROTOCOL_HINT even with continue/pass/peers injected', () => {
    const history: GroupMessage[] = [
      { senderName: 'alice', text: 'hello', isBot: false },
      { senderName: 'bob', text: 'hi there', isBot: false },
    ];
    const prompt = buildGroupPrompt(
      history,
      'alice',
      'send the report',
      true, // injectPass
      'slack-C001',
      '/assistant',
      ['bob'], // othersAddressed
      [{ name: 'peer-bot', role: 'reviewer' }], // peers
      true, // injectContinue
    );

    expect(prompt).toContain('[SEND_IMAGE:');
    expect(prompt).toContain(MEDIA_PROTOCOL_HINT);
    expect(prompt).toContain('[CONTINUE]');
  });
});
