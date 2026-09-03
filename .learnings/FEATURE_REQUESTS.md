# Feature Requests

Capabilities requested by the user.

> 记录用户提出但尚未落地、或值得后续排期的能力。格式遵循 `.agent/skills/self-improving-agent`。

---

## [FEAT-20260902-001] services_install_and_runtime_verify

**Logged**: 2026-09-02T23:00:00+08:00
**Priority**: high
**Status**: resolved
**Resolution**: 2026-09-02T23:40:00+08:00 on branch feat/0.2.0-services-runtime
**Area**: backend

### Requested Capability
把 services/ 下 5 个后端服务（assembly/interference/model/takt/auth）跑通：装依赖 + build + smoke run（healthz 与算法调用），并在 0.2.x 补上服务 README。

### User Context
5 服务代码已在仓内（0.1.x 末尾铺完），但依赖未装/未 build，属于"代码写了但没验证可运行"的悬空状态。

### Complexity Estimate
medium

### Suggested Implementation
按 AGENTS.md 的 pnpm hoisted 命令逐服务 install → `tsc -b` → 起服务 curl `/healthz`；assembly-svc/interference-svc 验证调 clearance-core。

### Metadata
- Frequency: first_time
- Related Features: assembly-svc, interference-svc, model-svc, takt-svc, auth-svc

---

## [FEAT-20260902-002] sim_platform_vue_skeleton

**Logged**: 2026-09-02T23:00:00+08:00
**Priority**: medium
**Status**: resolved
**Resolution**: 2026-09-03T00:10:00+08:00 on branch feat/0.2.0-sim-platform（SimEngine 门面 + 产线选择页就绪；装配工作台为占位；Babylon 接入与清洁就绪产线为下一轮见 FEAT-20260903-001）
**Area**: frontend

### Requested Capability
照 `apps/sim-platform/design/sim-platform-tech-mockup.html` 深色科技稿，搭 sim-platform 前端骨架（Vue3 + Babylon 经 SimEngine 门面），含产线选择页 / 装配工作台。

### User Context
设计稿已定稿落仓，等待落地成可运行前端组件（0.2.x 单产线 Demo 出口）。

### Complexity Estimate
complex

### Suggested Implementation
按 workflow Phase 3 小步实现：SimEngine 门面 → 产线选择页 → 装配工作台；色板抄自 design 稿 CSS 变量。

### Metadata
- Frequency: first_time
- Related Features: sim-platform

---

---

## [FEAT-20260903-001] clean_ready_line_seed

**Logged**: 2026-09-03T00:10:00+08:00
**Priority**: low
**Status**: resolved
**Resolution**: 2026-09-03T00:14:00+08:00 on branch feat/0.2.0-sim-platform（采用走法 a：interference-svc cold-chain kind 改稀疏布局 0 命中 + assembly-svc 启用 line-cold-01 并把播种改为按 id 同步 enabled 字段；E2E 截图 docs/line-select-v0.2.0-frontend.png 确认绿/红双态真实对照 design 稿 B1/B2）
**Area**: data

### Requested Capability
在 interference-svc 种子几何或 assembly-svc 产线中，引入一条「装配良好、离线预检 0 干涉」的产线（例如 `kind=optimized` 或新启一条启用冷链但几何稀疏），使产线选择页能同时呈现 design 稿 B1「就绪·无干涉(绿)」与 B2「待检修·干涉告警(红)」两种真实状态。

### User Context
现 FEAT-002 落地后，产线选择页两端 (`sorting` / `fresh-cut`) 种子几何（synthesizePartsForLine 的 cluster+jitter 策略）确定性命中 0.75·partCount 件干涉，两卡均显示「待检修·135 干涉」。绿态派生态由单测锁定（deriveHealth 0→ready），但 E2E 视觉缺一绿色就绪卡。设计稿页面 A 的 B1/B2 双态对照是 demo 必要组成。

### Complexity Estimate
small

### Suggested Implementation
两个走法任选其一：
  (a) `synthesizePartsForLine` 接收 lineKind 时，对 `cold-chain` 或新 `optimized` kind 改用全稀疏无 jitter 布局（hitCount 始终 0），assembly-svc 种子加一条启用 cold-chain 产线；与现 `kind ∈ {sorting, fresh-cut}` 不冲突。
  (b) 在 assembly-svc 注入一条 BOM 显式声明 0 干涉的产线（前端跳过预检直接 ready），需新增领域字段 `forceReady: boolean` 或等价 precheck-skip 标记。

### Metadata
- Frequency: first_time
- Related Features: sim-platform, interference-svc, assembly-svc

## [FEAT-20260903-002] babylon_minimal_render

**Logged**: 2026-09-03T00:20:00+08:00
**Priority**: high
**Status**: done
**Area**: sim-platform / engine
**Closed At**: 2026-09-03
**Closed By**: feat/0.2.0-babylon-render → main FF-merge
**Branch**: feat/0.2.0-babylon-render

### Requested Capability
以真 Babylon 渲染后端（engine/babylon.ts）替换 Noop，达成 0.2.0 出口门禁「浏览器渲染装配」：工作台视口挂真 WebGL Engine+Scene，`loadLine` 真加载产线并把零件按确定性布局渲成 OBB 盒体占位，配网格/坐标轴 + ArcRotateCamera + HUD(STEP/引擎实时)。

### User Context
用户经 grill-me 确认走法选「最小真渲染：先关门禁」——不在此轮做三模式真装配/实时干涉拖拽（归 0.3.x），先把 0.2.0 出口核销、可发版 tag v0.2.0。

### Complexity Estimate
large

### Suggested Implementation
- apps/sim-platform 加 `@babylonjs/core` 依赖。
- engine/babylon.ts：BabylonScene/BabylonAssets/BabylonSimEngine，复用 NoopAssembler + NoopClearance（非视觉逻辑不重写）。
- 布局与 interference-svc `synthesizePartsForLine` 对齐（同 kind 同确定性命中口径），保证渲染装配体与离线预检视觉一致。
- createSimEngine()：WebGL 可用返 Babylon，否则回落 Noop（vitest/CI 单测不启 WebGL）。
- WorkbenchView 经门面工厂取引擎，视口渲染装配体 + HUD。
- 验收：浏览器打开装配工作台能看到 3D 盒体装配 + 轨道相机可转；截图归档。

### Metadata
- Frequency: first_time
- Related Features: sim-platform, WorkbenchView, SimEngine facade

## [FEAT-20260903-003] 0.3.0_assembly_visual_feedback

**Logged**: 2026-09-03T11:58:00+08:00
**Priority**: high
**Status**: planned
**Area**: sim-platform / engine (babylon) + WorkbenchView + domain
**Milestone**: 0.3.0

### Requested Capability
在 Babylon 真渲染后端上把「装配过程」可视化 —— 让渲染**跟随 `AssemblyController` 的 step/已装配集合**做分态表现，把 0.2.0 已就位的三模式状态机（NoopAssembler 真实逻辑）接到真网格/动画上。产线装配不再是一次性把零件摆到最终位，而是 auto/replay 按 BOM `steps` 逐个把零件从「散落起点」动画到「贴合位」，manual 下可拾取拖拽单件实时过干涉。这是 0.3.0 出口「交互式装配仿真」的门禁。

### User Context
用户在 FEAT-002 明示把「三模式真装配 + 实时干涉拖拽 + BOM 树/节拍面板」归 0.3.x。本轮仅**规划不写码**，把 0.3.0 拆成可独立验收的切片（记入 FEATURE_REQUESTS + 任务看板），等用户选定推进顺序。

### 现状基线（已就位，勿重复做）
- `NoopAssembler`（noop.ts）：真实三模式状态机 —— mode/step/assembled 集合、load 清空、switchMode(带拒绝语义)、assemble(严格按 steps 序)、undo、play/pause、seekTo、checkPlacement(委托 clearance)。**纯逻辑无渲染依赖，可单测，0.3.x 不必重写。**
- `NoopClearance`（noop.ts）：真实委托 clearance-core（registerAssembled 建 BVH / queryInteractive 返回 hits / runFull 出标准报告）。**复用，不重写。**
- Babylon 后端复用 NoopAssembler+NoopClearance；`renderBoxes` 现一次性把所有零件摆到 `AssemblyPart.localPosition`（贴合位）。**缺分态/动画。**
- domain：`AssemblyPart.localPosition/localRotation`=贴合基准位；`AssemblyStep{seq,partId,constraintIds,durationSeconds,description}`=自动/回放最小单元（durationSeconds 可作动画时长）。
- 业务只能经 `SimEngine` 门面访问，禁止直引 Babylon。

### Complexity Estimate
large（拆 4 切片，各自 small~medium，见下）

### Slicing（各自可独立验收）
- **S1 · 分态渲染（最小、建议首做）**：BabylonScene 把每条产线的零件分成「已贴合/待装配」两态。已贴合零件在 `localPosition` 常驻；待装配零件停驻在**确定性散落起点**（相对原位的偏移/上浮），由 `assembledPartIds` 驱动归属切换。验收：切换 mode/assemble 后渲染的贴合/散落集合与 `assembly.assembledPartIds` 一致（截图+单测）。
- **S2 · 装配过程动画（auto/replay）**：auto 按 `bom.steps` 顺序、用 `durationSeconds` 做「散落→贴合」位姿过渡；`seekTo(step)`/`undo` 支持跳变（取消动画直达）。replay 复用同动画按需回放 + `description` 字幕位。验收：play 后零件逐个贴合、seek/undo 正确（截图 + 无 WebGL 单测走 Noop 状态断言）。
- **S3 · 交互拾取与实时干涉拖拽（manual）**：Babylon InteractionManager 接射线拾取（pointer → 网格命中）+ `dragTo` 更新零件位姿；拖拽中持续调 `clearance.queryInteractive`，命中零件变红/拦截，`endDrag` 用 `checkPlacement` 裁决落位。验收：浏览器拖拽零件与已装配件干涉时变色/无法贴合（E2E 截图）。
- **S4 · BOM 树 + 节拍面板（HUD）**：Workbench 侧栏展示 `bom.parts/steps` 层级与当前 step 高亮、选中零件联动视图；节拍数据接 `takt-svc`。验收：UI 展示 + 与装配态联动。（此切片偏 UI/数据，可与 S1-S3 并行。）

### Non-Goals（0.3.0 不做，留 0.4+）
- 真 glTF 资产管线（AssetManager.loadLine 的 bom 分支、model-svc 真模型下发）——仍合成 OBB 盒体占位。
- 装配约束的**几何解算/贴合吸附**（Constraint 仅作步骤说明，不参与平移旋转求解）。
- 多用户协同装配会话。

### Metadata
- Frequency: first_time
- Related Features: WorkbenchView, SimEngine facade, babylon.ts, noop.ts, clearance-core
- Branch (later): feat/0.3.0-<slice>（每切片可独立合 main 保留分支）
