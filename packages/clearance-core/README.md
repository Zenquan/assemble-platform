# @assemble/clearance-core

**干涉分析核心算法** —— 本工程最具含金量的共享层。**同一份代码被前端实时检测与后端离线全量预检两端复用**，保证判定一致。

> 算法协同设计见 `docs/ARCHITECTURE.md` §3；质量/性能门禁见 `docs/TESTING.md` §3。

## 结构与职责

| 文件 | 阶段 | 职责 |
|------|------|------|
| `bvh.ts` | Broad Phase | `Bvh` 空间索引：构建 + `selfIntersect`（自碰撞）+ 单件查询；中位切分轴循环剖分，self-collision 标准遍历保证候选对**无重复** |
| `obbSat.ts` | Narrow Phase | OBB-SAT，15 分离轴短路判定；逐帧无分配实现 |
| `detector.ts` | 门面 | `ClearanceDetector`：`queryInteractive`（交互增量）与 `loadAll + runFull`（离线批量）双路径 |
| `aabb.ts` / `obb.ts` | 工具 | AABB 运算、`obbFromCenterHalfExtents`、`aabbToObb` |

## 两条路径

| 场景 | 执行端 | 入口 |
|------|--------|------|
| 交互拖拽 / 单步装配（实时） | **前端** | `detector.queryInteractive(newPart)` → `hits[]` |
| 整线全量预检 / 出干涉报告 | **服务端** | `detector.loadAll(parts)` + `detector.runFull()` → `InterferenceReport` |

## 用法

```ts
import { ClearanceDetector, obbFromCenterHalfExtents } from '@assemble/clearance-core';

// 离线全量预检
const d = new ClearanceDetector();
d.loadAll(parts.map(p => ({ partId: p.id, obb: p.obb })));
const report = d.runFull(); // { hits, totalPartCount, broadCullRatio, elapsedMs, ... }

// 交互实时查询（单件 vs 已装配 BVH 树）
const hits = d.queryInteractive(newObb);
```

## 性能基准（门禁）

**200 零部件 `runFull < 200ms`**（对齐简历口径，见 `test/clearance.test.ts`）。改动几何/索引逻辑后此用例必须仍绿。

## 命令

```bash
pnpm --filter @assemble/clearance-core test
pnpm --filter @assemble/clearance-core build
```
