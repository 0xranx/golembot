#!/usr/bin/env bash
set -euo pipefail

# 在每个终端/分支上运行，确保个人配置文件处于正确状态：
#   - dev 分支：配置正常追踪（已提交，权威源），推 origin 跨终端同步
#   - main 分支：保持上游版本，纯净
#   - feature/*、pr/* 分支：从 dev 物化 golem.yaml + scripts/，重置 notes.md
#     AGENTS.md 和 .gitignore 不物化，由 git 自行管理，可自由 commit/PR
#
# 用法：scripts/bootstrap.sh [install-hooks]

CONFIG_FILES="AGENTS.md golem.yaml .gitignore"  # For dev/main: restore tracked versions
BRANCH="$(git branch --show-current)"

log() { printf '[bootstrap] %s\n' "$*"; }

install_hooks() {
    HOOK_DIR=".git/hooks"
    mkdir -p "$HOOK_DIR"

    # post-checkout: auto-materialize golem.yaml + scripts + reset notes.md on feature/pr branches
    cat > "$HOOK_DIR/post-checkout" <<'HOOK'
#!/bin/bash
BRANCH=$(git branch --show-current)
case "$BRANCH" in
  feature/*|pr/*)
    # Personal config (golem.yaml only — AGENTS.md and .gitignore are git-managed)
    git show dev:golem.yaml > golem.yaml 2>/dev/null || true
    # Reset notes.md to upstream version (prevent opencode from polluting it)
    git show HEAD:notes.md > notes.md 2>/dev/null || true
    # Scripts (gitignored via .gitignore, invisible to git)
    mkdir -p scripts
    for s in bootstrap.sh sync-upstream.sh bootstrap.bat sync-upstream.bat WINDOWS.md WORKFLOW.md; do
        git show dev:scripts/"$s" > scripts/"$s" 2>/dev/null || true
    done
    chmod +x scripts/*.sh 2>/dev/null || true
    ;;
esac
HOOK
    chmod +x "$HOOK_DIR/post-checkout"
    log "已安装 post-checkout hook"

    # pre-commit: block personal config + scripts from being committed on feature/pr branches
    cat > "$HOOK_DIR/pre-commit" <<'HOOK'
#!/bin/bash
local_branch="$(git rev-parse --abbrev-ref HEAD)"
if [[ "$local_branch" == feature/* || "$local_branch" == pr/* ]]; then
    staged_files="$(git diff --cached --name-only)"
    for f in $(echo "$staged_files" | tr '\n' ' '); do
        case "$f" in
            golem.yaml|notes.md|.env|scripts/*)
                echo "[pre-commit BLOCKED] $f is a personal config file. Do not commit it to $local_branch."
                echo "Run: git reset HEAD $f"
                exit 1
                ;;
        esac
    done
fi
npx lint-staged
HOOK
    chmod +x "$HOOK_DIR/pre-commit"
    log "已安装 pre-commit hook"

    # pre-push: block personal config + scripts from being pushed to feature/pr branches
    cat > "$HOOK_DIR/pre-push" <<'HOOK'
#!/bin/bash
local_branch="$(git rev-parse --abbrev-ref HEAD)"
if [[ "$local_branch" == feature/* || "$local_branch" == pr/* ]]; then
    touched_files="$(git diff --name-only main...HEAD 2>/dev/null)"
    for f in $(echo "$touched_files" | tr '\n' ' '); do
        case "$f" in
            golem.yaml|notes.md|.env|scripts/*)
                echo "[pre-push BLOCKED] $f is a personal config file. Do not push it to $local_branch."
                exit 1
                ;;
        esac
    done
fi
exit 0
HOOK
    chmod +x "$HOOK_DIR/pre-push"
    log "已安装 pre-push hook"

    log "hooks 安装完成：post-checkout 自动物化 + pre-commit/pre-push 双拦截"
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
    git show dev:golem.yaml > golem.yaml
    git show HEAD:notes.md > notes.md 2>/dev/null || true
    mkdir -p scripts
    for s in bootstrap.sh sync-upstream.sh bootstrap.bat sync-upstream.bat WINDOWS.md WORKFLOW.md; do
        git show dev:scripts/"$s" > scripts/"$s" 2>/dev/null || true
    done
    chmod +x scripts/*.sh 2>/dev/null || true
    log "feature/pr: 物化 golem.yaml + scripts/ + 重置 notes.md（AGENTS.md 和 .gitignore 由 git 自行管理）"
    ;;
  *)
    log "未知分支 '$BRANCH'，跳过（请在 main / dev / feature/* / pr/* 分支上运行）"
    ;;
esac

log "当前分支: $BRANCH"
log "配置文件状态 (git status):"
git status --short $CONFIG_FILES
