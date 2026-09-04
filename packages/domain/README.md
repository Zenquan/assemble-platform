# @assemble/domain

全工程共享的**领域模型与类型契约**单一事实源（Single Source of Truth）。供 `apps/`、`services/` 及其它 `packages/` 引用，保证前端实时与后端离线、以及不同服务之间的数据形状**口径一致**。

> 架构定位见 `docs/ARCHITECTURE.md` §5。改动本包波及面大：优先向后兼容（加字段而非改删）。

## 模块与覆盖

| 文件 | 内容 |
|------|------|
| `geometry.ts` | `Vec3 / AABB / OBB` 三维几何描述 |
| `assembly.ts` | 装配域：`ProductionLine / Station / AssemblyBom / AssemblyPart / Constraint / AssemblyStep / AssemblyMode` |
| `interference.ts` | 干涉产物 `InterferenceReport` 与质量指标 |
| `model.ts` | 模型资产 `ModelAssetVersion`（内容寻址 + 压缩策略） |
| `rhythm.ts` | 节拍 `TaktConfig` / `TaktObservation` / `TaktBottleneckResult`（配置、实际产出、瓶颈与工位负荷） |
| `identity.ts` | 权限 `AuthPrincipal`（OIDC sub + 角色 + 权限点 + ABAC 产线范围） |

## 关键聚合关系

- `ProductionLine` 1—n `Station`（工位 = 节拍单元）
- `AssemblyBom` = `AssemblyPart[]` + `Constraint[]` + `AssemblyStep[]`
- `Constraint.type` ∈ `coincident | coplanar | concentric | distance`

## 约定

- 纯类型/只含纯函数，**不依赖 DOM / Node 专属 API**，浏览器与后端一致可用。
- 所有导出经 `src/index.ts` 聚合；外部只走包入口，不深路径 import。

## 命令

```bash
pnpm --filter @assemble/domain typecheck
pnpm --filter @assemble/domain build
```
