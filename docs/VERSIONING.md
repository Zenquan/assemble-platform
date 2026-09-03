# VERSIONING —— 版本计划与发布策略

> 目标：把《工业级 Web3D 技术方案》第 10 章的里程碑（M1–M5），翻译成一套**可执行、可追溯、语义化**的版本演进计划。用版本号回答「做到哪了、下一步做哪块」。

## 1. 版本策略：SemVer + 里程碑映射

采用 **语义化版本 (SemVer 2.0)**：`主.次.修订`。

| 变更类型 | 版本号影响 | 示例 |
|----------|-----------|------|
| 破坏性 / 不兼容 API、架构级重构 | `主版本 +1` | 后端服务拆服务、SimEngine 对外接口不兼容 |
| 向后兼容的新功能 | `次版本 +1` | 新增「剖切面」能力、接入新产线类型 |
| Bug 修复 / 内部优化（无新功能） | `修订 +1` | 干涉误报修复、加载缓存优化 |

**约定**：
- `0.x` 阶段：`0.1` 起步，功能激进演进，**次版本即可含破坏性变更**（内部早期，团队共识）。
- `1.0.0` 才对外声明「平台化接口冻结」，此后严格遵守 SemVer。
- 每个发布都打 tag、写 `CHANGELOG`，变更来自 Conventional Commits（见 `GIT_GUIDE.md`）。

### 版本演进路线（对齐 M1–M5）

| 版本 | 对应里程碑 | 定位 | 主要交付 | 出口门禁 |
|------|-----------|------|----------|----------|
| **0.1.x** | M1 技术验证 | 算法/骨架地基（**当前仓库所处**） | `@assemble/domain` 类型契约、`clearance-core` 干涉算法(BVH+OBB-SAT)、`sim-utils` 数学库、`storage` 降级仓储、Monorepo 根工程 | 单测全绿；200 件 <200ms 基准用例通过 |
| **0.2.x** | M1 收尾 | 单条产线可用 Demo | 前端 `sim-platform` 装配三模式、SimEngine 门面、5 个后端服务骨架可起、产线选择页 | 本地一键起前端+服务；浏览器渲染装配 |
| **0.3.x** | M2 MVP | 首条产线闭环 | 自动/手动/回放真装配、实时+离线干涉协同、节拍服务、模型管线 CLI、基础鉴权 | 产线工程师试用通过（验收= M2） |
| **0.4.x** | M3 平台化 | 多产线复用 | 产线模板抽象、接入第 2/3 产线、资产库、性能优化落地 | 3 类产线复用；资产复用 ≥70% |
| **0.5.x** | M4 加固 | 工业级能力 | HA 部署编排、RBAC/审计/加密/容灾、监控告警、测试与基准体系 | 上线 Checklist（方案第 10 章）全过 |
| **1.0.0** | M5 | 试点上线 | 平台接口冻结、真产线灰度、运营支撑 | "建模到上线 ↓50%" 验证通过 |

> 当前仓库版本基线：根 `package.json` 记为 `0.2.0`，对应上方 `0.2.x` 行（`v0.2.0` tag 已发）。版本号统一由**根包**号代表「平台整体版本」，各 workspace 包随发布同步主版本（早期用同一主版号更易管理）。
>
> 进度注记：**0.2.0 出口两门禁均已闭合** —— 「浏览器渲染装配」由 `engine/babylon.ts`（FEAT-20260903-002）达成；「本地一键起前端+服务」由 `scripts/dev.mjs`（`pnpm dev`）达成（见 CHANGELOG Unreleased）。**0.3.0 已开切**（FEAT-20260903-003，4 切片）：S1 ✅、S2 ✅；S3 交互拾取与实时干涉拖拽、S4 BOM 树 + 节拍面板 待推进。详见「0.2.x → 0.3.x」切片表。

## 2. 各阶段（0.x）的工程内落地指引

### 0.1.x —— M1 落地指引（已交付，v0.1.0）
- 每个 `packages/*` 需能 `build` + `typecheck` + `test` 独立通过。
- `clearance-core` 是算法核心：任何改动必须带单测，新增几何用例进 `test/`。
- 领域类型（`@assemble/domain`）是全工程契约，改动波及面大——**优先向后兼容**（加字段而非改删）。

### 0.2.x → 0.3.x —— 功能期
- 前端只经 `SimEngine` 门面访问 Babylon，**业务代码禁止直引 `@babylonjs/core`**（架构红线，见 `ARCHITECTURE.md`）。
- 后端服务之间不直接 `import`，走网关 HTTP / 消息；跨服务数据结构用 `@assemble/domain` 校验。

#### 0.3.0 切片（Slicing，FEAT-20260903-003）

| 切片 | 主题 | 状态 | 落点 | 验收 |
|------|------|------|------|------|
| **S1** | 分态渲染：已贴合/待装配两态摆位，由 `assembledPartIds` 驱动 | ✅ done（v0.3.0 S1） | `engine/placement.ts`（纯布局）+ `engine/babylon.ts` `setAssemblyState` + 门面 `syncAssemblyState()` | 切换后渲染集合与 `assembledPartIds` 一致；`docs/s1-render-{all-seated,split}.png` 归档 |
| **S2** | 装配过程动画（auto/replay 散落→贴合，seek/undo 跳变） | ✅ done（v0.3.0 S2） | `engine/ease.ts` + `engine/animator.ts`（纯逻辑驱动器）+ `engine/babylon.ts` `applyFlightPose`/`scene.onFrame` 渲染接缝 + 门面 `playAssembly/pauseAssembly/resetForPlay/animState` | 散落→贴合逐件平滑（easeInOutCubic + `durationSeconds`）；seek/undo 走跳变；`docs/s2-{reset-all-pending,mid-flight,all-seated}.png` 归档；纯逻辑单测 5/5、门面 2/2 |
| S3 | 交互拾取与实时干涉拖拽（manual） | pending | 任务 #37 | E2E 拖拽与已装配件干涉时变色/无法贴合 |
| S4 | BOM 树 + 节拍面板（HUD） | pending | 任务 #38 | UI 展示 + 与装配态联动 |

> Non-Goals（0.3.0 不做，留 0.4+）：真 glTF 资产管线、装配约束几何解算/贴合吸附、多用户协同装配会话。

### 0.5.x → 1.0.0 —— 冻结期
- 评审任何「破坏性变更」：需在版本计划里显式登记，通常积压到下一主版本。
- `1.0.0` 冻结前完成契约快照（openapi / type 文档）。

## 3. Changelog 约定

`CHANGELOG.md` 放工程根，用 Keep a Changelog 风格，按 `## [x.y.z] - yyyy-MM-dd` 分组：

```markdown
## [0.1.1] - 2026-09-02
### Fixed
- 修复 BVH 构建索引复用导致的栈溢出
- 修复 AABB 推导 y 轴写错导致的假干涉

## [0.1.0] - 2026-09-01
### Added
- @assemble/domain：领域类型契约
- @assemble/clearance-core：干涉分析（BVH + OBB-SAT）
- ...
```

**版本号来源**：每个合并的 PR 通过 Conventional Commit 的类型（`feat`/`fix`/`breaking!`）自动归类，见 `GIT_GUIDE.md`。CI 可据此生成候选 changelog。

## 4. 版本操作速查（pnpm）

```bash
# 查看 workspace 内所有包版本
pnpm -r list --depth -1

# 只给某个包升修订版
pnpm --filter @assemble/clearance-core version patch

# 打整体版本 tag
git tag v0.1.0 && git push origin v0.1.0
```

> 注：本环境 pnpm 需以 `node <corepack>/pnpm.cjs` 方式调用，见 `../docs` 提示或项目根说明。
