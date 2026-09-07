# Changelog

> 版本策略见 `docs/VERSIONING.md`。变更归类源自 Conventional Commits（`docs/GIT_GUIDE.md`）。本文件放工程根。
> 格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，按 `## [x.y.z] - yyyy-MM-dd` 分组。

## [Unreleased]

<!-- 0.5.x M4 加固期变更将从此处开始累积 -->

### Added

- 干涉处理闭环：产线卡「处理干涉」进入工作台后展示真实命中清单，支持 3D 定位/红高亮、重新预检与跳转产线配置调整工位位置/朝向后再复检。
- `@assemble/domain` 新增 `MODEL_ASSET_BOUNDS` 内置 GLB 实测包络元数据，替换离线预检合成 OBB 夹具。
- `clearance-core` 新增 `obbFromBomPart`：按 Babylon 装配挂载口径，把 BOM 位姿 + 资产包络转成世界 OBB。
- 产线配置中心工位表支持显式 X/Y/Z 安装锚点与朝向编辑；保存后回到工作台可重新预检。
- assembly-svc 新增 `GET /lines/:id/layout-suggestions`：对真实命中自动计算可回填的工位位置建议；配置中心点「自动计算避让」回填后点保存即完成避让。
- CI 门禁链落地（`.github/workflows/ci.yml`）：`push`/`pull_request` 自动跑 `build:all` + `typecheck:all` + `test:all`，失败阻断合并；根脚本新增 `ci`/`build:all`/`typecheck:all`/`test:all` 聚合入口。
- 覆盖率门禁（`pnpm test:coverage`，已并入 CI）：核心算法包 `clearance-core`/`sim-utils` 强制 lines/functions/statements ≥80%、branches ≥75%；补齐 `sim-utils` 数学库与 `clearance-core` 几何/交互路径单测，整体 lines 达 98.94%。
- 性能基准独立化（`pnpm bench`，已并入 CI）：`scripts/bench-clearance.mjs` 产出可对比 JSON 报告（median/p95 + 上次 delta），覆盖 OBB-SAT 微基准、BVH 构建、runFull 200/500 件、broad 自交与 queryInteractive 实时路径；门禁 `runFull.200 median < 200ms`。
- 资产复用率度量固化（`pnpm metrics`，已并入 CI）：`scripts/metric-asset-reuse.mjs` 把 M3「资产复用 ≥70%」固化为可执行指标（复用率 = 首条线设备资产被其它产线复用的比例），当前 3/4 = 75% 达标。
- E2E / 视觉回归骨架（`pnpm e2e`，本地工具）：根 `playwright.config.ts` + `e2e/line-select.spec.ts`，mock 后端 fixture 渲染产线选择页，冒烟断言 + `toHaveScreenshot` 截图基线。
- 监控与可观测性需求共识文档（`docs/OBSERVABILITY.md`）：request-id 链路、`/metrics` 指标、结构化访问日志、前端 SimMonitor 埋点四块轻量自研方案 + 数据流图与 M1–M3 实施切片。
- 可观测性 M1（指标库 + request-id + `/metrics`）：新增 `@assemble/observability` 纯 TS 指标库（Counter/Histogram 内存聚合 + Prometheus 文本序列化，零 Node/fastify 依赖）；5 个后端服务接入 `/metrics` 与 `X-Request-Id`（Fastify `requestIdHeader` 采纳上游 id + 跨服务透传，interference/takt 调 assembly 带上 request-id）。
- 可观测性 M2（gateway 改造）：`console.log` 裸输出改为结构化 JSON 访问日志（method/path/status/durationMs/requestId/upstream）；gateway 生成/透传 `X-Request-Id`（回显响应头 + 透传上游）；新增 `/metrics` 聚合 5 上游（`@assemble/observability` 的 `injectServiceLabel` 给同名指标注入 `service` 标签）；新增 `/telemetry` 端点接收前端 SimMonitor 上报并内存聚合。
- 可观测性 M3（前端 SimMonitor）：sim-platform 新增 `src/monitor` 埋点 SDK，一条 rAF 循环同时驱动 FPS（`render.fps`）+ 内存采样（`memory.js_heap_used/total`）并周期 flush，`PerformanceObserver` 采 Web Vitals（`webvitals.lcp/cls/fid`），节流批量 POST 到 gateway `/telemetry`（`{ samples:[{name,value}] }`）；核心编排与浏览器宿主分离（`createSimMonitor(host)` 纯逻辑 + `createBrowserHost()` 绑定），失败静默丢弃不阻塞业务，`main.ts` 入口 `initSimMonitor()` 一键启动。
- 安全与鉴权需求共识文档（`docs/SECURITY.md`）：鉴权/RBAC/审计/加密轻量自研方案 + Mermaid 鉴权数据流图 + S1–S3 实施切片与关键设计决策。
- 安全 S1（`@assemble/security` 共享库）：纯 TS 零外部依赖（仅 `node:crypto`），提供 HS256 JWT 签发/验证（常量时间验签、验期、可选验 iss）、AES-256-GCM 字段加解密、scrypt 派生、常量时间比较、RBAC 角色→权限矩阵（单一事实源）、append-only 审计哈希链（`hash=SHA256(prevHash+canonical)`，可全链校验篡改）。
- 安全 S2（auth-svc 真实签发 + 审计加固）：`/auth/token` 改为真实 HS256 JWT 签发（`AUTH_JWT_SECRET`，开发回退默认密钥 + 生产 fail-fast），新增 `/auth/verify`；审计 `writeAudit` 接入哈希链 + 串行化锁防并发断链；新增 `GET /audit`（actorId/action 过滤 + 全链校验）；RBAC 矩阵迁入 `@assemble/security`。
- 安全 S3（网关本地鉴权 + 前端凭证）：gateway 新增路径→权限映射（读/写按 HTTP 方法、interference offline/run 细分）+ 本地 `verifyJwt` + 401/403 决策；`/auth/*` 免鉴权、`/audit` 需 `audit:view`、业务前缀按权限断言；前端 `http.ts` 支持 `setAuthToken` 凭证注入（自动附 `Authorization: Bearer`）+ 401 统一清除令牌。
- HA 需求共识文档（`docs/HA.md`）：高可用代码层前置件方案（优雅停机 / readiness 分离 / 上游健康池 / 配置化）+ Mermaid 数据流图 + S1–S3 实施切片与关键设计决策。
- HA S1（服务优雅停机 + readiness 分离）：新增 `@assemble/health` 共享库（liveness/readiness 双探针路由注册 + `SIGTERM/SIGINT` 优雅停机编排 `readiness→down → drain → app.close → 退出` + `httpUpstreamProbe` 依赖可达性探针）；5 个后端服务 `/healthz` 恒 200、`/readyz` 依赖就绪才 200（interference/takt 探活 assembly-svc，不可达 503；assembly/model/auth 无外部依赖恒就绪）；各 `server.ts` 接入优雅停机。

### Changed

- `interference-svc` 离线预检改为消费 assembly-svc 真实 BOM 位姿与资产实测包络，命中零件对可回溯真实 BOM 零件。

### Fixed

- OBB-SAT 端面恰好相贴不再误判干涉；真实产线设备与卫生转运段按 0 间隙同缝贴合时预检为 0 命中。

## [0.4.1] - 2026-09-06

M3 平台化 · 多产线复用收口 —— **真实 GLB 资产管线 + 净菜多产线（三条工艺线共享行业设备与卫生转运段）+ CloudBase 单容器 Git 部署闭环**，并把产线选择页/装配工作台的品牌、宽度与「处理干涉」跳转收尾。

> 说明：0.4.0（GLB 资产管线）与 0.4.1（净菜多产线/单容器部署）两个里程碑合并点（`4053da5` / `ad95608`）均在本次发布范围内，0.4.0 未单独发 tag；对应分支 `feat/0.4.0-glb-asset-pipeline`、`feat/0.4.1-fresh-produce-sorting` 保留可回溯。发布后版本基线 0.3.0 → 0.4.1。

### Added

- sim-platform 新增产线配置中心，可编辑工艺类型、GLB 设备、工位节拍、设备长度和卫生转运参数，并创建自定义产线。
- 产线卡片「处理干涉」CTA 增加跳转：点击进入对应产线装配工作台处理离线预检命中。
- SimEngine 新增基于真实 BOM 工位路径的物料流转运行态，显示现场物料件、完成件数并联动当前工位高亮。
- assembly-svc 新增叶菜净菜清洗线与根茎净菜切配线，两条路线复用真实设备 GLB 和卫生转运段。
- 产线契约新增设备占用长度与转运资产配置字段，为多条果蔬/净菜工艺线复用同一套 BOM 排布算法做准备。
- 节拍领域契约新增后端配置 `TaktConfig` 与现场观测 `TaktObservation`，结果携带实际产出快照及数据来源。
- assembly-svc 按流水线返回真实 BOM，工作台按 BOM 从 model-svc 加载 GLB。
- 全仓生产代码与工程脚本硬编码审计及治理标准。
- 果蔬/净菜加工线数字样机规范与七台行业设备、设备间卫生转运输送段资产管线。
- 七台净菜设备的 GLB `extras.motion` 运行态动画绑定与无 WebGL 时序测试。
- 入口干涉预检改为按 `lineId` 读取 assembly-svc 真实 BOM，前端不再估算零部件数。

### Changed

- 部署链路改为 CloudBase 云托管「通过 Git 仓库部署」绑定 GitHub `main`：push 即自动构建发布，移除本地 `.deploy/` 快照与 `tcb cloudrun deploy` 手动流程。
- 全站页头与浏览器标签启用 `logo.png` 品牌标识，替换原「3D」文字标。
- 产线选择页内容宽度基准与装配工作台对齐（`1680px`），减少宽屏下的两侧空白。
- Docker/CloudBase 单容器部署监听端口由 `3000` 改为 `80`（云托管「容器端口」同步填 `80`）。
- CloudBase 云托管单容器部署纳入 sim-platform 静态产物：gateway 同源托管 `index.html` 与 `/assets/*`，浏览器访问不再落到 API 404 路由。
- 节拍面板新增后端现场实际产量、实际平均 CT、数据来源和观测时间展示，无观测时显示明确空态。
- BOM 树按后端 `stationId` 分组并随流水线动态切换。
- 净菜预处理线改为提升上料、气泡清洗、人工挑选、切配、振动沥水、称重包装和金检七工位。
- Babylon 整线与 BOM 单机取景按视口宽高比适配，窄视口不再裁切设备。
- 设备运行态动画由 GLB 节点声明驱动，支持输送、旋转、振动、开合、推杆等动作，并自动随工作台启动。
- 净菜线工位改按 GLB 实测长度紧凑排布，设备间仅保留卫生转运间隙。
- 净菜线设备间由 assembly-svc 按相邻设备边界动态插入固定 `transfer-conveyor`，通过 model-svc 加载真实 GLB，避免设备之间出现裸露空隙。
- `transfer-conveyor.glb` 增加可见食品级带面与回程带，侧护栏抬升至滚筒带面高度；前端 GLB 地址按 `modelVersion` 缓存隔离。
- 节拍面板的目标产能、开动率和负荷改为展示 takt-svc 基于 assembly-svc 工位计算的结果，移除前端演示注入。

### Removed

- 本地部署产物与脚本：`.deploy/` 快照、`scripts/sync-deploy.mjs`、空 `deploy/` 编排目录、失效的 `services:compose:up/down` 脚本。
- 前端合成 BOM、按产线类型生成的可见盒体装配模型及 GLB 失败盒体降级。

### Fixed

- 节拍服务自动生成目标产能改为向下取整，避免 `6.8s` 瓶颈被向上取为 `530 P/H`，导致 `529.4 P/H` 被错误显示为未达产。
- `scripts/dev.mjs` 启动服务前自动检测并构建缺失或过期的 `dist/server.js`，避免节拍等后端契约更新后继续运行旧产物并返回 `VALIDATION_FAILED`。

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

## [0.3.0] - 2026-09-03

M2 MVP · 首条产线闭环 —— **浏览器装配视口分态渲染 + 自动/手动/回放装配动画与拖拽 + BOM 树与节拍 HUD**（0.3.x 全半程，S1–S4 切片全部落地）。入口门禁由「产线工程师试用通过（验收 = M2）」承接，本轮在单条产线上完成了可演示的交互式装配仿真闭环。

> 说明：本版同时收编了 0.2.0 发布后、在 main 上渐进合入的两项 0.2.x 尾项（未单独发 0.2.1 tag）：`scripts/dev.mjs` 一键起脚本 与 vite IPv6 修复。它们未产生任何新后端能力、仅工程/脚本改善，随 0.3.0 一并发布（详见下文对应小节）。

### Added

- **一键起 dev 脚本 `scripts/dev.mjs`（根 `pnpm dev`，0.2.x 尾项收编）**：解决「vite 代理 `/lines → 7101` ECONNREFUSED」—— 此前 `pnpm dev:platform` 只起 vite 不起后端。自包含 Node 编排（不依赖 pnpm/concurrently），一键拉起 assembly-svc(7101) + interference-svc(7102) + takt-svc(7104，S4 起纳入精简 CORE) + vite(5173)：端口占用自动复用、探活就绪横幅、Ctrl+C/SIGTERM 统一清理子进程；后端产物缺失时报错并引导 build。`pnpm dev:all` 额外拉起 model/auth（后端自治）。

### Fixed

- **vite dev 仅绑 IPv6 `[::1]:5173`**（macOS + Node 22 下 `host:'localhost'` 默认行为）导致 Node fetch 走 `127.0.0.1:5173` 失败 → `vite.config.ts` `server.host` 显式设 `'127.0.0.1'`，浏览器与脚本统一访问 IPv4 loopback。验证：`pnpm dev` 后 vite 绑 `127.0.0.1:5173`，`/lines` 经代理返回 200（原 ECONNREFUSED 路径闭合）。

### Added（0.3.0 切片 S1–S4）

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

### Added（0.3.0 S2 切片推进）

- **S2 装配过程动画（FEAT-20260903-003 第二切片）**：auto/replay 散落→贴合逐件平滑，seek/undo 仍走跳变。架构红线延续 S1：状态机瞬时 + 动画器纯逻辑 + 渲染只消费每帧目标位姿。
  - `engine/ease.ts`（新）：缓动/插值纯函数（`easeInOutCubic` / `lerpVec3` / `progressAt`），无 Babylon/DOM。
  - `engine/animator.ts`（新）：`AssemblyAnimator` 引擎无关纯逻辑驱动器 —— 持有 placements（seat/scatter 双目标），按 BOM 步骤序 + `AssemblyStep.durationSeconds` 逐件自动贴合；动画**完成**那一刻回调 `onAssemble(partId)` 让宿主把它正式落进 assembled 集合（视觉先滑、到位才落，杜绝跳变）；`seekTo` / `undoStep` 走跳变（清飞行、不插帧）；可注入时钟，单测用假时钟锁定推进节奏。
  - `engine/babylon.ts`：BabylonScene 增 `onFrame` 每帧驱动 hook + 缓存 `_placements` + `applyFlightPose(partId, pos|null)`（飞行中件覆盖为插值位、退 null 回落 S1 seat/scatter）+ `_assembledIds` 飞行覆盖退出回落判定。BabylonSimEngine init 装载 BOM 后 `_wireAnimator` 绑定每帧推进 + 落集合回调（onAssemble→`assembly.assemble` + `syncAssemblyState` 落 seat/tint）；`scene.onFrame` 每帧 tick + 对飞行件应用插值位；`syncAssemblyState` 非播放时同步动画游标对齐（手动步进后可续播），播放中跳过避免打断飞行动画。门面暴露 `playAssembly/pauseAssembly/resetForPlay` + `animState` 聚合 getter。
  - `engine/types.ts`：SimEngine 门面加 S2 播放契约。
  - `engine/noop.ts`：NoopSimEngine 镜像（manual 拒播、reset 全散落、animState 读状态机如实；逐件推进由 `animator.test.ts` 假时钟覆盖）。
  - `views/WorkbenchView.vue`：S2 播放控制 HUD —— 从头演示 / 播放 / 暂停 + 动画进度计数；120ms 轮询 `animState` 仅读 `assembly.assembledPartIds.length`（不调 `syncAssemblyState` 避免每 120ms 重摆场景打断飞行插值）。
  - `engine/test/animator.test.ts`（新，5 例）：逐件自动贴合到全贴合 / 单件飞行 pose 插值 / 飞行完成才落集合 / seekTo 跳变 / undoStep / 越界 seek。

### Verified（0.3.0 S2）

- vue-tsc 0 错；sim-platform vitest **30/30 全绿**（含 S2 新增 5 + 2 = 7 例）。
- 浏览器 E2E（playwright chromium 加 `--disable-background-timer-throttling` 等反节流参数，**headless 必须开否则 rAF 节流导致飞行动画不推进**）：
  - 复位到全散落 `已贴合 0 / 12`（截图 `docs/s2-reset-all-pending.png`）—— 全部琥珀盒绕装配体环形悬空、播放进度 0/12。
  - 播放中途 `已贴合 1 / 12`（截图 `docs/s2-mid-flight.png`）—— 1 件已落 seat（青，居中）、11 件仍处 scatter 环（琥珀）；动画进度 2/12 · 播放中，验证散落→贴合逐件平滑。
  - 播完全部 `已贴合 12 / 12`（截图 `docs/s2-all-seated.png`）—— 全部青盒严丝合缝停 seat，验证 auto 推进到全贴合。
- 验收对照：散落→贴合逐件平滑插值（easeInOutCubic + `durationSeconds` 节奏）；seek/undo 走跳变（无插帧）；纯逻辑驱动器 5/5 单测锁定；Babylon 真渲染经 3 截图证明集合与渲染位置一致。

### Added（0.3.0 S3 切片推进）

- **S3 手动装配拖拽（FEAT-20260903-003 第三切片 · 方案A：射线拾取 + 平面拖拽）**：manual 模式下点选散落件（琥珀）→ 锁定水平拖拽平面（过该件 seat 高度）→ 随指针/程序化 dragTo 平移 → 逐帧 clearance.queryInteractive 判定 → 命中则变红拦截、贴近 seat则可贴合、落位或回散落。架构红线延续 S1/S2：动画进度=纯数据 / 渲染是被动摆位执行者 / 落位裁决走引擎门面 syncAssemblyState。
  - `engine/drag.ts`（新）：纯逻辑裁决核心
    - `boxObbAt / candidateCenterAt / adjudicateLand`：候选中心 OBB 与已装配静态集的实时裁决 + XZ 吸附半径判定
    - `ManualDragSession`：有状态拖拽会话（dragging/blocked/nearSeat/canLand/reason），用注入的 `queryInteractive` 与 `landDecision` 解耦真实几何；引擎无关、可被 vitest 锁定
    - `rayPlaneYIntersect`：世界射线与水平面（y=planeY）求交，供拖拽平面把屏幕坐标→世界 XZ
  - `engine/types.ts`：`InteractionManager` 增 `dragState: DragLiveState`（d 产品ing / / partId / blocked / hitPartId / nearSeat / canLand / reason）只读会话态；HUD/无 WebGL 断言均按此口径消费
  - `engine/noop.ts`：`NoopInteraction` 镜像 ordering 门槛（仅"下一步序"散落件可拖）+ `dragState` 状态机，Noop 后端亦满足门面契约
  - `engine/babylon.ts`：
    - `BabylonScene` 增 S3 渲染原语：`partSeatHalf` / `meshCenterOf` / `setMeshWorldCenter` / `setMeshHighlight`（hover 蓝 / blocked 红）/ `pickPartId`（scene.pick → part-盒体）/ `pointerXZAtPlane`（createPickingRay + 平面求交）/ `setCameraControlEnabled`（拖拽期间 detachControl 挂起 ArcRotateCamera，endDrag 后重挂）
    - `BabylonInteraction` 真驱动 ManualDragSession：beginDrag 把件从 scatter 降到 seat 高度（XZ 不变）挂起相机轨道；dragTo 累计 XZ、逐帧调 `clearance.queryInteractive` 判定 blocked；endDrag 落位或回散落，复相机并经 `onStateChange` 回调触发引擎 `syncAssemblyState`（含 S3b clearance 重登记）
    - canvas pointerdown/move/up/cancel 真鼠标拖拽监听（pointerCapture 防脱出）+ grab offset 防止件跳到指针处
    - 引擎 init `scene.mount` 后调 `interaction.wirePointer()` 装监听（constructor 时 canvas 未就绪，故延后挂）
  - `views/WorkbenchView.vue`：
    - 轮询读 `interaction.dragState` 映射 HUD 文案（拖拽中 / 可贴合 / 干涉拦截变红）
    - 标题/副标/左右栏/step 提示文案改 S3 手动拖拽语义
    - `window.__sim = eng` 暴露引擎实例供浏览器自动化读几何/驱动拖拽（无害，浏览器态生效）
  - `engine/test/drag.test.ts`（新，13 例）：boxObbAt 构造 / candidateCenterAt 换算 / rayPlaneYIntersect 平行反向 / adjudicate 三态裁决（贴近+清 / 不贴近 / 贴近但干涉，NoopClearance 真算法）/ 吸附半径默认与显式 / `ManualDragSession` 4 例（begin/moveTo blocked/finish landed+snapped-back/abort）
  - `engine/test/engine.test.ts`：S3 门面增 3 例（beginDrag 门槛仅下一步序 / endDrag 收束 dragState / dragState 默认 idle）

### Verified（0.3.0 S3）

- vue-tsc 0 错；sim-platform vitest **46/46 全绿**（placement 7 + animator 5 + drag 13 + engine 17 + useLineCatalog 4）
- 浏览器 E2E（playwright chromium headless + swiftshader + 反节流参数）：
  - 初始化 + seekTo(1)（base 已贴合青）→ beginDrag(part1) → 拖到与 base 相叠（候选=base seat 中心）→ 变红、HUD chip "S3 · 干涉拦截 · 无法贴合（命中 line-sorting-01-001）"、dragState.blocked=true（截图 `docs/s3-drag-blocked.png`）
  - 拖回 part1 自己的 seat（候选=seat1，干净）→ 蓝（dragTo 起点=blocked 候选，delta=seat1-seat0）→ dragState.blocked=false / canLand=true
  - endDrag → ok=true / reason='landed' / 已贴合 2/12（截图 `docs/s3-drag-landed.png`）—— base + part1 两件相邻蓝盒贴合；剩余 10 件琥珀散落
  - begin 起始态（截图 `docs/s3-drag-begin.png`）：HUD "拖拽 line-sorting-01-001 · 可贴合"
- 验收对照：干涉→变红拦截、贴近 seat 无干涉可贴合、严格步骤序（手动 assemble 仅接受下一步序件）、clearance 静态集与渲染两态集合一致（syncAssemblyState 单点维护）

### Added（0.3.0 S4 切片推进）

- **S4 BOM 树 + 节拍面板（HUD · FEAT-20260903-003 第四切片）**：工作台左栏展示「工位 → 零件」两层 BOM 树（round-robin 归组 + 每件 done/current/pending/基座 状态标注 + 点选联动视口 frameToPart），右栏展示 takt-svc 实时计算结果（瓶颈工位/理论CT/产能/各工位负荷分级 ok·busy·overload）；数据全经 @assemble/domain，只读门面态消费。
  - `engine/bomtree.ts`（新）：纯逻辑
    - `groupStepsByStation(bom, stations)`：步骤 seq i → stations[i % n] 归组，组内/组间稳定顺序（纯函数、可快照）。
    - `deriveBomTreeState(bom, stations, {assembledIds, currentStepSeq, selectedPartId?})`：装配态→树视图模型，每行 BomPartRow 带 done/current/isBase/isMovable，工位累计 doneCount。
    - `stationsOf(line)`：便捷别名。
  - `engine/taktpanel.ts`（新）：纯逻辑
    - `recommendTargetPerHour(stations)`：取瓶颈工位小时速率向上取整，让演示面板落在「瓶颈接近/超负荷」可读区间。
    - `deriveTaktPanel(reqInfo, result, stations)`：TaktBottleneckResult→HUD 视图（中文 summary、瓶颈名、工位负荷 ok/busy/overload 分级）。
  - `api/takt.ts`（新）：`fetchTaktSimulation({lineId, stations, targetUnitsPerHour, availability?})` POST /takt/simulate。
  - `vite.config.ts`：dev 代理新增 `/takt` → 127.0.0.1:7104。
  - `scripts/dev.mjs`：精简模式 CORE 加入 `takt-svc`（7104），本地 `pnpm dev` 即可拉齐 assembly/interference/takt 三个前端实连服务。
  - `components/BomTreePanel.vue`（新）：左栏两层树渲染（顶位分级 takt 显示），行点击 emit `select(partId)`。
  - `components/TaktPanel.vue`（新）：右栏渲染（summary / CT / 产能 / 目标 / 瓶颈 / 工位负荷条 + loading/error 兜底）。
  - `views/WorkbenchView.vue`：S4 接线
    - 120ms 轮询新增 `refreshBomTree()`（仅读门面 `engine.assembly` + `line.stations` + `selectedPartId`，不写场景）。
    - `loadTakt()`：产线就绪后一次拉 `takt-simulate`（target 取 `recommendTargetPerHour`、availability 0.85），结果存 `taktModel`。
    - `selectPart(partId)`：调 `eng.scene.frameToPart([partId])` + 写入 `selectedPartId` → BOM 树当前选中行高亮。
    - 左右栏 aside 改为 `<BomTreePanel>`/`<TaktPanel>`，副标/hud-top 文案切 S4「BOM 树联动 · 当前步骤高亮」。
  - `engine/test/bomtree.test.ts`（新，10 例）：归组确定性、done/current 标注边界（assembledIds vs step<cur 互独立）、基座识别、空步骤兜底、选中透传。
  - `engine/test/taktpanel.test.ts`（新，7 例）：recommendTargetPerHour 边界、loadClass 分级（0.9 busy/>1 overload）、达产 summary、缺工位名兜退。

### Verified（0.3.0 S4）

- vue-tsc 0 错；sim-platform vitest **63/63 全绿**（placement 7 + animator 5 + drag 13 + engine 17 + **bomtree 10 + taktpanel 7** + useLineCatalog 4）。
- 浏览器 E2E（playwright chromium headless + swiftshader + 反节流四件套 + pinned headless_shell-1194）：
  - 复位（`resetForPlay`）→ `已贴合 0/12`，BOM 树三工位（3.2s/2.6s/3.8s）展开，工位下 round-robin 归组的部件列出，**部件 1（基座）标 current 高亮（青描边 + ▸）**；其余 pending；takt 面板 summary = "理论产能 805.3 件/时 < 目标 948 · 未达产（瓶颈 装箱工位 3.8s）"，瓶颈 = 装箱工位 3.8s，负荷分级：上料工位 0.99(busy/黄) / 视觉分拣 0.81(ok/绿) / 装箱工位 1.18(overload/红+瓶颈徽)（截图 `docs/s4-bom-takt.png`）。
  - `seekTo(4)` → `已贴合 4/12`，BOM 树：部件 1基座 ✓、部件 4 ✓、部件 2 ✓、部件 3 ✓；**部件 5（seq4）current 高亮**（分拣工位下），其余 pending（截图 `docs/s4-bom-takt-assembled.png`）。takt 数据不变（takt 是一次仿真）。
- 验收对照：BOM层级 = 工位→零件（按 round-robin 归组到 stations）；当前 step 在所属工位下高亮、已装 ✓、pending ·、基座徽；选件→视口 frameToPart；节拍数据真接 takt-svc，瓶颈/分级与产线工位一致。
- 分支保留：`feat/0.3.0-s4-bom-takt`（从 `feat/0.3.0-s3-manual-drag` 派生）；提交 `5c37b78`(S4a) `e3cad64`(S4b) `6e7920f`(S4c)。

<!-- 本版 = 0.3.0（含 0.2.x 尾项收编）。0.3.x 剩余能力（产线模板抽象/第2-3产线复用/资产库等，见 docs/VERSIONING.md 0.4.x）将在此段之后以 Unreleased 继续累积。 -->
