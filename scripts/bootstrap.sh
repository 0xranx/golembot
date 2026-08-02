#!/usr/bin/env bash
set -euo pipefail

# 在每个终端/分支上运行，确保个人配置文件处于正确状态：
#   - dev 分支：配置正常追踪（已提交，权威源），推 origin 跨终端同步
#   - main 分支：保持上游版本，纯净
#   - feature/*、pr/* 分支：从 dev 落地个人配置到工作区（git 可见 M 标记，commit/push 被 hook 拦截）
#
# 用法：scripts/bootstrap.sh [install-hooks]

CONFIG_FILES="AGENTS.md golem.yaml .gitignore"
BRANCH="$(git branch --show-current)"

log() { printf '[bootstrap] %s\n' "$*"; }

install_hooks() {
    HOOK_DIR=".git/hooks"
    mkdir -p "$HOOK_DIR"

    # pre-commit: block personal config from being committed on feature/pr branches
    cat > "$HOOK_DIR/pre-commit" <<'HOOK'
#!/bin/bash
local_branch="$(git rev-parse --abbrev-ref HEAD)"
if [[ "$local_branch" == feature/* || "$local_branch" == pr/* ]]; then
    # Check staged files (what is about to be committed)
    staged_files="$(git diff --cached --name-only)"
    for f in $(echo "$staged_files" | tr '\n' ' '); do
        case "$f" in
            AGENTS.md|golem.yaml|.gitignore|notes.md|.env)
                echo "[pre-commit BLOCKED] $f is a personal config file. Do not commit it to $local_branch."
                echo "Run: git reset HEAD $f && git checkout -- $f"
                exit 1
                ;;
        esac
    done
fi
exit 0
HOOK
    chmod +x "$HOOK_DIR/pre-commit"
    log "已安装 pre-commit hook: $HOOK_DIR/pre-commit"

    # pre-push: block personal config from being pushed to feature/pr branches
    cat > "$HOOK_DIR/pre-push" <<'HOOK'
#!/bin/bash
local_branch="$(git rev-parse --abbrev-ref HEAD)"
if [[ "$local_branch" == feature/* || "$local_branch" == pr/* ]]; then
    # Files changed in commits since main (works for first push, rebase, and updates)
    touched_files="$(git diff --name-only main...HEAD 2>/dev/null)"
    for f in $(echo "$touched_files" | tr '\n' ' '); do
        case "$f" in
            AGENTS.md|golem.yaml|.gitignore|notes.md|.env)
                echo "[pre-push BLOCKED] $f is a personal config file. Do not push it to $local_branch."
                echo "Remove it from history: git reset HEAD~1 -- $f (or rebase to drop the commit)"
                exit 1
                ;;
        esac
    done
fi
exit 0
HOOK
    chmod +x "$HOOK_DIR/pre-push"
    log "已安装 pre-push hook: $HOOK_DIR/pre-push"

    log "hooks 安装完成。pre-commit + pre-push 双重拦截 feature/pr 分支上的个人配置。"
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
    git checkout -- $CONFIG_FILES 2>/dev/null || true
    log "dev: 配置已恢复为 dev 已提交版本（正常追踪）"
    ;;
  main)
    git checkout -- $CONFIG_FILES 2>/dev/null || true
    log "main: 配置已恢复为上游版本（纯净）"
    ;;
  feature/*|pr/*)
    git show dev:AGENTS.md > AGENTS.md
    git show dev:golem.yaml > golem.yaml
    git show dev:.gitignore > .gitignore
    log "feature/pr: 个人配置已从 dev 落地到工作区（git status 可见 M，commit/push 被 hook 拦截）"
    ;;
  *)
    log "未知分支 '$BRANCH'，跳过（请在 main / dev / feature/* / pr/* 分支上运行）"
    ;;
esac

log "当前分支: $BRANCH"
log "配置文件状态 (git status):"
git status --short $CONFIG_FILES
