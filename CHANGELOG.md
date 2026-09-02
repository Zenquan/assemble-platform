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

## [Unreleased]

<!-- 后续改动按 Conventional Commits 归类追加，勿手填版本号（由发布流程决定） -->
