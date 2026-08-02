# Fork Dev Workflow (private, NOT for PRs)

> This file lives in `scripts/` which is tracked only on `dev`, gitignored elsewhere.
> Personal notes go here (not `notes.md` — that file is tracked by upstream and would leak into PRs).

## Branch model
- `main` — pristine mirror of upstream. Only `git merge --ff-only upstream/main`, never commit locally.
- `dev` — private long-lived branch: personal config (AGENTS.md, golem.yaml, .gitignore) + merged features + `scripts/`. Push to origin for cross-machine sync.
- `feature/*`, `pr/*` — clean feature/PR branches branched from `main`, feature code only.

## 1. New machine setup (first time)
```bash
# 1. Clone your fork
git clone git@github.com:WuMingruiWu/golembot.git   # <-- your fork URL
cd golembot

# 2. Checkout dev (has personal config + scripts)
git checkout dev && git pull origin dev

# 3. Install hooks (pre-commit + pre-push)
bash scripts/bootstrap.sh install-hooks

# 4. Ensure correct config state on current branch
bash scripts/bootstrap.sh

# 5. Create .env with credentials
cp .env.example .env   # then fill in WECOM_BOT_ID / WECOM_SECRET

# 6. Verify
git status   # should be clean on dev
pnpm build && node dist/cli.js gateway --verbose   # start bot
```
Windows: use Git Bash; run `.bat` wrappers instead (see `WINDOWS.md`).

## 2. Daily development

### Everyday (on dev)
```bash
git checkout dev
pnpm build && node dist/cli.js gateway --verbose   # run bot
```

### New feature (core flow)
```bash
# 1. Branch from pristine main
git checkout main
git checkout -b feature/file-transfer

# 2. Materialize personal config into worktree (from dev)
git show dev:scripts/bootstrap.sh > /tmp/bootstrap.sh && bash /tmp/bootstrap.sh
#    → AGENTS.md / golem.yaml / .gitignore become personal (M status, normal)

# 3. Develop code (write src/), opencode has full context (worktree AGENTS.md)

# 4. Commit ONLY feature code
git add src/xxx.ts
git commit -m "feat: ..."
#    → pre-commit hook blocks if AGENTS.md/golem.yaml/.gitignore staged by mistake

# 5. Push and open PR
git push origin feature/file-transfer
#    → pre-push hook blocks if config files got into commits
#    → GitHub: PR from feature/file-transfer → upstream

# 6. Merge into dev when done
git checkout dev
git merge feature/file-transfer
git push origin dev
```

## 3. Sync feature progress between machines
```bash
# Machine A (where you developed):
git push origin feature/file-transfer

# Machine B (other terminal):
git fetch origin
git checkout -b feature/file-transfer origin/feature/file-transfer
#   or if branch exists: git checkout feature/file-transfer && git pull origin feature/file-transfer

# Then materialize personal config on B (scripts not in branch):
git show dev:scripts/bootstrap.sh > /tmp/bootstrap.sh && bash /tmp/bootstrap.sh
# continue working; when done, push back: git push origin feature/file-transfer
```
Note: uncommitted worktree changes (M AGENTS.md etc.) are machine-local. Commit feature code before switching machines; config auto-restores via bootstrap.

## 4. Bug fixing workflow

### Bug in a feature that is NOT yet merged to upstream (PR open)
```bash
git checkout feature/file-transfer
git show dev:scripts/bootstrap.sh > /tmp/bootstrap.sh && bash /tmp/bootstrap.sh
# fix code
git add src/xxx.ts && git commit -m "fix: ..."
git push origin feature/file-transfer   # PR updates automatically
# if merged to dev already, also merge the fix into dev
git checkout dev && git merge feature/file-transfer && git push origin dev
```

### Bug in a feature already merged to dev (in use)
```bash
git checkout dev
# fix code
git add src/xxx.ts && git commit -m "fix: ..."
git push origin dev
```

### Bug needs to go to upstream too
- If PR still open: fix on the feature branch (above), PR picks it up.
- If feature already merged upstream: create a new `feature/fix-xxx` branch from `main`, cherry-pick the fix commit, push, PR.

## 5. Sync upstream (weekly/monthly)
```bash
# Run from anywhere (script handles branches). Aborts if worktree dirty.
git show dev:scripts/sync-upstream.sh > /tmp/su.sh && bash /tmp/su.sh
#   1. fetch upstream
#   2. main → ff-only to latest upstream
#   3. dev → merge main (upstream features come in)
#   4. back to your original branch
```
Rules: only `main`→`dev` sync. `feature/*` never syncs upstream directly; if needed: `git checkout feature/x && git rebase main`.

## Personal config (AGENTS.md, golem.yaml, .gitignore)
- Upstream-tracked files; local versions are personal (M status on feature/pr branches).
- On `dev`: tracked normally (authoritative source, pushed to origin).
- On `main`: upstream versions.
- On `feature/*`/`pr/*`: materialized from dev via bootstrap.sh; commit/push blocked by hooks.

## Automatic hooks (installed on dev via `bash scripts/bootstrap.sh install-hooks`)
- **pre-commit**: on `feature/*`/`pr/*`, blocks staging AGENTS.md/golem.yaml/.gitignore/notes.md/.env.
- **pre-push**: on `feature/*`/`pr/*`, blocks pushing those files.
- Hooks live in `.git/hooks/` (local, machine-specific, reinstall per machine).

## Do NOT commit to PR branches
- `scripts/`, `memory/`, `.opencode/`, `.omo/`, `.env`, personal `notes.md` content.
- `notes.md` is upstream-tracked — keep upstream content on feature/pr branches.

## Windows
- See `scripts/WINDOWS.md` for setup and run options.
