# ARCHITECTURE.md — physand 架构与重构说明

> 设计理念：**让物理可见，让公式可触。**
> *Physics you can see. Formulas you can touch.*

这篇文档说明项目**现在**是什么结构、**为什么**是这么结构、以及重构**走到哪一步**。
它是重构期间的唯一权威说明；`MODULARIZATION.md` 是重构前的分析报告（保留作历史依据）。

---

## 0. 一句话现状

项目正处于**从「手工拼接的单文件」到「现代 Web 应用」的渐进式迁移**中。

**两套构建目前并存，且都通过全部 9 条回归测试：**

| 目标 | 命令 | 产物 | 状态 |
|---|---|---|---|
| 传统单文件 | `npm run legacy:build` | `index.html` | ✅ 9/9 通过 |
| 新架构 | `npm run build` | `dist/` | ✅ 9/9 通过 |

**同一个测试套件、同一批基线**跑在这两个目标上 —— 这就是「重构没有改变行为」的证明。

---

## 1. 为什么必须迁移

重构前的实测数据（`MODULARIZATION.md` §1）：

- `src/10-app.js` **20,202 行**，**832 个顶层声明**
- 其中 **165 个函数构成一个强连通分量**，一起引用约 **211 个可变全局**
- 耦合是**弥散型**而非枢纽型：删掉最大的单个函数，SCC 只从 165 降到 144
- 引用最多的全局：`grab`(568 次)、`W`(409)、`bodies`(372)

直接后果：**没有任何干净的缝隙可以下刀**，而且——

**功能性后果（用户直接感受到的）：**

| 症状 | 根因 |
|---|---|
| 画出来的物块**没法调大小** | 尺寸参数 `scale` 存在，但只在物块挂了 `r` 字母时才出现（`paramDef` 第 8800 行） |
| 参数调节**不丰富** | 参数用 `if (B.kind===...) push(...)` 硬编码，新增一个旋钮要改 4 处（定义/push/读取/写入） |

这不是「缺功能」，是**参数系统与对象模型耦合过紧**。所以修复它属于重构，而不是打补丁。

---

## 2. 目标结构

```
physand/
├── app/                       ← 新的应用源码（TypeScript + ESM）
│   ├── index.html             Vite 入口
│   ├── main.ts                启动引导（分阶段，顺序敏感）
│   ├── core/                  内核：状态、桥接、生命周期
│   │   ├── world.ts           ★ World 状态容器（唯一可变状态的主人）
│   │   ├── module-bridge.ts   把遗留脚本的顶层声明重新发布为全局
│   │   └── legacy-globals.generated.ts  （生成物，勿手改）
│   └── legacy/                （生成物，勿手改）
│       ├── style.css          来自 src/00-head.html 的 <style>
│       ├── body.html          来自 src/05-body.html 的静态 DOM
│       └── mid.html           来自 src/50-mid.html
│
├── src/                       ← 遗留源码（迁移期间仍是唯一事实来源）
│   ├── 10-app.js              20,202 行主体；逐步拆解中
│   ├── 90-boss.js             BOSS 动画 IIFE
│   ├── vendor/matter.js       Matter.js v0.20.0（UMD，勿手改）
│   └── *.html                 页面骨架片段
│
└── tools/                     ← 构建与验证工具链（不发布）
```

### 目标模块边界（阶段 C 落地）

| 模块 | 职责 | 对应理念 |
|---|---|---|
| `physics/` | 引擎接口层（隔离 Matter）+ 自研求解器 | 让物理可见 |
| `formulas/` | 公式求值器 + 符号注册表 | **让公式可触** |
| `render/` | 分层渲染，新物理量可插拔 | 让物理可见 |
| `ui/` | 面板/工具栏，与状态解耦 | — |
| `core/` | World 状态容器、生命周期 | — |

---

## 3. 迁移期间的关键机制

### 3.1 单一事实来源 + 生成物

迁移期间同一个源会被**三种**产物表示，这是最大的漂移风险。对策是
**全部由脚本生成，且每个脚本都支持 `--check`**：

| 源 | 生成物 | 脚本 |
|---|---|---|
| `src/*.html` + `src/10-app.js` | `index.html` | `tools/build.mjs` |
| `src/00-head.html` 的 `<style>` 等 | `app/legacy/*` | `tools/extract-legacy.mjs` |
| `src/10-app.js` 的顶层声明 | `app/core/legacy-globals.generated.ts` | `tools/gen-globals.mjs` |

```bash
npm run gen         # 重新生成全部
npm run gen:check   # 校验是否最新（CI 会跑；过期即失败）
```

> **规则：永远不要手改生成物。** 改 `src/`，然后 `npm run gen`。

### 3.2 模块桥：为什么遗留代码还能用全局

原来的 `src/10-app.js` 是**经典脚本**，所以 `var bodies` 是**全局**。
换成 ES module 后，`var bodies` 变成**模块私有**，`globalThis.bodies === undefined`
（已实测确认）。

这会让三样东西同时失效：回归测试驱动、`90-boss.js` 的回调、页内录制器。
它们全都依赖裸全局：`typeof bodies !== "undefined"`、`makeGround(...)`、`stepPhysics(...)`。

对策是 `app/core/module-bridge.ts`：把遗留源码当经典脚本求值，并显式把顶层声明
重新发布到 `globalThis`。这是**行为等价**的（同样的名字回到同样的地方），
因此回归基线继续有效。

**这个桥是临时的。** 阶段 C 会把子系统逐个换成真正的 `import`，桥随之缩小直到删除。

### 3.3 启动顺序是承载语义的

`src/10-app.js` 在**第 19 行**就读 DOM（`document.getElementById('cv')`）。
原来的单文件构建里脚本排在标记之后，所以 DOM 一定先存在。

ES module 的 `import` 会**提升**并在模块体之前求值，所以不能用顶层 `import` 直接加载遗留代码，
否则应用会对着空页面初始化。

因此 `app/main.ts` 分四阶段启动：

1. 注入静态 DOM + CSS（同步）
2. 求值 Matter.js（UMD → 安装 `window.Matter`）
3. 求值 `10-app.js`（经典脚本求值 → 发布全局）
4. 求值 `90-boss.js`

**改动 `main.ts` 时必须保持这个顺序。**

---

## 4. 验证体系

### 4.1 回归测试（安全网）

9 条场景覆盖物理核心：

```
empty-steady  shape-freefall  shape-rest-on-ground  two-shapes-stack  circle-roll
rod-static-anchors  belt-static  rod-anchored-swing  spring-hanging-mass
```

```bash
npm test          # 跑传统单文件构建
npm run test:app  # 跑新 Vite 构建（需先起 npm run preview）
npm run test:both # 两个都跑
```

### 4.2 安全网曾经有个严重盲区（教训，务必保留）

初版 7 条场景**完全无法覆盖杆与弹簧的约束求解**。实测证据：
在 `rodSyncAnchors`（368 行，全项目最大函数）开头注入 `if(1)return false;`，
**7/7 依然全绿**。

根因：`rod-static-anchors` 用 `makeRod(400,300,0,0)` 造杆，而 `makeRod` 把 `B.anc`
置为 `[null,null]`，于是该函数在第二行早退 —— **场景只测到了那个守卫**。

修复：新增 `rod-anchored-swing` 与 `spring-hanging-mass`，走 UI 同款锚定入口。
同样的注入现在**立刻被抓住**。

> **教训：覆盖率不是「有多少条场景」，而是「目标代码有没有真的执行」。**
> 加场景时必须验证它能让目标函数跑起来。

### 4.3 目前仍未覆盖

UI、渲染、BOSS/黑洞状态机、轨迹、面板、公式拼装、绳、传送带牵引。
十个最大函数里，`renderParamPanel`、`buildMatterBody`、`bossBuildPlat`、
`refreshHover`、`applyParam` **没有任何直接场景覆盖**。

---

## 5. 重构进度

### ✅ 阶段 A —— 立骨架（已完成）

- [x] Vite + TypeScript + ESM 骨架
- [x] `World` 状态容器（`app/core/world.ts`）
- [x] 模块桥 + 生成物管线（3 个 `--check`）
- [x] **9/9 回归在旧构建与新构建上同时通过**（硬门槛）
- [x] CI（`.github/workflows/ci.yml`）自动校验上述一切
- [x] README 改写（去掉离线承诺、说明新的访问方式）
- [x] Pages 部署工作流（`.github/workflows/deploy.yml`）

### ⬜ 阶段 B —— 状态收口（进行中）

按耦合度**从低到高**把「直读全局」改成「经 `World` 访问」：

1. 🚧 录制/反馈（`rec`/`bug`，39 声明，最自洽）← **已建立读门面**
2. ⬜ UI 面板
3. ⬜ 器件（传送带/地面/铰链/绳）
4. ⬜ 公式引擎
5. ⬜ 物理核心（最后，风险最高）

**纪律：每迁一个子系统 → 跑 `npm run test:both` → 绿了才继续。**

#### 已落地的模式：读门面（read facade）

第一个迁移的是录制子系统。它的外部耦合**可测量且很小**：
980 行里只引用约 10 个外部全局、共约 58 处。

迁移方式不是去改那 372 处 `bodies` 引用（历史证明那样会改坏物理），
而是给录制器一个**只读快照接口** `world.readView()`。这样做安全的理由是：

- 录制器**只读**世界状态，从不驱动模拟 ⇒ 出错的影响面仅限「录制内容不对」，
  而这会立刻被回放测试发现；
- 它需要容忍字段缺失（原 `recEnv` 就是逐字段 try/catch、缺失填 null），
  因为**录制器绝不能让用户正在报 bug 的页面崩掉** —— 新门面保持了这个容忍度。

**实现要点（踩过的坑）**：门面**必须用 getter**，不能拷贝快照值。
`GRAV`、`bodies`、`W` 在运行时会变，拷贝会静默过期，录制器就会记下错的值。
已验证：附着门面**之后**再建物体 / 改重力 / 改画布宽度，读出来都是新值。


### ⬜ 阶段 C —— 模块边界落地

`physics/`（隔离 Matter）、`formulas/`（可触）、`render/`（可插拔）、`ui/`。
同时把模块桥换成真 `import`，并删除生成物 `legacy-globals.generated.ts`。

### ⬜ 阶段 D —— 可扩展性与产品功能

- **插件式参数注册表**：新增参数只写一处，不再改 4 个分支
- **修复产品痛点**：物块尺寸可直接调（不再要求先挂 `r` 字母）、参数集扩充
- 文档重写

---

## 6. 开发工作流

```bash
npm install
npm run dev            # Vite 开发服务器（热更新）
npm run typecheck
npm run gen:check      # 生成物是否最新
npm run test:both      # 两套构建的回归
npm run build          # 生产构建 -> dist/
```

**提交前**：`npm run gen:check && npm run typecheck && npm run test:both`
应当全绿。（CI 会跑同样的检查。）

---

## 7. 不可动摇的约束

1. **`src/` 是唯一事实来源。** 生成物一律不要手改。
2. **启动顺序**（DOM → Matter → app → boss）不得调整。
3. **每个阶段结束时两套构建都必须 9/9。** 红了就修，不许带病前进。
4. **物理常量与求解器在重构期间不改。** 任何物理行为的变化都必须是**有意的**，
   并且要重新录基线 + 说明理由。
