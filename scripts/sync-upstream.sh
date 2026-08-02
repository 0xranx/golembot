#!/usr/bin/env bash
set -euo pipefail

# 同步上游到 main 和 dev。
# 用法：scripts/sync-upstream.sh
#
# 规则：上游同步只在 main -> dev 之间进行，绝不直接动 feature/pr 分支。
# feature/pr 分支如需更新，回到该分支后运行：git rebase dev，再跑 scripts/bootstrap.sh 恢复配置。

CONFIG_FILES="AGENTS.md golem.yaml .gitignore"
ORIG="$(git branch --show-current)"

log() { printf '[sync] %s\n' "$*"; }

# Abort if working tree is dirty (uncommitted changes would be lost by checkout -f)
if ! git diff --quiet HEAD || ! git diff --cached --quiet; then
  log "!! 工作区或暂存区有未提交改动，请先 commit 或 stash 后再运行 sync"
  exit 1
fi

log "fetch upstream..."
git fetch upstream

log "同步 main（快进，纯净）..."
git checkout -f main
git merge --ff-only upstream/main

log "同步 dev（合入上游）..."
git checkout -f dev
git update-index --no-skip-worktree $CONFIG_FILES 2>/dev/null || true
git checkout -- $CONFIG_FILES 2>/dev/null || true
git merge main -m "chore: sync upstream into dev" || true

if git diff --name-only --diff-filter=U | grep -q .; then
  log "!! 存在未解决冲突（通常是上游改了配置文件），请手动解决："
  log "   git add <files> && git commit"
  exit 1
fi

log "回到原分支并恢复配置文件状态..."
git checkout -f "$ORIG"
"$(dirname "$0")/bootstrap.sh"

log "同步完成 ✓"
