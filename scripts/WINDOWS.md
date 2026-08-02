# Windows 使用说明

> `scripts/` 目录下所有 `.sh` 脚本都需要 bash 环境才能运行。

## 前提条件

1. **安装 Git for Windows**（自带 Git Bash）
   - 下载地址：https://git-scm.com/download/win
   - 安装时保持默认选项即可，确保勾选了 **"Git from the command line and also from 3rd-party software"**（让 bash 进入 PATH）

2. **验证 bash 可用**
   打开 CMD 或 PowerShell，输入：
   ```
   bash --version
   ```
   如果显示版本号（如 `GNU bash, version 5.x.x`），说明环境就绪。

## 运行方式（二选一）

### 方式一：直接双击 `.bat` 文件（推荐）
```
scripts/bootstrap.bat
scripts/sync-upstream.bat
```
`.bat` 会自动检测 bash 并调用对应的 `.sh` 脚本。

### 方式二：在 CMD / PowerShell 里手动调用 bash
```bash
bash scripts/bootstrap.sh
bash scripts/sync-upstream.sh
```

### 方式三：在 Git Bash 终端里直接运行
打开 Git Bash（右键 repo 目录 → "Git Bash Here"），然后：
```bash
bash scripts/bootstrap.sh
bash scripts/sync-upstream.sh
```

## 常见问题

**Q: 双击 `.bat` 闪一下就没了？**
A: 大概率是 bash 没进 PATH。重装 Git for Windows，安装时选 **"Use Git and optional Unix tools from the Command Prompt"**。

**Q: 脚本报错 "bash not found"？**
A: 同上，或者手动把 `C:\Program Files\Git\bin` 加到系统 PATH。

**Q: 中文显示乱码？**
A: Git Bash 默认 UTF-8，若 CMD 里乱码，先执行 `chcp 65001` 再运行脚本。

## 文件清单

| 文件 | 说明 |
|---|---|
| `bootstrap.sh` / `bootstrap.bat` | 分支状态初始化 |
| `sync-upstream.sh` / `sync-upstream.bat` | 同步上游 |
| `WORKFLOW.md` | 完整工作流文档 |
| `WINDOWS.md` | 本文件 |
