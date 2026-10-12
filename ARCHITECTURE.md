# ARCHITECTURE.md — physand 架构与重构说明

> 设计理念：**让物理可见，让公式可触。**
> *Physics you can see. Formulas you can touch.*

这篇文档说明项目**现在**是什么结构、**为什么**是这么结构、以及重构**走到哪一步**。
它是重构期间的唯一权威说明；`MODULARIZATION.md` 是重构前的分析报告（保留作历史依据）。

---

## 0. 一句话现状

项目正处于**从「手工拼接的单文件」到「现代 Web 应用」的渐进式迁移**中。

**两套构建目前并存，且都通过全部 17 条回归测试：**

| 目标 | 命令 | 产物 | 状态 |
|---|---|---|---|
| 传统单文件 | `npm run legacy:build` | `index.html` | ✅ 17/17 通过 |
| 新架构 | `npm run build` | `dist/` | ✅ 17/17 通过 |

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

对策是 `app/core/module-bridge.ts`：把遗留源码当经典脚本求值，并显式把顶层声明
重新发布到 `globalThis`。

#### ⚠️ 发布必须是**活的访问器**，不能是一次性快照

`new Function` 给源码的是**函数作用域**，所以它的 `var x` 是包装函数里的**局部绑定**。
因此「求值完把值拷到 `globalThis`」这种写法会发布一份**快照**，并有两种截然不同的后果：

| 类型 | 后果 |
|---|---|
| 对象 / 数组（如 `bodies`） | **看起来正常** —— 快照持有同一引用，应用在原地改 |
| 标量（如 `paramBody`、`W`） | **静默过期** —— 应用内部重新赋值后，全局那份不再更新 |

第二种是实际踩到的坑：`openParams()` 设置好内部的 `paramBody`，但 `window.paramBody`
仍然读到 `null`；而传统单文件构建（那里 `var` 真的是全局）报告的是新值。
**任何通过全局面读取状态的消费者都会被悄悄骗过**，包括回放测试。

现在改为发布访问器（getter/setter），全局名恒定绑定到活的局部变量，
完整复现经典脚本语义。`app/core/module-bridge.test.ts` 有 7 条测试锁住这些性质，
其中「标量保持同步」那条经实测确认能抓住快照版本的实现。

#### 内部函数必须**在作用域内**挂钩，不能事后打补丁

同样的原因：`openParams` 调用的是**闭包里的** `paramDef` 绑定，不是 `window.paramDef`。
实测证据（把全局换成必定返回非空的桩函数）：

```js
window.paramDef = () => ['wmass'];
openParams(square);          // 仍然早退，面板毫无变化
```

所以参数注册表的挂钩（`app/core/panel-hooks.ts`）是以 **epilogue 源码**的形式
注入到同一个作用域内执行的，那里重新赋值局部绑定才是内部调用者真正看到的东西。

> **这两条合起来是本项目最容易踩的架构陷阱**：改 `main.ts` 或模块桥时务必先读本节。


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

17 条场景覆盖物理核心：

```
empty-steady  shape-freefall  shape-rest-on-ground  two-shapes-stack  circle-roll
rod-static-anchors  belt-static  rod-anchored-swing  spring-hanging-mass
shape-resize-scaled  shape-resize-identity
shape-stretch-width  shape-stretch-identity  shape-fixed-holds
spring-soft-sag  spring-stiff-sag  rod-length-changed
```

另有 **81 条单元测试**覆盖新模块的不变量（参数注册表、模块桥的发布语义）：

```bash
npm run test:unit # 新模块单测（最快，先跑）
npm test          # 回归：传统单文件构建
npm run test:app  # 回归：新 Vite 构建（需先起 npm run preview）
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

### 🚧 阶段 B —— 状态收口（进行中）

按耦合度**从低到高**把「直读全局」改成「经受控访问层」：

| # | 子系统 | 状态 |
|---|---|---|
| 1 | 录制/反馈（`rec`/`bug`） | ✅ 读门面（`world.readView()`） |
| 2 | **参数子系统**（37 个参数） | ✅ **全部改走 `core/legacy.ts` 类型化桥** |
| 3 | UI 面板 | ⬜ |
| 4 | 器件（传送带/地面/铰链/绳） | ⬜ |
| 5 | 公式引擎 | ⬜ |
| 6 | 物理核心（最后，风险最高） | ⬜ |

**纪律：每迁一个子系统 → 跑 `npm run test:both` → 绿了才继续。**

#### 已落地的模式二：类型化遗留桥（`core/legacy.ts`）

参数子系统搬迁时暴露出一个新架构自身的坏味道：4 个参数模块里散着 **20+ 处**
`(globalThis as any).X` 强转，写法还各不相同（有的 `as any`、有的索引、有的属性访问）。
这正是遗留代码积累出 211 个全局的**同一种做法**，只是换了个地方重演。

桥把访问收成一处，解决三个问题：

1. **有了唯一可审计的依赖清单** —— 新架构到底依赖遗留哪些东西，一眼可见
2. **有真实类型** —— 名字写错（`PHYS_MODE` vs `PHYSMODE`）是**编译错误**，
   而不是运行期静默拿到 `undefined`
3. **有一处可插桩** —— 排查耦合问题时不用满仓找

**未启动时优雅降级**：这些访问器也被单元测试使用（那时根本没有遗留应用），
所以缺失状态返回中性默认值而不是抛错。否则每个参数模块都无法独立测试。

> 桥会随着阶段 C 逐步**缩小** —— 文件变短本身就是进度指标。

#### 架构守卫（防止纪律悄悄退化）

`app/core/architecture.test.ts` 里 4 条测试**不测行为，测架构约束**。
它们守的是「坏了也不会报错的」规则：

| 守卫 | 防的是什么 |
|---|---|
| 只有 `legacy.ts` 能直读全局 | 20+ 处散乱强转再次蔓延 |
| 参数模块不得自定义访问器 | `constant`/`call` 助手曾在两处重复实现（会漂移） |
| 每个参数模块必须被 `main.ts` 导入 | 漏导入 ⇒ 注册不执行 ⇒ 面板静默少行（**已经真实发生过一次**） |
| 生成物必须带「generated」头 | 手改生成物会被下次 `npm run gen` 悄悄覆盖 |

> 守卫不是空转的：往 `w-body.ts` 注入一行 `(globalThis as any).X` 会被**立刻抓出**。

#### 已落地的模式一：读门面（read facade）

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

- ✅ **插件式参数注册表**（`app/core/param-registry.ts`，13 条单测）
- ✅ **W 体参数已迁移并接入真实面板**（`app/params/w-body.ts`，18 条单测）
  - 面板从 **4 行** 扩到 **8 行**：质量 / 摩擦 / 弹性 / 空气 / **尺寸 / 宽度 / 高度 / 固定**
  - 宽高独立 ⇒ 可以把方块拉成长条（等比 `scale` 做不到）
  - 「固定」原本只在右键**菜单**里，现在参数面板也能开
- ✅ **器件参数已迁移**（`app/params/devices.ts`，15 条单测）
  - 弹簧 `k` / `L₀` / 阻尼 D、杆长 / 杆质量、绳长、固定铰链、地面长/角、带速/带角
  - 写入一律走**既有咽喉**（`springSetLen` / `setRodLen` / `setGroundEnds` / `setBeltAngle`），
    而不是裸写字段 —— 裸写会让物体「看得见、摸不着」（R98-1 实测杆的碰撞板停在旧宽度）
- ✅ **公式 / 场源参数已迁移**（`app/params/formula.ts`，10 条单测）
  - 质量 m / M（**两个不同量**：`B.mass` vs `B.massCap`）、重力 g、加速度 a、弹性、摩擦
  - 场源 B / E / I 各自强度
  - 重力是**全局量**：写 `GRAV` + Matter `engine.gravity.y`，不写本体私有覆盖
- ✅ **赋子型参数已迁移**（`app/params/grants.ts`，配合上述共 65 条单测）
  - `v`/`a`/`q`/`t` 四个字符携带的值（大小 + 方向），以及已赋予本体的加速度矢量
  - **dock 模板 vs 世界里字符**的区别被显式实现：dock 态只写 `CHAR_DEF`（外观默认值），
    不写回单例 —— 否则「改一个 v，之后拖出来的全变了」（R132-9d 用户原话）
  - 这 6 个是**字母专属**参数，`scope` 恒 false，避免从本体面板多出一遍重复行
- ✅ **参数迁移完成**：34 个遗留参数 + 3 个新增 = **注册表 37 个**
  - 有一条测试**直接对比遗留 `PARAM_DEFS` 表**，断言无遗漏 —— 漏掉一个参数会让面板
    静默少一行且毫无报错，正是这条测试要防的
- ⬜ 参数集继续扩充（密度、静/动摩擦分离、材质预设等）
- ⬜ 文档重写

#### 已落地的产品改进

| 改进 | 机制 |
|---|---|
| 物块可调大小 | `scale` 不再要求先挂 `r` 字母（配 `applyInkScale` 修好崩溃与真正缩放） |
| 宽 / 高独立 | 新增 `wscaleX` / `wscaleY`，与 `scale` 相乘、可逆不累积 |
| 固定开关 | `wfixed` 把原本只在菜单里的能力搬到参数面板 |
| 圆形/弧不出宽高 | `scope.when` 排除——碰撞壳与渲染都按 `rad` 画正圆，硬拉会让「看到的」和「撞到的」分家 |
| 器件参数进注册表 | 弹簧/杆/地面/传送带各 2–3 个旋钮，读写与物理同源 |

> 每个新参数**各自只写一处声明**即完成定义、显示条件、读取、写入 —— 这正是注册表要证明的事。

#### 参数注册表：为什么它能根治「改了没反应」

原设计里新增一个参数要改**四处**：`PARAM_DEFS`（规格）、`paramDef()`（哪些物体显示）、
`paramV()`（怎么读）、`applyParam()`（怎么写）。**漏掉「怎么读」是一个反复出现的用户可见 bug** ——
源码注释里至少记录了三处同名事故，每次都表现为「我改了值但没反应」：

| 参数 | 事故 |
|---|---|
| `sk` / `slen` | R61：「默认劲度系数没改变」 |
| `rlen` | R101⑦：「同 sk/slen 的专用字段纪律」 |
| `convspeed` | R99：「同弹簧 B.ks 的陷阱」 |
| `waccang` | 定义了、读写分支全有，**却从没进过显示清单** ⇒ 用户根本够不着 |

注册表把四处合一：`read` 与 `write` 是同一个声明的必填字段，
**TypeScript 让「只定义不实现」无法编译**。`scope` 跟着参数走，
所以新增旋钮不再需要改中央的 `if/else` 分发。

已用 `app/core/param-registry.test.ts`（13 条）锁住这些不变量，包括
「面板里可见 ⇒ 必然可读可写」这条 `waccang` 事故的回归测试。

> 这也直接解决用户的第二个痛点：W 体无字母时只有 4 个旋钮，且尺寸只有在挂了 `r`
> 字母时才出现 —— 根因正是 `scope` 被硬编码在中央分发函数里。


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
