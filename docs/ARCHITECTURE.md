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
│  ├─ gateway/          # 单容器聚合入口（子进程编排 5 服务 + 静态托管 + 反向代理）
│  ├─ assembly-svc/     # 装配服务：产线/BOM/装配约束表/工艺步骤
│  ├─ interference-svc/ # 干涉分析服务：服务端离线整线批量预检
│  ├─ model-svc/        # 模型服务：glTF 元数据/资产版本/CDN 签名
│  ├─ takt-svc/         # 节拍仿真服务：节拍计算/瓶颈识别
│  └─ auth-svc/         # 权限服务：统一认证(OIDC)/RBAC
├─ packages/        # 被多端复用的共享库（唯一可被前后端同时 import 的层）
│  ├─ domain/          # 领域类型契约（全工程单一事实源）
│  ├─ sim-utils/       # 纯数学/几何工具
│  ├─ clearance-core/  # 干涉分析核心算法（前端实时 + 后端离线复用）
│  ├─ storage/         # 降级仓储层（内存/文件/未来 DB）
│  ├─ http/            # 服务统一响应信封（成功 `{ok,data}` / 失败 `{ok,code,message}`）
│  └─ observability/   # 轻量可观测性指标库（Counter/Histogram + Prometheus 文本 + request-id，零 Node 依赖，前后端同源）
├─ Dockerfile       # 单容器聚合镜像（CloudBase Git 仓库部署的构建入口）
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
| 产线运行态 | GLB 设备运动节点、物料沿 BOM 工位路径流转、当前工位状态联动 | `rhythm.ts` + SimEngine runtime |

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
>
> **真实几何（0.5.x）**：资产包络元数据集中在 `@assemble/domain` 的 `MODEL_ASSET_BOUNDS`（由 `scripts/gltf-gen/measure_glb.mjs` 对 GLB 实测）。interference-svc 直接用 BOM 位姿 + 该包络构造世界 OBB，不再用合成夹具；工作台「处理干涉」闭环 = 报告清单 → 3D 定位/红高亮 → 产线配置调整工位位置/朝向 → 重新预检归零。assembly-svc 的 `layout-suggestions` 会按真实命中对计算最小避让位移，前端一键回填 `station.position` 后保存即可复检。

## 4. 后端架构：无状态微服务 + 降级存储

- 每个服务**无状态、端口隔离、含健康检查 `/healthz`**，可独立 `dev` 启动。
- 服务只依赖 `@assemble/storage` 的 `Repository<T>` 接口，**不直接决定持久化介质**。
- **降级策略**：`resolveBackend()` 按环境变量选择内存/文件；Docker 未起中间件时自动回落内存，保证本地一键跑通。接真库时替换实现、接口不变。

```
AssemblySvc ──► Repository<ProductionLine>      ← 介质=内存/文件(当前)
InterferenceSvc ─► Repository<InterferenceReport>/Job
TaktSvc ──► Repository<TaktConfig> + Repository<TaktObservation>
...
AuthSvc ─► Repository<AuditLogEntry> + JWT 校验
```

## 5. 数据模型：`@assemble/domain` 为单一契约源

关键聚合根与关系（详见 domain 源码注释）：

- `ProductionLine`（产线） 1—n `Station`（工位，节拍单元）
- `AssemblyBom`（装配 BOM）= `AssemblyPart[]`（零件树）+ `Constraint[]`（约束表）+ `AssemblyStep[]`（工艺步骤）
- `Constraint` 类型：`coincident / coplanar / concentric / distance`（对齐方案 4.2）
- 干涉产物：`InterferenceReport`（含 `hits`、`elapsedMs`、`broadCullRatio` 等质量指标）
- 节拍配置：`TaktConfig`（目标产能 / 计划开动率 / 配置更新时间与来源）
- 节拍观测：`TaktObservation`（MES/PLC 观测窗口 / 完成件数 / 实际平均节拍）
- 节拍产物：`TaktBottleneckResult`（瓶颈工位 / 理论产能 / 各工位负荷 / 后端实际产出）
- 模型资产：`ModelAssetVersion`（内容寻址指纹，压缩策略 `draco/meshopt`）
- 权限：`AuthPrincipal`（OIDC sub + 角色 + 权限点 + ABAC 产线范围）

### 5.1 流水线驱动的 BOM 与 GLB 装配链路

0.4.x 起，工作台禁止在前端按 `line.kind` 合成盒体或临时 BOM。所选流水线的装配定义必须走同一条真实数据链：

```
GET /lines/:lineId
GET /lines/:lineId/bom
        │
        ▼
AssemblyBom(parts + steps.stationId)
        │ assetId
        ├──► model-svc /model/glb/:assetId.glb ──► Babylon 可见模型
        ├──► AssemblyController ──► 装配步骤/动画/拖拽
        └──► BomTree ──► 按后端 stationId 分组
```

强制约定：

1. `assembly-svc` 是流水线与 BOM 关系的事实源；前端不得生成业务 BOM。
2. `model-svc` 是 GLB 文件的事实源；前端不得复制 GLB 到 `public/` 或用可见盒体降级。
3. Babylon 可保留不可见的拾取/碰撞代理，但代理只承载交互和 OBB，不得作为视觉模型显示。
4. BOM 加载失败或 GLB 缺失必须进入可观察错误态，不得悄悄回退到合成模型。
5. BOM 树使用 `AssemblyStep.stationId`，不得按步骤序号 round-robin 猜测工位。
6. `ProductionLine.baseAssetId` 只用于确有贯穿基座的产线；净菜等设备自带输送段的工艺线省略该字段，避免重复可见输送带。

7. BOM 中可包含 `isMovable=false` 的固定设施（如设备间转运输送段）；这类零件由 `assembly-svc` 按相邻设备边界动态生成，不创建装配步骤，但必须走同一条 model-svc GLB 链路。
8. 入口离线预检只接收 `lineId`；`interference-svc` 通过服务间 HTTP 从 `assembly-svc` 读取产线与 BOM，零件数不得由前端估算或由 `lineKind` 合成。
9. 产线紧凑排布由 `Station.footprintLengthMeters`、`ProductionLine.transferAssetId` 和 `transferGapMeters` 配置驱动；BOM 算法不得按 `line.kind` 分支猜设备尺寸或转运段。

## 6. 工程约定与目录规约

| 项 | 约定 |
|----|------|
| 模块导出 | 每个 `package` 通过 `src/index.ts` 聚合导出；外部只用包入口，不深路径 `import 包/src/...` |
| TS 配置 | 统一继承根 `tsconfig.base.json`；`strict + noUncheckedIndexedAccess + noImplicitOverride` |
| 纯代码 vs 依赖 | `sim-utils`、`clearance-core`、`domain`、`observability` 保持**无 DOM/Node 专属依赖**，浏览器与后端一致可用 |
| 包内脚本 | 统一提供 `build` / `typecheck` / `test`（vitest） |
| 测试 | 单测放各包 `test/`，走根 `vitest.config.ts`（alias 到源码，无需先 build） |

## 7. 已知边界 / 规划中

- 当前已落地：`packages/*`、5 个后端服务、gateway 单容器聚合、`apps/sim-platform` 与 Dockerfile。
- 部署链路：CloudBase 云托管「通过 Git 仓库部署」绑定 GitHub `main`，push 即构建发布（见 `DEPLOYMENT.md`）。
- 规划中（见 `VERSIONING.md` 0.5.x 起）：中间件真接入、HA 部署编排、RBAC/审计/加密与容灾。0.5.x 已落地「测试与基准体系」「监控与可观测性」两个方向（`TESTING.md` / `OBSERVABILITY.md`）。
- 前端真实渲染依赖 Babylon 运行库与 WebGL，浏览器侧验收（playwright 截图）在 0.2.x 落地。
