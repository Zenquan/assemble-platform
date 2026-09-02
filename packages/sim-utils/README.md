# @assemble/sim-utils

纯数学/几何工具库（向量、矩阵、四元数、插值）。被装配贴合（slerp 平滑过渡）、干涉分析（OBB 构造）、节拍仿真（速率）等模块复用。

> **纯代码红线**：无 DOM / Node 专属依赖，浏览器与后端一致可用。

## 主要能力

来自 `src/math.ts`：

- `Vec3` 运算（加/减/点积/叉积/长度/归一化等）
- `mat4Multiply` / `mat4TransformPoint` —— 4×4 矩阵乘法与点变换
- `quatSlerp` —— 四元数球面插值（装配约束贴合的姿态平滑过渡）

## 用法

```ts
import { quatSlerp, mat4TransformPoint } from '@assemble/sim-utils';

// 在 start → end 之间按 t 平滑过渡姿态
const q = quatSlerp(startQuat, endQuat, t);
```

## 命令

```bash
pnpm --filter @assemble/sim-utils test   # 数学单测
pnpm --filter @assemble/sim-utils build
```
