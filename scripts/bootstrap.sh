#!/usr/bin/env bash
set -euo pipefail

# 在每个终端/分支上运行，确保个人配置文件处于正确状态：
#   - dev 分支：配置正常追踪（skip-worktree 关闭），作为个人配置权威源
#   - main 分支：保持上游版本（skip-worktree 关闭），保持纯净
#   - feature/*、pr/* 分支：从 dev 落地个人配置并隐藏（skip-worktree 开启），确保 PR 干净
#
# 用法：scripts/bootstrap.sh [install-hooks]

CONFIG_FILES="AGENTS.md golem.yaml .gitignore"
BRANCH="$(git branch --show-current)"

log() { printf '[bootstrap] %s\n' "$*"; }

install_hooks() {
    HOOK_DIR=".git/hooks"
    mkdir -p "$HOOK_DIR"

    # post-checkout: self-contained, does NOT depend on scripts/bootstrap.sh existing
    # (feature branches do not have scripts/ per design)
    cat > "$HOOK_DIR/post-checkout" <<'HOOK'
#!/bin/bash
# Auto-bootstrap after branch checkout — self-contained, no external script dependency
CONFIG_FILES="AGENTS.md golem.yaml .gitignore"
BRANCH=$(git branch --show-current)
case "$BRANCH" in
  feature/*|pr/*)
    git show dev:AGENTS.md > AGENTS.md 2>/dev/null || true
    git show dev:golem.yaml > golem.yaml 2>/dev/null || true
    git show dev:.gitignore > .gitignore 2>/dev/null || true
    git update-index --skip-worktree $CONFIG_FILES 2>/dev/null || true
    ;;
  dev)
    git update-index --no-skip-worktree $CONFIG_FILES 2>/dev/null || true
    git checkout -- $CONFIG_FILES 2>/dev/null || true
    ;;
  main)
    git update-index --no-skip-worktree $CONFIG_FILES 2>/dev/null || true
    git checkout -- $CONFIG_FILES 2>/dev/null || true
    ;;
esac
HOOK
    chmod +x "$HOOK_DIR/post-checkout"
    log "已安装 post-checkout hook: $HOOK_DIR/post-checkout"

    # pre-push: block personal config from entering feature/pr branches
    cat > "$HOOK_DIR/pre-push" <<'HOOK'
#!/bin/bash
local_branch="$(git rev-parse --abbrev-ref HEAD)"
if [[ "$local_branch" == feature/* || "$local_branch" == pr/* ]]; then
    touched_files="$(git diff --name-only @{push} 2>/dev/null || git diff --name-only origin/"$local_branch"...HEAD 2>/dev/null || echo "")"
    for f in $(echo "$touched_files" | tr '\n' ' '); do
        case "$f" in
            AGENTS.md|golem.yaml|.gitignore|notes.md|.env)
                echo "[pre-push BLOCKED] $f is a personal config file. Do not push it to $local_branch."
                echo "Run: git reset HEAD $f && git checkout -- $f && git commit --amend --no-edit"
                exit 1
                ;;
        esac
    done
fi
exit 0
HOOK
    chmod +x "$HOOK_DIR/pre-push"
    log "已安装 pre-push hook: $HOOK_DIR/pre-push"

    log "hooks 安装完成。post-checkout 会在每次切分支后自动运行（自包含，不依赖 scripts/ 存在）。"
}

# Subcommand: install-hooks
if [[ "${1:-}" == "install-hooks" ]]; then
    install_hooks
    exit 0
fi

# Verify dev branch exists before materializing from it
case "$BRANCH" in
  feature/*|pr/*)
    if ! git rev-parse --verify dev >/dev/null 2>&1; then
      log "!! dev 分支不存在，无法 materialize 个人配置。请先创建 dev 并提交配置。"
      exit 1
    fi
    ;;
esac

case "$BRANCH" in
  dev)
    git update-index --no-skip-worktree $CONFIG_FILES 2>/dev/null || true
    git checkout -- $CONFIG_FILES 2>/dev/null || true
    log "dev: 配置正常追踪（skip-worktree 已关闭）"
    ;;
  main)
    git update-index --no-skip-worktree $CONFIG_FILES 2>/dev/null || true
    git checkout -- $CONFIG_FILES 2>/dev/null || true
    log "main: 保持上游配置版本（纯净，skip-worktree 关闭）"
    ;;
  feature/*|pr/*)
    git show dev:AGENTS.md > AGENTS.md
    git show dev:golem.yaml > golem.yaml
    git show dev:.gitignore > .gitignore
    git update-index --skip-worktree $CONFIG_FILES
    log "feature/pr: 个人配置已从 dev 落地并隐藏（skip-worktree 开启）"
    ;;
  *)
    log "未知分支 '$BRANCH'，跳过（请在 main / dev / feature/* / pr/* 分支上运行）"
    ;;
esac

log "当前分支: $BRANCH"
log "配置文件状态:"
git ls-files -v $CONFIG_FILES
