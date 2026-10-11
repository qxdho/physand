# 建仓与发布说明

本文件说明如何把当前目录发布成你自己的 GitHub 仓库。**执行完可以删掉这个文件。**

---

## 当前状态

- 本地仓库已就绪，最后一次提交是 `physand` 改名 + 模块化重构。
- **原作者的 16 个提交历史完整保留**（从 `R140` 往前）。
- 远程 `upstream` 指向原作者仓库，**推送已被禁用**（防止手滑推错）。

```bash
git remote -v
# upstream  https://github.com/Da0Mine/physics-sandbox.git (fetch)
# upstream  DISABLED_do_not_push_here (push)     <- 推不上去，故意的
```

---

## 第一步：在 GitHub 建空仓库

打开 <https://github.com/new>，填：

| 字段 | 填什么 |
|---|---|
| Repository name | `physand` |
| Description | `Single-file physics sandbox — draw shapes, assemble formulas, watch physics happen.` |
| Public / Private | 你定 |
| **Initialize this repository with** | **全部不要勾**（不要 README / .gitignore / license） |

> ⚠️ 千万别勾 "Add a README" —— 那会让远程仓库有提交，导致你推送时要先合并，多一步麻烦。

---

## 第二步：关联并推送

把 `<你的用户名>` 换成你的 GitHub 用户名：

```bash
cd /dsh/workspace/physics-sandbox

git remote add origin https://github.com/<你的用户名>/physand.git
git push -u origin main
```

推完后确认：

```bash
git remote -v
# origin    https://github.com/<你的用户名>/physand.git (fetch)
# origin    https://github.com/<你的用户名>/physand.git (push)
# upstream  https://github.com/Da0Mine/physics-sandbox.git (fetch)
# upstream  DISABLED_do_not_push_here (push)
```

---

## 第三步（可选）：开启 GitHub Pages

`index.html` 就在根目录，可以直接部署：

1. 仓库 → **Settings** → 左侧 **Pages**
2. **Source** 选 `Deploy from a branch`
3. **Branch** 选 `main`，目录选 `/ (root)`
4. 保存，等一两分钟

地址会是 `https://<你的用户名>.github.io/physand/`

---

## 以后同步原作者的更新

原作者还在更新（他最后提交是 R140）。想拉他的新改动：

```bash
git fetch upstream
git log --oneline upstream/main | head    # 看看他加了什么
git merge upstream/main                   # 合并进来
```

合并后**一定要跑测试**，确认没冲突改坏：

```bash
node tools/build.mjs --check
bash tools/run.sh replay.mjs
```

> 注意：如果原作者也改了 `index.html`，而你在 `src/` 里改了同样的东西，
> 会产生冲突。处理方式：以 `upstream` 的 `index.html` 为准重新 `split`，
> 再手动把你 `src/` 里的改动应用回去。这也是把单文件拆成 `src/` 的代价之一。

---

## 建立仓库后的第一次推送内容

30 个文件，约 1.5 MB：

```
.gitignore  LICENSE  README.md  index.html
MODULARIZATION.md  MODULES.md
src/            (7 个文件，源码)
tools/          (构建 + 测试工具)
tools/baselines/ (7 个测试基线 JSON)
```

**不包含**（已被 `.gitignore` 排除，可重新获取）：

| 目录 | 大小 | 如何重新获取 |
|---|---|---|
| `.browsers/` | 681 MB | `PLAYWRIGHT_BROWSERS_PATH=$PWD/.browsers npx playwright install chromium` |
| `.syslibs/` | 237 MB | `./tools/fetch-syslibs.sh` |
| `tools/node_modules/` | 19 MB | `cd tools && npm install` |

---

## 关于归属（重要）

这个项目是**基于原作者 [@Da0Mine](https://github.com/Da0Mine) 的作品重构**的，
MIT License 允许这样做，但要求**保留原版权声明**。当前已经做到：

- ✅ `LICENSE` 保留 `Copyright (c) 2026 Da0Mine`，另起一行加了重构方版权
- ✅ `README.md` 顶部有显著的「本项目是重构版」区块，含原作者、原仓库、原在线地址
- ✅ `git log` 里原作者的 16 个提交完整保留，提交作者仍是 Da0Mine

如果你想让归属更醒目，可以考虑：

1. **README 再加一句**你具体改了什么（现在写的是"拆源码树 + 构建管线 + 回归测试"）
2. **仓库 Topics 加上** `physics-sandbox`、`matter-js`，方便别人从原项目找过来
3. **仓库 Description 里点明**是 refactor / fork，例如：
   `Refactor of Da0Mine/physics-sandbox — modular src/, build pipeline, replay tests`

---

## 常用命令速查

```bash
# 构建（改完 src/ 后）
node tools/build.mjs

# 确认 src/ 与 index.html 一致（不写文件）
node tools/build.mjs --check

# 跑回归测试
bash tools/run.sh replay.mjs

# 看测试列表
bash tools/run.sh replay.mjs --list

# 改完物理后，确属预期行为变了，才重新录制基线
bash tools/run.sh replay.mjs --record
```
