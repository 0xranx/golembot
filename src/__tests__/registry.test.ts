import { describe, it, expect } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { getRegistry, listRegistries, ClawHubRegistry } from '../registry.js';

// ---------------------------------------------------------------------------
// Registry factory (pure, no network)
// ---------------------------------------------------------------------------

describe('registry factory', () => {
  it('returns ClawHubRegistry for "clawhub"', () => {
    const r = getRegistry('clawhub');
    expect(r).toBeDefined();
    expect(r!.name).toBe('clawhub');
  });

  it('returns undefined for unknown registry', () => {
    expect(getRegistry('nonexistent')).toBeUndefined();
  });

  it('lists available registries', () => {
    const names = listRegistries();
    expect(names).toContain('clawhub');
  });
});

// ---------------------------------------------------------------------------
// ClawHubRegistry (unit tests, no network)
// ---------------------------------------------------------------------------

describe('ClawHubRegistry', () => {
  it('isAvailable returns boolean', () => {
    const r = new ClawHubRegistry();
    expect(typeof r.isAvailable()).toBe('boolean');
  });

  it('name is "clawhub"', () => {
    const r = new ClawHubRegistry();
    expect(r.name).toBe('clawhub');
  });
});

// ---------------------------------------------------------------------------
// Integration tests — only run when clawhub CLI is installed
// These call real network APIs and are skipped in CI.
// Run explicitly: pnpm vitest run src/__tests__/registry.test.ts
// ---------------------------------------------------------------------------

describe('ClawHubRegistry integration', () => {
  const registry = new ClawHubRegistry();
  const available = registry.isAvailable();
  const hasToken = !!process.env.GITHUB_TOKEN;

  it.skipIf(!available)('search returns results', async () => {
    const results = await registry.search('markdown', 3);
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]).toHaveProperty('slug');
    expect(results[0]).toHaveProperty('name');
  }, 30_000);

  it.skipIf(!available)('inspect returns structured data', async () => {
    const result = await registry.inspect('markdown-formatter');
    expect(result.slug).toBe('markdown-formatter');
    expect(result.name).toBeTruthy();
    expect(typeof result.description).toBe('string');
  }, 30_000);

  it.skipIf(!available)('inspect throws for nonexistent slug', async () => {
    await expect(
      registry.inspect('this-slug-definitely-does-not-exist-xyz-123'),
    ).rejects.toThrow();
  }, 30_000);

  it.skipIf(!available || !hasToken)('install downloads skill with SKILL.md', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'golem-reg-test-'));
    try {
      const destDir = join(tmpDir, 'my-skill');
      const result = await registry.install('markdown-formatter', destDir);
      expect(result.name).toBe('markdown-formatter');
      expect(result.version).toBeTruthy();

      const skillMd = await readFile(join(destDir, 'SKILL.md'), 'utf-8');
      expect(skillMd).toContain('name:');
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  }, 60_000);
});
