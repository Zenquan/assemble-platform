# ARCHITECTURE —— 技术架构设计

> 本工程的技术架构落地。读这份之前建议先看《技术方案》第 3、6 章（选型与总体架构）——本文是其**工程化实现**，面向要在本仓库写代码的人。

## 1. 总体分层与仓库拓扑

`assemble-platform/` 采用 **pnpm Monorepo**，三种角色分目录：

```
assemble-platform/
├─ apps/           # 可运行的前端应用（浏览器入口）
│  ├─ sim-platform # 仿真工作台（主应用，Vue3+Babylon，经 SimEngine 访问引擎）
│  └─ sim-admin    # 管理后台（产线/模型/用户/权限配置，规划中）
├─ services/       # 后端微服务（无状态、端口隔离、各自可独立启动）
│  ├─ gateway/          # API 网关（路由/鉴权/限流，规划中）
│  ├─ assembly-svc/     # 装配服务：产线/BOM/装配约束表/工艺步骤
│  ├─ interference-svc/ # 干涉分析服务：服务端离线整线批量预检
│  ├─ model-svc/        # 模型服务：glTF 元数据/资产版本/CDN 签名
│  ├─ takt-svc/         # 节拍仿真服务：节拍计算/瓶颈识别
│  └─ auth-svc/         # 权限服务：统一认证(OIDC)/RBAC
├─ packages/        # 被多端复用的共享库（唯一可被前后端同时 import 的层）
│  ├─ domain/          # 领域类型契约（全工程单一事实源）
│  ├─ sim-utils/       # 纯数学/几何工具
│  ├─ clearance-core/  # 干涉分析核心算法（前端实时 + 后端离线复用）
│  └─ storage/         # 降级仓储层（内存/文件/未来 DB）
├─ deploy/          # Dockerfile / docker-compose 编排
├─ infra/           # 中间件与基础设施配置占位（MySQL/Redis/MQ/ES/CDN）
├─ docs/            # 文档（本文件所在）
└─ scripts/         # 工程级脚本（clean 等）
```

### 依赖方向（强制）

```
apps / services  ──►  packages
                        ▲
   (禁止反向)         各包互依按需（如 clearance-core 依 sim-utils、domain）
```
- **业务入口（apps/services）不得被其它入口依赖**。
- **apps 之间、services 之间互不 `import`**：服务间通过网关 HTTP / 事件解耦，跨服务数据一律用 `@assemble/domain` 类型描述。
- 共享算法/类型只放 `packages/`，保证浏览器与 Node 同源、判定一致。

## 2. 前端架构：SimEngine 门面（核心设计决策）

对应方案 3.1/3.2 的「不裸用 Babylon，封装 SimEngine」。

```
Vue3 业务组件层（views/stores/components）   ← 只依赖 SimEngine 公开接口
        │
   SimEngine Facade  (apps/sim-platform/src/engine)
        │  抽象：SceneManager / AssetManager / InteractionManager
        │        / AssemblyController / ClearanceController
        ▼
   @babylonjs/core（可替换引擎层，业务不 touch）
```

**架构红线（写代码必须遵守）**：
1. **业务组件禁止直接 `import '@babylonjs/core'`**；一律经 `SimEngine` 门面。
2. SimEngine 的**接口稳定**（对未来切 Three.js/升级引擎不敏感），实现细节隔离在门面内部。
3. 门面需可被 mock —— 单测装配控制器时注入假门面，不启动真实 WebGL。

### SimEngine 对外能力（对应前端三大模块）
| 能力 | 职责 | 关联 domain |
|------|------|------------|
| 实时装配 | 自动/手动/回放三模式，约束贴合用 slerp 平滑过渡 | `assembly.ts` |
| 实时干涉 | 拖拽装配时的实时碰撞检测，命中即高亮/拦截 | `clearance-core` |
| 节拍可视 | 传送带/机械臂节拍动画、瓶颈高亮 | `rhythm.ts` |

## 3. 干涉算法：前后端协同（本工程最具含金量的部分）

**同一套 `@assemble/clearance-core` 被两端复用**，保证判定一致：

```
@assemble/clearance-core
  ├─ bvh.ts        # Broad Phase：BVH 空间索引（构建 + selfIntersect + queryAgainstSingle）
  ├─ obbSat.ts     # Narrow Phase：OBB-SAT，15 分离轴短路判定
  ├─ detector.ts   # ClearanceDetector 门面：交互式(增量)与离线(批量)两条路径
  └─ aabb.ts / obb.ts   # AABB 运算、AABB→OBB 派生
```

| 场景 | 执行端 | 路径 | 为什么 |
|------|--------|------|--------|
| 交互拖拽、单步装配（实时） | **前端** | `ClearanceDetector` 的 `queryInteractive`（BVH 树 vs 单件） | 需 <200ms 满足拖拽手感，本地零往返 |
| 整线全量预检、出干涉报告 | **服务端** | `ClearanceDetector` 的 `loadAll + runFull`（BVH 自碰撞 selfIntersect） | 数千零件组合校验太重，放离线队列防压垮浏览器 |

> 已实现要点：BVH 用中位切分轴循环剖分构建、self-collision 标准遍历保证候选对**无重复**；OBB-SAT 逐帧复用的无分配实现。基准用例：200 零部件 `runFull < 200ms`（见 `clearance-core/test`）。

## 4. 后端架构：无状态微服务 + 降级存储

- 每个服务**无状态、端口隔离、含健康检查 `/healthz`**，可独立 `dev` 启动。
- 服务只依赖 `@assemble/storage` 的 `Repository<T>` 接口，**不直接决定持久化介质**。
- **降级策略**：`resolveBackend()` 按环境变量选择内存/文件；Docker 未起中间件时自动回落内存，保证本地一键跑通。接真库时替换实现、接口不变。

```
AssemblySvc ──► Repository<ProductionLine>      ← 介质=内存/文件(当前)
InterferenceSvc ─► Repository<InterferenceReport>/Job
...
AuthSvc ─► Repository<AuditLogEntry> + JWT 校验
```

## 5. 数据模型：`@assemble/domain` 为单一契约源

关键聚合根与关系（详见 domain 源码注释）：

- `ProductionLine`（产线） 1—n `Station`（工位，节拍单元）
- `AssemblyBom`（装配 BOM）= `AssemblyPart[]`（零件树）+ `Constraint[]`（约束表）+ `AssemblyStep[]`（工艺步骤）
- `Constraint` 类型：`coincident / coplanar / concentric / distance`（对齐方案 4.2）
- 干涉产物：`InterferenceReport`（含 `hits`、`elapsedMs`、`broadCullRatio` 等质量指标）
- 节拍产物：`TaktBottleneckResult`（瓶颈工位 / 理论产能 / 各工位负荷）
- 模型资产：`ModelAssetVersion`（内容寻址指纹，压缩策略 `draco/meshopt`）
- 权限：`AuthPrincipal`（OIDC sub + 角色 + 权限点 + ABAC 产线范围）

## 6. 工程约定与目录规约

| 项 | 约定 |
|----|------|
| 模块导出 | 每个 `package` 通过 `src/index.ts` 聚合导出；外部只用包入口，不深路径 `import 包/src/...` |
| TS 配置 | 统一继承根 `tsconfig.base.json`；`strict + noUncheckedIndexedAccess + noImplicitOverride` |
| 纯代码 vs 依赖 | `sim-utils`、`clearance-core`、`domain` 保持**无 DOM/Node 专属依赖**，浏览器与后端一致可用 |
| 包内脚本 | 统一提供 `build` / `typecheck` / `test`（vitest） |
| 测试 | 单测放各包 `test/`，走根 `vitest.config.ts`（alias 到源码，无需先 build） |

## 7. 已知边界 / 规划中

- 当前已落地：`packages/*`（domain/sim-utils/clearance-core/storage）与根工程。
- 规划中（见 `VERSIONING.md` 0.2.x 起）：`apps/sim-platform`（SimEngine）、5 个后端服务、gateway、Docker 编排、中间件真接入。
- 前端真实渲染依赖 Babylon 运行库与 WebGL，浏览器侧验收（playwright 截图）在 0.2.x 落地。
