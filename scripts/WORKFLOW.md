# Fork Dev Workflow (private, NOT for PRs)

> This file lives in `scripts/` which is gitignored on feature branches, tracked only on `dev`.
> Personal notes go here (not `notes.md` — that file is tracked by upstream and would leak into PRs).

## Branch model
- `main` — pristine mirror of upstream. Only `git merge --ff-only upstream/main`, never commit locally.
- `dev` — private long-lived branch: personal config (AGENTS.md, golem.yaml, .gitignore) + merged features + `scripts/`. Push to origin for cross-machine sync.
- `feature/*`, `pr/*` — clean feature/PR branches branched from `main`, feature code only. No `scripts/` here (by design).

## Personal config (AGENTS.md, golem.yaml, .gitignore)
- These are upstream-tracked files; the local versions are personal. They live as worktree-only changes.
- On `feature/*`/`pr/*` branches they are hidden from git via:
  ```
  git show dev:AGENTS.md > AGENTS.md
  git show dev:golem.yaml > golem.yaml
  git show dev:.gitignore > .gitignore
  git update-index --skip-worktree AGENTS.md golem.yaml .gitignore
  ```
- On `dev` they are tracked normally (authoritative source). On `main` keep upstream versions.

## Scripts (scripts/)
- `scripts/` is **tracked only on `dev`** → pushed to origin for cross-machine sync.
- On `feature/*`/`pr/*` branches `scripts/` does **not exist** (branched from `main`).
- **If you need a script on a feature branch**, materialize it temporarily:
  ```bash
  git show dev:scripts/bootstrap.sh > /tmp/bootstrap.sh && bash /tmp/bootstrap.sh
  ```
- **Windows**: see `scripts/WINDOWS.md` for setup and run options.
- `scripts/bootstrap.sh` — per-branch setup + `install-hooks` subcommand.
- `scripts/sync-upstream.sh` — the ONLY safe way to sync upstream (run on `dev` or `main`).

## Automatic hooks (installed by `bash scripts/bootstrap.sh install-hooks` on `dev`)
- **post-checkout**: self-contained hook, runs after every branch switch. Restores correct skip-worktree state without depending on `scripts/` being present.
- **pre-push**: blocks pushing `AGENTS.md`/`golem.yaml`/`.gitignore`/`notes.md`/`.env` into `feature/*` or `pr/*` branches.

## Sync-upstream footgun (IMPORTANT)
- NEVER merge/rebase while AGENTS.md/golem.yaml/.gitignore are `--skip-worktree` — git errors with "Entry not uptodate. Cannot merge" or silently keeps old content.
- `sync-upstream.sh` aborts immediately if working tree is dirty (uncommitted changes), preventing accidental data loss.
- Always use `scripts/sync-upstream.sh`; it unsets skip-worktree before merging on dev.
- After sync, re-run `bash scripts/bootstrap.sh` on the current branch.

## .env (gitignored, per machine)
- WeCom creds live in `.env`, loaded by `src/cli.ts:16`. Create on each machine.

## Daily ops
- Start bot: `pnpm build && node dist/cli.js gateway --verbose` (run on `dev`)
- New feature: `git checkout main && git checkout -b feature/x` → develop → push origin → PR.
- After feature merged into dev, feature branch can be archived.

## Do NOT commit these to PR branches
- `scripts/` (except on `dev`), `memory/`, `.opencode/`, `.omo/`, `.env`, personal `notes.md` content.
- `notes.md` is upstream-tracked — keep upstream content on feature/pr branches.

## Cross-machine setup (new Windows/Mac machine)
1. `git clone <fork>`
2. `git checkout dev && git pull origin dev`  ← scripts/ 在这里
3. `bash scripts/bootstrap.sh install-hooks`
4. `bash scripts/bootstrap.sh`
5. Create `.env` with WECOM credentials
