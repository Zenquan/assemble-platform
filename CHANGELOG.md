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

> ⚠️ 0.2.0 出口门禁待补：Babylon 接入装配工作台、清洁就绪产线种子（FEAT-20260903-001）、一键起前端+服务脚本；完成后发版 tag v0.2.0。

---

## [Unreleased]

<!-- 后续改动按 Conventional Commits 归类追加，勿手填版本号（由发布流程决定） -->
