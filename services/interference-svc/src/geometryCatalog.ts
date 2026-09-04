import type { OBB } from '@assemble/domain';
import { obbFromCenterHalfExtents } from '@assemble/clearance-core';

/**
 * 当前离线算法夹具：为 BOM 零件数量生成确定性 OBB（世界系）。
 * 真实系统中 OBB 由模型管线的装配约束表/实例化结果生成后入库，
 * 真实模型包络接入前，保留该夹具验证「服务端离线批量干涉预检」整条链路；零件数量由真实 BOM 提供。
 *
 * 布局策略与单测一致：分段密集、段间稀疏，让 BVH broad phase 体现剔除价值。
 *
 * 产线 kind 差异（FEAT-20260903-001）：
 *   - `cold-chain` 采用「全稀疏无 jitter」布局 —— 代表优化装配的冷链线，
 *     离线预检稳定 0 干涉（hitCount === 0），使产线选择页能呈现「就绪·无干涉(绿)」
 *     与「待检修·干涉告警(红)」双态真实对照，匹配 design 稿页面 A 的 B1/B2 演示。
 *   - 其余 kind 保持原 jitter 策略，制造真实命中以体现 BVH 检测价值。
 */
export interface SyntheticPart {
  partId: string;
  obb: OBB;
}

export function synthesizePartsForLine(
  lineKind: string,
  totalParts: number,
  clusterSize = 12,
): SyntheticPart[] {
  // 冷链线（装配优化线）走稀疏布局：间距 4 单位、半长 0.5 → 同线内无重叠
  if (lineKind === 'cold-chain') {
    const parts: SyntheticPart[] = [];
    for (let i = 0; i < totalParts; i++) {
      const col = i % 10;
      const row = Math.floor(i / 10);
      const cx = col * 4;
      const cy = row * 4;
      const cz = 0;
      parts.push({
        partId: `${lineKind}-${String(i).padStart(3, '0')}`,
        obb: obbFromCenterHalfExtents([cx, cy, cz], [0.5, 0.5, 0.5]),
      });
    }
    return parts;
  }

  const parts: SyntheticPart[] = [];
  for (let i = 0; i < totalParts; i++) {
    const seg = Math.floor(i / clusterSize);
    const inSeg = i % clusterSize;
    // 每段占 12×2=24 单位宽，段间隔留 6 单位 -> 段间包围体不重叠
    const base = seg * (clusterSize * 2 + 6);
    // 引入少量确定性随机偏移制造真实干涉对
    const jitter = ((i * 7919) % 1000) / 1000; // 0..1
    const cx = base + inSeg * 2 + (inSeg % 3 === 0 ? jitter * 0.4 : 0);
    const cy = inSeg * 1.5;
    const cz = 0;
    const half = [1, 1, 1] as const;
    // 同段内相距 2 单位、半长 1 -> 紧邻但不重叠；仅 jitter 时部分重叠制造 hit
    const hx = inSeg % 4 === 0 ? 1.0 + jitter * 0.8 : 1.0;
    parts.push({
      partId: `${lineKind}-${String(i).padStart(3, '0')}`,
      obb: obbFromCenterHalfExtents([cx, cy, cz], [hx, half[1], half[2]]),
    });
  }
  return parts;
}
