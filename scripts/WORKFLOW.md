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

### 4a. Bug found in a feature that is NOT yet merged to upstream (PR open)
```bash
# 切到功能分支，落地个人配置
git checkout feature/file-transfer
git show dev:scripts/bootstrap.sh > /tmp/bootstrap.sh && bash /tmp/bootstrap.sh

# 修代码 + 提交
git add src/xxx.ts
git commit -m "fix: ..."
git push origin feature/file-transfer    # GitHub PR 自动更新

# 若此分支已并入 dev，同步修复到 dev
git checkout dev
git merge feature/file-transfer
git push origin dev
```

### 4b. Bug found while running on dev（功能已并入 dev，日常使用中）
```bash
# 直接在 dev 上修
git checkout dev
git add src/xxx.ts
git commit -m "fix: ..."
git push origin dev
```

### 4c. Bug 需要回馈到上游原项目
**情况 1 — PR 还开着**：在 4a 的功能分支上修，PR 自动带上。

**情况 2 — 功能已被上游合并，但发现新 bug**：
```bash
# 从 main 开新的 fix 分支
git checkout main
git checkout -b feature/fix-file-transfer
git show dev:scripts/bootstrap.sh > /tmp/bootstrap.sh && bash /tmp/bootstrap.sh

# 从 dev 上 cherry-pick 修复的 commit（或直接修）
git cherry-pick <fix-commit-hash-from-dev>

# 推 + 提新 PR
git push origin feature/fix-file-transfer
# GitHub: PR feature/fix-file-transfer → upstream
```

**情况 3 — 功能已并入 dev 但 PR 被拒（未进上游），需要修复后重提 PR**：
```bash
# 回到原始 feature 分支
git checkout feature/file-transfer
git show dev:scripts/bootstrap.sh > /tmp/bootstrap.sh && bash /tmp/bootstrap.sh

# 修代码 + 提交
git add src/xxx.ts && git commit -m "fix: ..."
git push origin feature/file-transfer

# 确认修复后，重新提 PR（或 force push 更新已有 PR）
# 同步到 dev
git checkout dev && git merge feature/file-transfer && git push origin dev
```

### 4d. Bug 只在自己的 fork 里出现（上游没有这个问题）
```bash
# 直接在 dev 上修 + 推 origin，不往上提 PR
git checkout dev
git add src/xxx.ts && git commit -m "fix: local issue ..."
git push origin dev
```

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
