# GolemBot Fork 开发工作流

> Personal notes: `scripts/WORKFLOW.md` or `memory/`
> — do NOT write to `notes.md` (upstream-tracked, would leak to PRs).

## 分支模型

```
upstream (0xranx/golembot)
   │  bash scripts/sync-upstream.sh
   ▼
main ── 纯净镜像（永不 commit，仅 ff‑only 同步）
   │  git checkout -f main && git checkout -b feature/xxx
   ├── pr/wecom-group-chat           → upstream PR ✓
   ├── feature/file-transfer（未来）  → upstream PR
   └── dev ── 你的家（90% 时间在这里）
         ├── AGENTS.md（7‑skill）/ golem.yaml（wecom）/ .gitignore（含 scripts/）
         ├── scripts/（bootstrap.sh / sync‑upstream.sh / WORKFLOW.md / WINDOWS.md / .bat）
         ├── 合并的功能代码
         └── git push origin dev → 跨终端同步
```

| 分支 | 角色 | 使用频率 |
|---|---|---|
| `dev` | 日常开发、跑 bot、合并功能 | 90% |
| `main` | 上游镜像、开新分支的起点 | 3% |
| `feature/*` / `pr/*` | 开发功能 → 提 PR | 7% |

---

## 一、新机器 setup（一次性）

```bash
# 1. 克隆你的 fork（默认 checkout main，无 scripts/hooks/.env）
git clone git@github.com:WuMingrui98/golembot.git
cd golembot

# 2. 切到 dev（个人配置 + scripts 都在这里）
git checkout dev && git pull origin dev

# 3. 安装 hooks（必须在 dev 上跑——只有 dev 有 bootstrap.sh）
bash scripts/bootstrap.sh install-hooks

# 4. 确保当前分支配置正确
bash scripts/bootstrap.sh

# 5. 创建 .env（每台机器独立，填 WECOM 凭证）
cp .env.example .env
# 编辑 .env，写入：WECOM_BOT_ID=xxx  WECOM_SECRET=xxx

# 6. 验证
git status                              # dev 应干净
pnpm build && node dist/cli.js gateway --verbose
```

> Windows：用 Git Bash，跑 `scripts/bootstrap.bat`（详见 `scripts/WINDOWS.md`）。

---

## 二、日常开发

### 每天（在 dev 上）
```bash
git checkout dev
pnpm build && node dist/cli.js gateway --verbose
```

### 开新功能（核心流程）
```bash
# 1. 从纯净 main 开分支 → post‑checkout hook 自动物化一切
git checkout -f main && git checkout -b feature/file-transfer
#    → AGENTS.md / golem.yaml / .gitignore → M（正常，hook 保护）
#    → scripts/ → 已就位（.gitignore 隐藏，git status 看不到）
#    → notes.md → 自动重置为上游版

# 2. 写代码（opencode 有完整上下文——AGENTS.md 在工作区）

# 3. 提交功能代码
git add src/xxx.ts && git commit -m "feat: …"
#    → 若手滑 git add AGENTS.md → pre‑commit 拦截
#    → 拦截通过后跑 npx lint‑staged

# 4. 推送并提 PR
git push origin feature/file-transfer
#    → 若配置混进 commit 历史 → pre‑push 拦截（main…HEAD）
#    → GitHub: feature/file-transfer → upstream 发起 PR

# 5. 完成，并入 dev
git checkout -f dev
git merge feature/file-transfer
git push origin dev
```

> **切分支要点**：dev ↔ feature 时配置文件不同会产生冲突 → 必须用 `git checkout -f`。

---

## 三、跨终端同步功能进度

```bash
# 机器 A（开发端）
git push origin feature/file-transfer

# 机器 B（另一端，必须先完成“新机器 setup”）
git fetch origin
git checkout -b feature/file-transfer origin/feature/file-transfer
#    → post‑checkout 自动物化，直接继续开发
```

---

## 四、Bug 修复

### 4a. PR 还开着（功能未合入上游）
```bash
git checkout -f feature/file-transfer     # post‑checkout 自动物化
git add src/xxx.ts && git commit -m "fix: …"
git push origin feature/file-transfer     # GitHub PR 自动更新
git checkout -f dev && git merge feature/file-transfer && git push origin dev
```

### 4b. 功能已并入 dev（日常在用）
```bash
git checkout dev
git add src/xxx.ts && git commit -m "fix: …"
git push origin dev
```

### 4c. 需要回馈上游
- **PR 还开着** → 同 4a，在 feature 分支上修
- **已合并、但出新 bug** →
  ```bash
  git checkout -f main && git checkout -b feature/fix-file-transfer
  git cherry-pick <修复合并在dev的commit>
  git push origin feature/fix-file-transfer    # 新 PR
  ```
- **PR 被拒、重提交** → `checkout -f feature/xxx` → 修 → push → 更新/重提 PR

### 4d. 只在自己 fork 的问题（不上报上游）
```bash
git checkout dev
git add src/xxx.ts && git commit -m "fix: …"
git push origin dev
```

---

## 五、同步上游（每周/每月）

```bash
bash scripts/sync-upstream.sh
# 1. fetch upstream
# 2. main → ff‑only 快进
# 3. dev → merge main（dirty 检查已自动排除配置文件）
# 4. 回到原分支
```

规则：永远只 `main` → `dev` 同步，`feature/*` 不直接同步上游。feature 分支如需更新：`git checkout feature/x && git rebase main`。

---

## 六、个人文件清单

| 文件 | dev | feature/pr | 进 PR？ | 保护 |
|---|---|---|---|---|
| `AGENTS.md`（7‑skill） | tracked | M（hook 物化） | ❌ | pre‑commit + pre‑push |
| `golem.yaml`（wecom 配置） | tracked | M（hook 物化） | ❌ | pre‑commit + pre‑push |
| `.gitignore`（含 scripts/） | tracked | M（hook 物化） | ❌ | pre‑commit + pre‑push |
| `scripts/`（6 个文件） | tracked | untracked + ignored | ❌ | .gitignore + pre‑commit |
| `notes.md` | 上游版 | hook 重置为上游版 | ❌ | pre‑commit |
| `.env` | gitignored | gitignored | ❌ | pre‑commit |

---

## 七、三层 Hook 保护

| Hook | 触发时机 | 作用 |
|---|---|---|
| **post‑checkout** | 切到 feature/pr 后 | 从 dev 物化 3 配置 + 6 脚本 + 重置 notes.md |
| **pre‑commit** | commit 时 | 拦截 AGENTS.md / golem.yaml / .gitignore / scripts/ / .env / notes.md → 放行后跑 `npx lint‑staged` |
| **pre‑push** | push 时 | 用 `main…HEAD` 检查 commit 历史是否有个人文件 → 拒绝 push（含首次推送新分支） |

Hook 文件在 `.git/hooks/`（本地文件，不进 git）。`install‑hooks` 只能在 dev 分支上跑（只有 dev 有 `scripts/bootstrap.sh`）。

**pull dev 后重装**：若 `scripts/bootstrap.sh` 有更新，重跑一次：
```bash
bash scripts/bootstrap.sh install-hooks
```

---

## 八、三条铁律

1. **`main` 永不 commit**——只 `sync‑upstream.sh` 快进
2. **`dev` 不向上游提 PR**——只 `feature/*` 提 PR
3. **git status 里的 3 个 M 是正常的**——AGENTS.md / golem.yaml / .gitignore 是个人配置，不要 `git add` 它们

---

## 九、Windows

参见 `scripts/WINDOWS.md`。要点：装 Git for Windows（自带 Git Bash），跑 `.bat` 包装器或 `bash scripts/xxx.sh`。
