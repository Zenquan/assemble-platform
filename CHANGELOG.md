# Changelog

> 版本策略见 `docs/VERSIONING.md`。变更归类源自 Conventional Commits（`docs/GIT_GUIDE.md`）。本文件放工程根。
> 格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，按 `## [x.y.z] - yyyy-MM-dd` 分组。

## [0.1.0] - 2026-09-01

Monorepo 技术验证（M1）基线：领域契约 + 干涉算法 + 数学库 + 降级仓储 + 五服务骨架代码。

### Added

- **@assemble/domain**：领域类型单一契约源
  - 几何：`Vec3 / AABB / OBB` 描述；装配：`ProductionLine / Station / AssemblyBom / AssemblyPart / Constraint / AssemblyStep / AssemblyMode`
  - 干涉：`InterferenceReport` 及其质量指标；节拍：`TaktBottleneckResult`
  - 模型资产：`ModelAssetVersion`（内容寻址 + 压缩策略）；权限：`AuthPrincipal / RBAC`
- **@assemble/sim-utils**：纯数学/几何工具
  - `Vec3` 运算、`mat4Multiply / mat4TransformPoint`、`quatSlerp`（约束贴合平滑过渡用）
- **@assemble/clearance-core**：干涉分析核心算法（前后端复用）
  - `Bvh` 空间索引（Broad Phase，中位切分 + self-collision 标准遍历，候选对无重复）
  - OBB-SAT 窄相检测（15 分离轴短路，逐帧无分配）
  - `ClearanceDetector` 门面：`queryInteractive`（交互实时）与 `loadAll + runFull`（离线全量预检）双路径
- **@assemble/storage**：降级仓储层
  - `Repository<T>` 接口 + `InMemoryRepository` / `FileRepository`，`resolveBackend(env)` 按环境回落
- **@assemble/http**：统一响应信封 `ok() / err()`
- **services/**：`assembly / interference / model / takt / auth` 五服务代码骨架（Fastify，含 `GET /healthz`，端口 7101–7105）
- **docs/**：工业级技术方案 + `ARCHITECTURE / CODE_STYLE / GIT_GUIDE / VERSIONING / README`
- 根工程：pnpm workspace + `tsconfig.base.json` + `vitest.config.ts` + `.npmrc(hoisted)`

### Tests

- `@assemble/clearance-core`：OBB-SAT 分离/重叠/接触/斜盒用例；BVH+Detector 集成用例
- 性能回归门禁：200 零部件 `runFull < 200ms`（对齐简历口径，作为后续改动不得突破的阈值）
- `@assemble/sim-utils`：数学工具单测

### Fixed

- BVH `buildNode` 子节点复用父索引导致的**栈溢出** → 改为先 push 空壳占位再递归回填
- `selfIntersect` 遍历产生的**重复候选对与 O(n²) 退化** → 标准 self-collision 三段遍历
- `computeAabbFromObb` 误用 `cx` 算 `y` 导致的**假干涉** → 三行分别用 `cx/cy/cz`
- `storage` 缺 `@types/node` 及 tsconfig `types` 导致的 tsc 失败
- 严格模式 `noUncheckedIndexedAccess` 下数组索引需显式判空 / `!` 断言

---

## [0.2.0] - 2026-09-02

M1 收尾 · 单条产线 Demo —— **后端服务层跑通 + 前端 SimEngine 门面与产线选择页落地**（0.2.x 全半程）。

### Added

- **5 个后端服务全部可 install + build + smoke run**（此前为"代码写好但从未验证可运行"悬空态）：
  - `assembly-svc`(7101)：产线列表/详情/增改，走降级 storage（3 条种子产线）
  - `interference-svc`(7102)：`POST /interference/offline` 离线整线批量干涉预检，调 `clearance-core` BVH+OBB-SAT 真算；`GET /interference/algorithm` 元信息
  - `model-svc`(7103)：资产列表/CDN presign/`POST /model/compress`（draco/meshopt 压缩版本录入演示）
  - `takt-svc`(7104)：`POST /takt/simulate` 节拍瓶颈仿真（taktCore）
  - `auth-svc`(7105)：roles/token/`authorize` RBAC 权限校验（super_admin 放行 / viewer 拒绝）
- 依赖树：pnpm-lock 新增 96 包（fastify 5.12 + @fastify/* + workspace 链接）
- **apps/sim-platform · Vue3 + Vite 前端骨架与产线选择页**（依 `ARCHITECTURE.md §2` 门面放 `src/engine` 而非 packages 共享层）：
  - **SimEngine 门面**（types.ts + noop.ts）：引擎无关窄接口，5 个 Manager（Scene/Asset/Interaction/Assembly/Clearance）；NoopSimEngine 替身：装配状态机 + 实时干涉**委托 clearance-core 真实算法**（无 WebGL、可单测）；后续 Babylon 接入仅替换门面内部实现
  - **产线选择页**（design 稿页面 A）：深色科技扁平，3D 徽标 + 引擎在线 + 过滤芯片（全部/就绪/待检修）+ 产线卡（就绪绿/待检修琥珀/红 干涉告警 + 零部件/干涉预检/预检耗时 KPI + 进度条 + CTA），数据真拉 assembly-svc + interference-svc
  - 装配工作台：路由占位，演示 `createSimEngine()` 工厂注入（待 Babylon 接入替换 canvas）
  - 工程基线：vue3.5 + vue-router4 + vite5 + vue-tsc；dev 代理 `/lines → 7101` `/interference → 7102`
  - 单测 14 例全绿：10 例门面契约 + 4 例健康派生态（ready/attention/disabled 语义锁定）
- 视觉验收截图归档：`docs/line-select-v0.2.0-frontend.png`（含「就绪·无干涉」绿卡 +「待检修·135 干涉」红卡双态）
- interference-svc 冷链线（`kind=cold-chain`）改用全稀疏无 jitter 布局，离线预检稳定 0 干涉
- assembly-svc 启用 `line-cold-01`（冷链预包装线），并把播种逻辑改为按 id 同步 enabled 字段（demo 状态可演进）

### Verified

- 5 服务 `GET /healthz` 均 200
- interference 性能（HTTP 实测）：500 件 19.6ms、**2000 件 33.4ms**，BVH broad phase 剔除率 99.9%（远超 200 件 <200ms 门禁）
- 产线选择页 E2E（playwright 截图）：前端真调通 assembly-svc(`/lines`)+ interference-svc(`/interference/offline`)，KPI（180 零部件 / 135 命中 / 5ms 预检耗时）实时来自 clearance-core；冷链线（cold-chain）实测 0 干涉→「就绪·无干涉」绿卡，绿/红双态真实对照 design 稿 B1/B2
- 根 vitest 23 例回归绿（clearance-core 7 + sim-utils 3 × hoisted 3 + sim-platform 14 独立运行）
- vue-tsc 0 错；vite build 53 modules transformed 0 警告

### Fixed

- `assembly-svc` 声明缺失 `@assemble/http` 依赖（TS2307）
- `assembly-svc` setErrorHandler 显式标注 `error: FastifyError`，消除 fastify v5 `unknown` 类型错
- 根 `vitest.config.ts` 排除 `apps/**`（apps 自带 vite.config 与 `@/*` alias，根仅负责 packages/services 回归）

### Added（出口闭合：浏览器渲染装配 + 0.1.0 保留分支归档）

- **feat(sim-platform · Babylon 最小真渲染 · 闭合 0.2.0 出口「浏览器渲染装配」)**：
    - `engine/babylon.ts` 真渲染后端（替 noop）；`detectWebGL()` 同步特征探测工厂，浏览器返回 `BabylonSimEngine`，无 WebGL（vitest/jsdom/CI）回落 `NoopSimEngine`
    - 工作台视口挂真 Babylon Engine/Scene：`loadLine` 真加载产线，按确定性布局把零件渲成 **OBB 盒体占位** + 暗色地板 + 网格 + ArcRotateCamera（自动质心适配取景）；HUD 显示 `STEP · 3D 装配视口` 与「引擎实时/引擎占位」状态点
    - 范围（用户 grill-me 锁定「最小真渲染：先关门禁」）：只关门禁，**不做**自动/手动/回放三模式真装配、实时干涉拖拽联动、BOM 树/节拍面板、真 glTF 资产管线 —— 全归 0.3.x
    - 架构红线：业务组件仍只经 `SimEngine` 门面，不直引 `@babylonjs/core`；`apps/sim-platform/src/engine/index.ts` 出口统一收口
    - 同步小改：`engine/types.ts` `AssetManager.loadLine(line, bom?)` bom 改可选；`engine/noop.ts` 同步签名
    - 门面契约测试 +1：「BabylonSimEngine 类可被引用」（不实例化以免触发 WebGL），jsdom 回落 noop 路径仍绿
- **api/lines.ts · `fetchLine(id)`**：拉单条产线明细（`GET /lines/:id`），WorkbenchView 真渲染前先拿到产线数据
- **WorkbenchView 真渲染视口**：`onMounted` 异步拉产线 → 工厂注入引擎 → `init({container, line})`；头部徽标 + 引擎状态点；视口内由引擎注入 `<canvas>`；loadError 友好态；右下显式标注「实时干涉/实时联动 归 0.3.x」

### Changed（git 约定归档）

- **git(0.1.0 保留分支)**：按「每个版本/里程碑分支合回 main 后保留不删」约定，为 v0.1.0（M1 技术验证基线）补建保留分支 `feat/0.1.0-baseline`，指向 `2da0421`（引入 Vue 前端代码前的最后提交，`apps/` 内仅存深色科技 design mockup）。此前 0.1.0 内容系一次性线性合进 main、并无独立版本分支；建此分支使 v0.1.0 也可按版本归因与回溯 diff。已保留分支汇总见 `AGENTS.md`。
- 工程基线新增：`@babylonjs/core ^9.23.0`（hoist 到根 node_modules）；`packages/services/*` 子包依赖链路不变。

### Verified（出口闭合）

- **sim-platform 单测 15/15 全绿**（含新增「BabylonSimEngine 类可被引用」契约）：14 + 1
- **vue-tsc 0 错**；**vite build 通过**（8m3s，WorkbenchView chunk 6.8MB / gzip 1.5MB，符合预期告警；Babylon 全量图大）
- **浏览器 E2E 截图**（dev 模式 + playwright chromium + WebGL）：`line-sorting-01` 工作台真渲染盒体装配体居中，HUD「STEP · 3D 装配视口」+「引擎实时」绿点，顶部 header「产线 · 三号分拣线 · 装配工作台」与 SIMULATION WORKBENCH 副标题均正确显示
- 根 vitest 23 例回归绿（clearance-core 7 + sim-utils 3 × hoisted 3 + sim-platform 15 独立运行）

> 注：0.2.0 出口「本地一键起前端+服务」脚本原标"未完成"，已作为 0.2.x 增量在下方 Unreleased 段补齐。

---

<!-- 后续改动按 Conventional Commits 归类追加进 Unreleased，勿手填版本号（由发布流程决定） -->

## [Unreleased]

### Added

- **一键起 dev 脚本 `scripts/dev.mjs`（根 `pnpm dev`）**：解决「vite 代理 `/lines → 7101` ECONNREFUSED」—— 此前 `pnpm dev:platform` 只起 vite 不起后端。自包含 Node 编排（不依赖 pnpm/concurrently），一键拉起 assembly-svc(7101) + interference-svc(7102) + vite(5173)：端口占用自动复用、探活就绪横幅、Ctrl+C/SIGTERM 统一清理子进程；后端产物缺失时报错并引导 build。

### Fixed

- **vite dev 仅绑 IPv6 `[::1]:5173`**（macOS + Node 22 下 `host:'localhost'` 默认行为）导致 Node fetch 走 `127.0.0.1:5173` 失败 → `vite.config.ts` `server.host` 显式设 `'127.0.0.1'`，浏览器与脚本统一访问 IPv4 loopback。验证：`pnpm dev` 后 vite 绑 `127.0.0.1:5173`，`/lines` 经代理返回 200（原 ECONNREFUSED 路径闭合）。

### Added（0.3.0 切片推进）

- **S1 分态渲染（FEAT-20260903-003 第一切片）**：
  - `apps/sim-platform/src/engine/placement.ts`（新）：纯布局数学，按 `SeatInput[]` 推出每件的贴合位 seat（=`AssemblyPart.localPosition`）与确定性散落待料位 scatter（绕装配体质心的 Golden-angle 错峰环 + 抬离顶面）。无 Babylon / DOM 依赖，可被 vitest 无 WebGL 单测锁定。
  - `engine/babylon.ts`：新增 `BabylonScene.setAssemblyState(assembledIds)` 与门面 `BabylonSimEngine.syncAssemblyState()`；`renderParts` 同时保留 seat/scatter 两态位置；状态切换时按 `assembledPartIds` 把已贴合件停 seat、待装配件移到 scatter，并按 seat ∪ scatter 并集重新取景；两态着色：已贴合青、待装配琥珀，强对比避免暗背景下被吞色。
  - `engine/noop.ts`：Noop 端补 `syncAssemblyState()`，按 `assembledPartIds` 镜像返回 `{seated, scattered}`（视觉归属走 Babylon 后端）。
  - `engine/types.ts`：门面接口加 `syncAssemblyState()`（业务在每次装配状态变更后驱动调用）。
  - `views/WorkbenchView.vue`：Babylon 模式加最小 S1 驱动 HUD（已贴合/总数计数 + 装配下一件/撤销装配 按钮，禁用态联动），验证门面 `syncAssemblyState` 通路。
  - `engine/test/placement.test.ts`（新，7 例）：placement 确定性 / seat 一致 / scatter 分离 / 空输入 / 待料环悬空 / `selectActivePoses` 与 `assembledPartIds` 一致 / 撤销回到 scatter。
  - `engine/test/engine.test.ts`：新增 1 例「门面 syncAssemblyState 与装配状态机一致」。

### Verified（0.3.0 S1）

- vue-tsc 0 错；sim-platform vitest **23/23 全绿**（含新增 8 例）；其余 packages（clearance-core 7、sim-utils 3）回归绿。
- 浏览器 E2E 视觉冒烟（一次性编排：起 assembly-svc + interference-svc + vite dev → playwright chromium `--use-gl=swiftshader` → 操作 → 截图归档）：
  - 初始整机贴合 `已贴合 12 / 12`（截图 `docs/s1-render-all-seated.png`）—— 全部青盒、装配下一件禁用、撤销装配可用。
  - 连续撤销 3 次 `已贴合 9 / 12`（截图 `docs/s1-render-split.png`）—— 9 件停 seat（青）、3 件停 scatter 环（琥珀、悬空绕装配体），取景按 seat ∪ scatter 并集重中。验收：渲染集合与 `assembly.assembledPartIds` 严格一致（dom `.s1count` 同步按钮禁用态），两态视觉区分明显。

<!-- 占位：本版已完成 0.2.0 出口闭合与文档归档；后续 0.2.x 增量（一键起脚本等）将由此段起。 -->
