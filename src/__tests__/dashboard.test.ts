import { describe, it, expect } from 'vitest';
import {
  createMetrics,
  recordMessage,
  buildDashboardData,
  renderDashboard,
  type DashboardContext,
  type ChannelStatus,
  type RecentMessage,
  type GatewayMetrics,
} from '../dashboard.js';

function makeDashboardCtx(overrides?: Partial<DashboardContext>): DashboardContext {
  return {
    config: { name: 'test-bot', engine: 'claude-code', model: 'claude-opus-4-6', channels: {}, gateway: { port: 3000 } },
    skills: [{ name: 'general', path: '/skills/general', description: 'General assistant' }],
    channelStatuses: [
      { type: 'telegram', status: 'connected' },
      { type: 'slack', status: 'not_configured' },
      { type: 'feishu', status: 'failed', error: 'missing appId' },
    ],
    metrics: createMetrics(),
    startTime: Date.now() - 60_000,
    version: '1.2.3',
    ...overrides,
  };
}

describe('createMetrics', () => {
  it('returns zeroed metrics', () => {
    const m = createMetrics();
    expect(m.totalMessages).toBe(0);
    expect(m.totalCostUsd).toBe(0);
    expect(m.recentMessages).toHaveLength(0);
    expect(m.eventSubscribers.size).toBe(0);
  });
});

describe('recordMessage', () => {
  it('increments counters and adds to recentMessages', () => {
    const m = createMetrics();
    const msg: RecentMessage = {
      ts: new Date().toISOString(),
      source: 'telegram',
      sender: 'alice',
      messagePreview: 'hello',
      responsePreview: 'hi there',
      durationMs: 1500,
      costUsd: 0.01,
    };
    recordMessage(m, msg);
    expect(m.totalMessages).toBe(1);
    expect(m.totalCostUsd).toBeCloseTo(0.01);
    expect(m.totalDurationMs).toBe(1500);
    expect(m.messagesBySource['telegram']).toBe(1);
    expect(m.recentMessages).toHaveLength(1);
  });

  it('caps recentMessages at 100', () => {
    const m = createMetrics();
    for (let i = 0; i < 110; i++) {
      recordMessage(m, {
        ts: new Date().toISOString(),
        source: 'http',
        sender: 'user',
        messagePreview: `msg ${i}`,
        responsePreview: 'ok',
      });
    }
    expect(m.recentMessages).toHaveLength(100);
    expect(m.totalMessages).toBe(110);
  });

  it('records [PASS] messages', () => {
    const m = createMetrics();
    recordMessage(m, {
      ts: new Date().toISOString(),
      source: 'feishu',
      sender: 'bob',
      messagePreview: 'hey',
      responsePreview: '',
      passed: true,
    });
    expect(m.totalMessages).toBe(1);
    expect(m.recentMessages[0].passed).toBe(true);
  });
});

describe('buildDashboardData', () => {
  it('computes avgDurationMs correctly', async () => {
    const ctx = makeDashboardCtx();
    ctx.metrics.totalMessages = 4;
    ctx.metrics.totalDurationMs = 8000;
    const data = await buildDashboardData(ctx);
    expect(data.metrics.avgDurationMs).toBe(2000);
  });

  it('returns 0 avg when no messages', async () => {
    const data = await buildDashboardData(makeDashboardCtx());
    expect(data.metrics.avgDurationMs).toBe(0);
  });

  it('includes all fields', async () => {
    const data = await buildDashboardData(makeDashboardCtx());
    expect(data.name).toBe('test-bot');
    expect(data.engine).toBe('claude-code');
    expect(data.model).toBe('claude-opus-4-6');
    expect(data.version).toBe('1.2.3');
    expect(data.channels).toHaveLength(3);
    expect(data.skills).toHaveLength(1);
    expect(data.recentMessages).toEqual([]);
  });

  it('includes recentMessages snapshot', async () => {
    const ctx = makeDashboardCtx();
    recordMessage(ctx.metrics, {
      ts: '2026-01-01T00:00:00Z',
      source: 'http',
      sender: 'alice',
      messagePreview: 'hi',
      responsePreview: 'hello',
    });
    const data = await buildDashboardData(ctx);
    expect(data.recentMessages).toHaveLength(1);
    expect(data.recentMessages[0].sender).toBe('alice');
  });
});

describe('renderDashboard', () => {
  it('returns valid HTML with key elements', async () => {
    const data = await buildDashboardData(makeDashboardCtx());
    const html = renderDashboard(data);
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('GolemBot');
    expect(html).toContain('test-bot');
    expect(html).toContain('claude-code');
    expect(html).toContain('claude-opus-4-6');
    expect(html).toContain('v1.2.3');
  });

  it('shows connected channels with green dot', async () => {
    const data = await buildDashboardData(makeDashboardCtx());
    const html = renderDashboard(data);
    expect(html).toContain('dot-green');
    expect(html).toContain('Telegram');
  });

  it('shows failed channels with red dot and error', async () => {
    const data = await buildDashboardData(makeDashboardCtx());
    const html = renderDashboard(data);
    expect(html).toContain('dot-red');
    expect(html).toContain('missing appId');
  });

  it('shows unconfigured channels with setup guide link', async () => {
    const data = await buildDashboardData(makeDashboardCtx());
    const html = renderDashboard(data);
    expect(html).toContain('Setup Guide');
    expect(html).toContain('/channels/slack');
  });

  it('includes HTTP API curl example with highlighting', async () => {
    const data = await buildDashboardData(makeDashboardCtx());
    const html = renderDashboard(data);
    expect(html).toContain('POST /chat');
    expect(html).toContain('hl-cmd');
    expect(html).toContain('hl-str');
  });

  it('includes embed SDK code example', async () => {
    const data = await buildDashboardData(makeDashboardCtx());
    const html = renderDashboard(data);
    expect(html).toContain('createAssistant');
  });

  it('shows skills list', async () => {
    const data = await buildDashboardData(makeDashboardCtx());
    const html = renderDashboard(data);
    expect(html).toContain('general');
    expect(html).toContain('General assistant');
  });

  it('includes Quick Test section', async () => {
    const data = await buildDashboardData(makeDashboardCtx());
    const html = renderDashboard(data);
    expect(html).toContain('Quick Test');
    expect(html).toContain('test-msg');
    expect(html).toContain('sendTest');
  });

  it('shows step numbers on access method cards', async () => {
    const data = await buildDashboardData(makeDashboardCtx());
    const html = renderDashboard(data);
    expect(html).toContain('"step">1');
    expect(html).toContain('"step">2');
    expect(html).toContain('"step">3');
  });

  it('shows connected count in subtitle', async () => {
    const data = await buildDashboardData(makeDashboardCtx());
    const html = renderDashboard(data);
    expect(html).toContain('1 channel connected');
  });

  it('escapes HTML in bot name', async () => {
    const ctx = makeDashboardCtx();
    ctx.config.name = '<script>alert(1)</script>';
    const data = await buildDashboardData(ctx);
    const html = renderDashboard(data);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
