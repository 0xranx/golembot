/**
 * Pluggable skill registry interface + ClawHub implementation.
 *
 * Bridges to the `clawhub` CLI for search/install operations.
 * No new npm dependencies — requires the user to have `clawhub` installed globally.
 */

import { spawn } from 'node:child_process';
import { cp, mkdir, readdir, readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { isOnPath } from './engines/shared.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SkillSearchResult {
  slug: string;
  name: string;
  description: string;
  version?: string;
  author?: string;
  downloads?: number;
}

export interface SkillInstallResult {
  name: string;
  version: string;
}

// ---------------------------------------------------------------------------
// Registry interface (pluggable)
// ---------------------------------------------------------------------------

export interface SkillRegistry {
  readonly name: string;
  /** Check if the registry's CLI tool is available on PATH. */
  isAvailable(): boolean;
  /** Search for skills matching a natural-language query. */
  search(query: string, limit?: number): Promise<SkillSearchResult[]>;
  /** Install a skill by slug into destDir. */
  install(slug: string, destDir: string): Promise<SkillInstallResult>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function runCli(
  bin: string,
  args: string[],
  opts?: { cwd?: string; timeout?: number },
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    const timeout = opts?.timeout ?? 30_000;
    const proc = spawn(bin, args, {
      cwd: opts?.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout,
    });

    const chunks: Buffer[] = [];
    const errChunks: Buffer[] = [];
    proc.stdout.on('data', (d: Buffer) => chunks.push(d));
    proc.stderr.on('data', (d: Buffer) => errChunks.push(d));

    proc.on('error', reject);
    proc.on('close', (code) => {
      resolve({
        stdout: Buffer.concat(chunks).toString('utf-8'),
        stderr: Buffer.concat(errChunks).toString('utf-8'),
        code: code ?? 1,
      });
    });
  });
}

// ---------------------------------------------------------------------------
// ClawHub implementation
// ---------------------------------------------------------------------------

/** Parse clawhub search output: `slug  DisplayName  (score)` lines. */
function parseSearchOutput(stdout: string): Array<{ slug: string; name: string }> {
  const results: Array<{ slug: string; name: string }> = [];
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('-') || trimmed.startsWith('✔')) continue;
    // Format: slug  Display Name  (score)
    const match = trimmed.match(/^(\S+)\s+(.+?)\s+\(\d+\.\d+\)$/);
    if (match) {
      results.push({ slug: match[1], name: match[2].trim() });
    }
  }
  return results;
}

export class ClawHubRegistry implements SkillRegistry {
  readonly name = 'clawhub';

  isAvailable(): boolean {
    return isOnPath('clawhub');
  }

  async search(query: string, limit = 10): Promise<SkillSearchResult[]> {
    const { stdout, code } = await runCli(
      'clawhub',
      ['search', query, '--limit', String(limit)],
      { timeout: 15_000 },
    );

    if (code !== 0) return [];

    const basic = parseSearchOutput(stdout);
    if (basic.length === 0) return [];

    // Enrich with inspect --json for each result (parallel, best-effort)
    const enriched = await Promise.all(
      basic.map(async (b) => {
        try {
          const detail = await this.inspect(b.slug);
          return detail;
        } catch {
          return {
            slug: b.slug,
            name: b.name,
            description: '',
          } satisfies SkillSearchResult;
        }
      }),
    );

    return enriched;
  }

  /** Fetch detailed metadata for a single skill. */
  async inspect(slug: string): Promise<SkillSearchResult> {
    const { stdout, code } = await runCli(
      'clawhub',
      ['inspect', slug, '--json'],
      { timeout: 15_000 },
    );

    if (code !== 0) {
      throw new Error(`clawhub inspect failed for ${slug}`);
    }

    // Extract JSON from output (may have spinner lines before it)
    const jsonStart = stdout.indexOf('{');
    if (jsonStart === -1) throw new Error(`No JSON in inspect output for ${slug}`);
    const json = JSON.parse(stdout.slice(jsonStart));

    const skill = json.skill ?? {};
    const owner = json.owner ?? {};
    const latest = json.latestVersion ?? {};

    return {
      slug: skill.slug ?? slug,
      name: skill.displayName ?? slug,
      description: skill.summary ?? '',
      version: latest.version,
      author: owner.displayName ?? owner.handle,
      downloads: skill.stats?.installsAllTime,
    };
  }

  async install(slug: string, destDir: string): Promise<SkillInstallResult> {
    // Install to a temp workdir so clawhub doesn't pollute the real workspace
    const tmpBase = join(tmpdir(), `golem-clawhub-${Date.now()}`);
    await mkdir(tmpBase, { recursive: true });

    try {
      const { stdout, stderr, code } = await runCli(
        'clawhub',
        ['install', slug, '--force'],
        { cwd: tmpBase, timeout: 60_000 },
      );

      if (code !== 0) {
        // Extract clean error message from CLI output (strip ANSI, warnings, spinners)
        const raw = (stderr || stdout || 'unknown error').trim();
        const lines = raw.split('\n').filter(l => {
          const t = l.replace(/\x1b\[[^a-zA-Z]*[a-zA-Z]/g, '').trim();
          return t && !t.startsWith('(') && !t.startsWith('-') && !t.startsWith('✖');
        });
        const errorLine = lines.find(l => /error/i.test(l)) ?? lines[lines.length - 1] ?? raw;
        throw new Error(errorLine.replace(/\x1b\[[^a-zA-Z]*[a-zA-Z]/g, '').trim());
      }

      // clawhub installs to {workdir}/skills/{slug}/
      const installedPath = join(tmpBase, 'skills', slug);
      try {
        await stat(join(installedPath, 'SKILL.md'));
      } catch {
        // Slug might differ from directory name — scan for SKILL.md
        const skillsDir = join(tmpBase, 'skills');
        const entries = await readdir(skillsDir).catch(() => [] as string[]);
        let found = false;
        for (const entry of entries) {
          const candidate = join(skillsDir, entry, 'SKILL.md');
          try {
            await stat(candidate);
            // Found it — use this path
            await mkdir(destDir, { recursive: true });
            await cp(join(skillsDir, entry), destDir, { recursive: true });
            found = true;
            break;
          } catch {
            continue;
          }
        }
        if (!found) throw new Error(`Installed skill has no SKILL.md`);

        // Read version from _meta.json if present
        const version = await readMeta(destDir);
        return { name: slug, version };
      }

      // Copy the installed skill to the real destination
      await mkdir(destDir, { recursive: true });
      await cp(installedPath, destDir, { recursive: true });

      const version = await readMeta(destDir);
      return { name: slug, version };
    } finally {
      await rm(tmpBase, { recursive: true, force: true }).catch(() => {});
    }
  }
}

async function readMeta(skillDir: string): Promise<string> {
  try {
    const raw = await readFile(join(skillDir, '_meta.json'), 'utf-8');
    const meta = JSON.parse(raw);
    return meta.version ?? 'latest';
  } catch {
    return 'latest';
  }
}

// ---------------------------------------------------------------------------
// Registry factory
// ---------------------------------------------------------------------------

const REGISTRIES: Record<string, () => SkillRegistry> = {
  clawhub: () => new ClawHubRegistry(),
};

export function getRegistry(name: string): SkillRegistry | undefined {
  return REGISTRIES[name]?.();
}

export function listRegistries(): string[] {
  return Object.keys(REGISTRIES);
}
