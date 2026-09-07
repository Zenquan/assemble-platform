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
| **0.1.x** | M1 技术验证 | 算法/骨架地基（已交付） | `@assemble/domain` 类型契约、`clearance-core` 干涉算法(BVH+OBB-SAT)、`sim-utils` 数学库、`storage` 降级仓储、Monorepo 根工程 | 单测全绿；200 件 <200ms 基准用例通过 |
| **0.2.x** | M1 收尾 | 单条产线可用 Demo | 前端 `sim-platform` 装配三模式、SimEngine 门面、5 个后端服务骨架可起、产线选择页 | 本地一键起前端+服务；浏览器渲染装配 |
| **0.3.x** | M2 MVP | 首条产线闭环 | 自动/手动/回放真装配、实时+离线干涉协同、节拍服务、模型管线 CLI、基础鉴权 | 产线工程师试用通过（验收= M2） |
| **0.4.x** | M3 平台化 | 多产线复用 | 产线模板抽象、接入第 2/3 产线、资产库、性能优化落地 | 3 类产线复用；资产复用 ≥70% |
| **0.5.x** | M4 加固 | 工业级能力 | HA 部署编排、RBAC/审计/加密/容灾、监控告警、测试与基准体系 | 上线 Checklist（方案第 10 章）全过 |
| **1.0.0** | M5 | 试点上线 | 平台接口冻结、真产线灰度、运营支撑 | "建模到上线 ↓50%" 验证通过 |

> 当前仓库版本基线：根 `package.json` 与 `apps/sim-platform` 记为 `0.4.1`，对应下方 `0.4.x` 行（`v0.4.1` tag 已发；0.4.0 里程碑未单独发 tag，与 0.4.1 一并归档）。版本号统一由**根包**号代表「平台整体版本」，各 workspace 包随发布同步主版本（早期用同一主版号更易管理）。
>
> 进度注记：**0.2.0 出口两门禁、v0.3.0（M2 MVP）均已闭合发布**；**0.4.x（M3 平台化）已发布 v0.4.1**：真实 GLB 资产管线、净菜多产线（分拣 / 净菜 / 冷链 3 类 `kind`、5 条种子线共享 13 个 GLB 资产库）、后端归属 BOM / 节拍 / 物料流转、CloudBase 单容器 Git 部署。出口门禁「3 类产线复用」已具备；「资产复用 ≥70%」以资产库多线共享落地，度量口径已在 0.5.x 固化为可执行指标（`pnpm metrics`，复用率 75% 达标）。进入 **0.5.x（M4 加固期）**。
>
> **0.5.x（M4 加固）进行中**，已落地三个方向：
> - **测试与基准体系**：CI 门禁链（GitHub Actions，push/PR 自动 `build:all`+`typecheck:all`+`test:all`）、覆盖率门禁（核心算法包 lines/functions/statements ≥80%、branches ≥75%）、性能基准独立化（`pnpm bench` 产出可对比 JSON，`runFull.200 <200ms` 门禁）、资产复用率度量（`pnpm metrics`，复用率 75% 达标）+ E2E 视觉回归骨架。详见 `TESTING.md`。
> - **监控与可观测性**：新增 `@assemble/observability` 纯 TS 指标库；5 服务接入 `/metrics` 与 `X-Request-Id` 跨服务透传；gateway 结构化访问日志 + `/metrics` 聚合 5 上游 + `/telemetry`；前端 `SimMonitor` 埋点（Web Vitals / FPS / 内存）节流批量上报。详见 `OBSERVABILITY.md`。
> - **RBAC/审计/加密（安全加固）**：新增 `@assemble/security` 共享库（HS256 JWT + AES-256-GCM + RBAC 矩阵 + 审计哈希链）；auth-svc 真实 JWT 签发与不可变审计；gateway 本地验签 + 路径权限映射（401/403）；前端凭证注入与 401 处理。详见 `SECURITY.md`。
> - 剩余方向：HA 部署编排、容灾与告警推送（告警阈值已在 `OBSERVABILITY.md` 预留，接入留 HA 方向）。

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
| **S3** | 交互拾取与实时干涉拖拽（manual） | ✅ done（v0.3.0 S3） | `engine/drag.ts` `ManualDragSession`/`rayPlaneYIntersect` + `engine/babylon.ts` `BabylonInteraction`（scene 拾取/平面/高亮/相机挂起原语 + 真 pointer 监听）+ 门面 `dragState: DragLiveState` + WorkbenchView 拖拽状态 HUD chip；S3b clearance 集合同步置 `syncAssemblyState` | 拖拽与已装配件干涉时变红拦截、贴近 seat 无干涉可贴合、严格步骤序；`docs/s3-drag-{begin,blocked,landed}.png` 归档；纯逻辑 13/13、门面 3/3 |
| **S4** | BOM 树 + 节拍面板（HUD） | ✅ done（v0.3.0 S4；0.4.x 改为后端归属） | `engine/bomtree.ts` 按 `AssemblyStep.stationId` 归组 + `deriveBomTreeState` 状态标注 + `engine/taktpanel.ts` `deriveTaktPanel` + `api/takt.ts` `fetchTaktSimulation` POST `/takt/simulate` + `components/{BomTreePanel,TaktPanel}.vue` + WorkbenchView 接线 | BOM 树随所选流水线后端 BOM 动态分组、当前 step 在所属工位高亮、done ✓ / pending · / 基座徽 + 点选视口联动；节拍目标、开动率和负荷由 takt-svc 基于 assembly-svc 工位数据返回 |

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
