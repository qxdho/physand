# physand

> **Physics you can see. Formulas you can touch.**
> **让物理可见，让公式可触。**

一个网页物理沙盒。在画布上画线、画形状，画出来的东西会变成**真正的刚体**；
再把物理符号（`m` `g` `v` `a` `q` `t` …）拖到一起拼成公式（`mg`、`mv²/2`、`GMm/r²` …），
公式就会**真的作用到物体上**。

画出来的物体可以右键调参：**质量 / 摩擦 / 弹性 / 空气阻力 / 尺寸 / 宽度 / 高度 / 固定**。
尺寸与宽高是分开的 —— 方块也能拉成长条。

---

## ⚠️ 正在迁移：访问方式已经改变

本项目正从「下载一个 `index.html` 双击打开」迁移到**现代 Web 应用**（Vite + TypeScript + ESM）。

| | 旧方式 | 现在 |
|---|---|---|
| 使用方式 | 下载 `index.html`，双击离线运行 | **访问在线网址** |
| 离线 | ✅ 支持 | ❌ 不再支持 |
| 源码 | 手工拼接的单文件 | 真正的模块化工程 |

**迁移期间两套构建并存，并且都通过全部回归测试**，所以功能没有丢失。
进度与架构说明见 [ARCHITECTURE.md](ARCHITECTURE.md)。

> 旧的单文件构建仍然保留且可复现：`npm run legacy:build` 会从 `src/` 生成 `index.html`。
> 它是新构建的**对照基准**，也是「重构没改坏东西」的证明工具。

---

## 快速开始

### 只是想用

打开在线地址即可（部署在 GitHub Pages）：

```
https://qxdho.github.io/physand/
```

### 想改代码

```bash
npm install
npm run dev          # 开发服务器，带热更新
```

其他常用命令：

```bash
npm run typecheck    # TypeScript 类型检查
npm run build        # 生产构建 -> dist/
npm run preview      # 本地预览生产构建

npm run test         # 回归测试：传统单文件构建
npm run test:app     # 回归测试：新 Vite 构建
npm run test:both    # 两个都跑（提交前应该全绿）

npm run gen          # 重新生成派生文件
npm run gen:check    # 校验派生文件是否最新
```

**提交前请确保**：`npm run gen:check && npm run typecheck && npm run test:both`

---

## 项目结构

```
app/                    新的应用源码（TypeScript + ESM）
  main.ts               启动引导（分阶段，顺序敏感）
  core/world.ts         World 状态容器
  core/module-bridge.ts 让遗留脚本的全局仍然可用（迁移期临时设施）
  legacy/               从 src/ 生成的 CSS 与静态 DOM（勿手改）

src/                    遗留源码 —— 迁移期间仍是唯一事实来源
  10-app.js             主体（约 20,200 行，正在逐步拆解）
  90-boss.js            BOSS 动画
  vendor/matter.js      Matter.js v0.20.0（勿手改）

tools/                  构建与验证工具链（不发布）
```

**详细架构、迁移进度与不可动摇的约束，见 [ARCHITECTURE.md](ARCHITECTURE.md)。**

---

## 贡献

### 改哪里的代码

**改 `src/`（或迁移完成后的 `app/`），不要改 `index.html`。**
`index.html` 是构建产物，改动会在下次构建时被覆盖。

```bash
npm run gen:check    # 先确认派生文件是最新的
# ...改代码...
npm run gen          # 重新生成派生文件
npm run test:both    # 回归必须全绿
```

> **`app/legacy/` 和 `app/core/legacy-globals.generated.ts` 是自动生成的，不要手改。**
> 它们由 `tools/extract-legacy.mjs` 与 `tools/gen-globals.mjs` 从 `src/` 派生。
> CI 会校验它们是否最新，过期即失败。

### 回归测试

17 条场景覆盖物理核心。**任何改动都不能让它们变红**：

```
empty-steady           启动/全局初始化：不该有东西自己出现或移动
shape-freefall         重力与积分
shape-rest-on-ground   接触与静止
two-shapes-stack       多体接触排序
circle-roll            解析圆碰撞
rod-static-anchors     无锚定的杆不得漂移
belt-static            传送带必须保持静止
rod-anchored-swing     一端锚定的杆摆动且长度守恒 ★
spring-hanging-mass    弹簧悬挂质量振荡至平衡 ★
shape-resize-scaled    改尺寸后碰撞体真的变大 ★
shape-resize-identity  放大再还原必须精确回到原尺寸（防累积放大）★
shape-stretch-width    拉宽后碰撞体随之变宽（防 hull 缓存没作废）★
shape-stretch-identity 两轴拉伸再还原必须精确回到原尺寸 ★
shape-fixed-holds      设为固定后必须悬停不落 ★
spring-soft-sag        软弹簧（k 小）必须明显下垂 ★
spring-stiff-sag       硬弹簧（k 大）必须几乎不下垂 ★
rod-length-changed     改杆长必须真的改变两端几何 ★
```

★ = 2026-10 新增。另有 162 条单元测试覆盖新模块，跑 `npm run test:unit`。

★ = 2026-10 新增。它们补上了一个**严重盲区**：此前在 `rodSyncAnchors`
（全项目最大的函数）开头注入 `if(1)return false;`，测试**依然 7/7 全绿** ——
因为旧场景造的杆没有锚点，函数在第二行就早退了。
**加场景时必须验证它能让目标函数真的跑起来。** 详见 [ARCHITECTURE.md](ARCHITECTURE.md) §4.2。

### Bug 反馈

**总 bug 汇总清单（原项目维护）：**

<https://sandbox-bug-api.pages.dev/?k=1c7de3af43df0615f9ee8a95c3c7467493762ce75b07d0dc>

- 每条包含提交时间、描述，以及一份**录屏 JSON**（点右侧「原始 JSON」下载；逐帧记录了当时的物体、字母、速度与全部操作事件）。
- **部分 bug 已标明修复状态**：打开沙盒 → 左上角「设置」→「Bug 记录」→「Bug 修复列表」，状态分 **已修复 / 待修复 / 待提交 / 未判定**。
- 讨论某一条时直接说**编号**（那串 13 位数字，同时也是提交时的毫秒时间戳）。

想帮忙修：挑一条 → 下载「原始 JSON」→ 照操作步骤复现 → 改 `src/` → 跑回归 → 提 PR
（写清修的是哪个编号、复现步骤、为什么这么改）。

只是想反馈问题：沙盒页面 → 「设置」→「开始记录」→ 照常操作复现 →「停止并导出」→
在「提交 Bug 记录」里提交。

---

## 本项目的来源

> **`physand` 基于 [Da0Mine/physics-sandbox](https://github.com/Da0Mine/physics-sandbox) 重构。**
>
> - **原作者**：[@Da0Mine](https://github.com/Da0Mine) —— 产品的设计、全部物理实现、以及那套 bug 反馈机制都是他做的。
> - **原项目**：<https://github.com/Da0Mine/physics-sandbox>（MIT License）
> - **原在线地址**：<https://physics-sandbox-881.pages.dev/>
>
> **本仓库做的改动**：
> 1. 把 20,175 行的单文件拆成 `src/` 源码树 + 构建管线 + 回放回归测试（原作者的 16 个提交完整保留）；
> 2. 正在进行的现代化重构：Vite + TypeScript + ESM、World 状态容器、模块边界。
>
> 产品功能与物理行为**始终保持一致** —— 回归测试在旧构建与新构建上跑同一批基线，
> 这是可验证的等价性，而不是口头保证。

原项目的 bug 清单与贡献指引依然有效（见上）。

---

## 第三方

[Matter.js](http://brm.io/matter-js/) v0.20.0（MIT License，(c) Liam Brummitt / brm.io），
用于绘制体（画出来的墨迹与形状）的刚体物理。
它驱动边界（`W`）物体之间的碰撞；杆、弹簧、解析圆/环、传送带牵引由项目自研求解器负责。

## 许可证

MIT License，见 [LICENSE](LICENSE)。原版权归 [@Da0Mine](https://github.com/Da0Mine) 所有。
