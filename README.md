# physand

一个**单文件**的网页物理沙盒。在画布上画线、画形状，画出来的东西会变成真正的刚体；再把物理符号（`m` `g` `v` `a` `q` `t` …）拖到一起拼成公式（`mg`、`mv²/2`、`GMm/r²` …），公式就会真的作用到物体上。

- **全部内容就是一个 `index.html`**：HTML、CSS、JavaScript（含内联的 Matter.js v0.20.0）都在里面。下载下来双击用浏览器打开即可**离线**运行，不用安装、不用联网。

---

## 本项目是重构版

> **`physand` 基于 [Da0Mine/physics-sandbox](https://github.com/Da0Mine/physics-sandbox) 重构。**
>
> - **原作者**：[@Da0Mine](https://github.com/Da0Mine) —— 产品的设计、全部物理实现、以及那套 bug 反馈机制都是他做的。
> - **原项目**：<https://github.com/Da0Mine/physics-sandbox>（MIT License）
> - **原在线地址**：<https://physics-sandbox-881.pages.dev/>
> - **原 Bug 清单**：<https://sandbox-bug-api.pages.dev/?k=1c7de3af43df0615f9ee8a95c3c7467493762ce75b07d0dc>
>
> **本仓库做的改动**：把 20,175 行的单文件拆成 `src/` 源码树、加上构建管线与回放回归测试。
> 产品功能与物理行为**保持逐字节一致**（构建是字节精确的，回归测试 100% 通过）。
> 详见 [MODULARIZATION.md](MODULARIZATION.md) 与 [MODULES.md](MODULES.md)。

原项目的 bug 清单与贡献指引依然有效，见下。

---

## Bug 反馈

**总 bug 汇总清单 —— 所有提交过的问题都记在这里（原项目维护）：**

<https://sandbox-bug-api.pages.dev/?k=1c7de3af43df0615f9ee8a95c3c7467493762ce75b07d0dc>

- 这是**总 bug 汇总清单**。每条包含提交时间、提交时的描述，以及一份**录屏 JSON**（点该条右侧的「原始 JSON」即可下载；文件里逐帧记录了当时场上的物体、字母、速度以及全部操作事件）。
- **部分已修复的 bug 已在网页的 bug 列表里标明**。位置：打开沙盒页面 → 左上角工具栏 → 「设置」→「Bug 记录」→「Bug 修复列表」，每条 bug 都标了状态 —— **已修复 / 待修复 / 待提交 / 未判定**。状态为「已修复」的，表示该问题在当前版本已经解决。
- 引用或讨论某一条时，直接说**编号**即可（就是那串 13 位数字，它同时也是这条反馈提交时的毫秒时间戳）。

## 欢迎有余力的开发者一起修

上面的清单里还有大量条目处于「待修复 / 未判定」，**非常欢迎有余力的开发者挑几条帮忙修**：

1. 在清单里挑一条，点它的「原始 JSON」把录屏下载下来；
2. 照那条的操作步骤复现。JSON 里逐帧记了每一步操作和当时的物理量，照着走基本能还原现场；
3. **改 `src/` 下的文件**（不是 `index.html`，它是构建产物），然后跑构建和回归测试；
4. 提 Pull Request，写清你修的是清单里的哪个编号、复现步骤、以及为什么这么改。

如果你只是想反馈问题，直接在沙盒页面里打开左上角工具栏的「设置」→ 点「开始记录」→ 照常操作复现 → 点「停止并导出」→ 在「提交 Bug 记录」里提交即可，会自动出现在上面的清单里。

---

## 文件

**给用户：只需要 `index.html`。** 下载这一个文件，双击用浏览器打开即可离线运行。

| 文件 | 说明 |
|---|---|
| `index.html` | **全部内容，单文件、离线可跑。** 这是分发产物 |
| `src/` | 开发用源码（构建 `index.html` 的来源） |
| `MODULES.md` | 代码地图：20,175 行代码的章节索引 + 90 个 R 修订编号定位 |
| `MODULARIZATION.md` | 模块化拆分方案（含依赖分析证据） |
| `tools/` | 构建 + 回归测试工具链，见 [tools/README.md](tools/README.md) |

### 开发者注意

`index.html` 现在是**构建产物**，不要直接改它 —— 改动会在下次构建时被覆盖。

```bash
node tools/build.mjs --check   # 确认 src/ 与 index.html 一致
# 改 src/ 下的文件，然后：
node tools/build.mjs           # 重新生成 index.html
bash tools/run.sh replay.mjs   # 跑回归测试，确认没改坏物理
```

构建是**字节精确**的：`src/` 拼回来的 `index.html` 与手工维护时逐字节相同。

## 第三方

`index.html` 内联了 [Matter.js](http://brm.io/matter-js/) v0.20.0（MIT License，(c) Liam Brummitt / brm.io），用于绘制体（画出来的墨迹与形状）的刚体物理。

## 许可证

MIT License，见 [LICENSE](LICENSE)。原版权归 [@Da0Mine](https://github.com/Da0Mine) 所有。
