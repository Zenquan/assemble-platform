import type { AABB, OBB, InterferenceHit, InterferenceSeverity } from '@assemble/domain';
import { Bvh } from './bvh.js';
import { obbIntersect } from './obbSat.js';
import { aabbFromPoints } from './aabb.js';

/** 注册到检测器的单个零件几何：需给出世界系 OBB 及其 AABB（可由 OBB 直接推导） */
export interface ClearancePart {
  partId: string;
  /** 世界系方向包围盒（用于 narrow 精判） */
  obb: OBB;
  /** 世界系轴对齐包围盒（用于 broad 粗筛） */
  aabb?: AABB;
  severity?: InterferenceSeverity;
}

export interface ClearanceOptions {
  /** 默认严重程度 */
  severity?: InterferenceSeverity;
}

export interface ClearanceRunResult {
  /** 命中干涉列表 */
  hits: InterferenceHit[];
  /** 总零件数 */
  totalPartCount: number;
  /** 送入 narrow 的候选对数（broad 未剔除掉的） */
  pairsChecked: number;
  /** 所有可能对的原始数量（用于计算剔除率） */
  totalPossiblePairs: number;
  /** 检测耗时 ms */
  elapsedMs: number;
  /** broad 剔除率 = 1 - pairsChecked/totalPossiblePairs */
  broadCullRatio: number;
}

function computeAabbFromObb(obb: OBB): AABB {
  const cx = obb.center[0], cy = obb.center[1], cz = obb.center[2];
  const h = obb.halfExtents;
  const pts: Array<readonly [number, number, number]> = [];
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      for (const sz of [-1, 1]) {
        pts.push([
          cx + sx * h[0] * obb.axes[0][0] + sy * h[1] * obb.axes[1][0] + sz * h[2] * obb.axes[2][0],
          cy + sx * h[0] * obb.axes[0][1] + sy * h[1] * obb.axes[1][1] + sz * h[2] * obb.axes[2][1],
          cz + sx * h[0] * obb.axes[0][2] + sy * h[1] * obb.axes[1][2] + sz * h[2] * obb.axes[2][2],
        ]);
      }
    }
  }
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const p of pts) {
    if (p[0] < minX) minX = p[0];
    if (p[1] < minY) minY = p[1];
    if (p[2] < minZ) minZ = p[2];
    if (p[0] > maxX) maxX = p[0];
    if (p[1] > maxY) maxY = p[1];
    if (p[2] > maxZ) maxZ = p[2];
  }
  return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] };
}

/**
 * 干涉检测器 —— 前后端共用的同一套算法核心。
 *
 * 两条使用路径（对应方案 3.3 的「前后端协同」）：
 *  1. interactive（前端 SimEngine 实时）：逐步 buildIncremental 加入已装配零件，
 *     再 queryInteractive 对候选对做 OBB-SAT，命中即实时高亮/拦截。
 *  2. offline（服务端整线批量）：一次性 loadAll + runFull，全量校验出报告。
 *
 * Broad phase 采用 BVH（见 bvh.ts），narrow 采用 OBB-SAT（见 obbSat.ts）。
 */
export class ClearanceDetector {
  private parts = new Map<string, ClearancePart>();
  private bvh: Bvh | null = null;
  private defaultSeverity: InterferenceSeverity;

  constructor(opts: ClearanceOptions = {}) {
    this.defaultSeverity = opts.severity ?? 'error';
  }

  get partCount(): number {
    return this.parts.size;
  }

  private ensurePart(part: ClearancePart): void {
    const aabb = part.aabb ?? computeAabbFromObb(part.obb);
    this.parts.set(part.partId, { ...part, aabb });
  }

  private intersectPair(a: ClearancePart, b: ClearancePart): InterferenceHit {
    const ab = a.aabb ?? computeAabbFromObb(a.obb);
    const bb = b.aabb ?? computeAabbFromObb(b.obb);
    const contactPoint: readonly [number, number, number] = [
      (Math.max(ab.min[0], bb.min[0]) + Math.min(ab.max[0], bb.max[0])) / 2,
      (Math.max(ab.min[1], bb.min[1]) + Math.min(ab.max[1], bb.max[1])) / 2,
      (Math.max(ab.min[2], bb.min[2]) + Math.min(ab.max[2], bb.max[2])) / 2,
    ];
    const firstId = a.partId < b.partId ? a.partId : b.partId;
    const secondId = a.partId < b.partId ? b.partId : a.partId;
    const severity = a.severity ?? b.severity ?? this.defaultSeverity;
    return {
      firstPartId: firstId,
      secondPartId: secondId,
      severity,
      overlapEstimate: 1,
      contactPoint,
      phase: 'narrow',
    };
  }

  /**
   * 离线批量路径：一次性载入全部零件。
   */
  loadAll(parts: ClearancePart[]): this {
    this.parts.clear();
    for (const p of parts) this.ensurePart(p);
    this.rebuild();
    return this;
  }

  /**
   * 交互式路径（1）：把「已装配完成」的零件整体纳入一棵静态 BVH。
   * 增量装配时先 build 已完成部分，再把当前拖拽件用 queryInteractive 逐个检测。
   */
  rebuild(onlyPartIds?: string[]): void {
    const arr: Array<{ partId: string; box: AABB }> = [];
    for (const [id, p] of this.parts) {
      if (onlyPartIds && !onlyPartIds.includes(id)) continue;
      const box = p.aabb ?? computeAabbFromObb(p.obb);
      arr.push({ partId: id, box });
    }
    this.bvh = Bvh.build(arr);
  }

  /**
   * 交互式路径（2）：检测某「正在拖拽/待装配」零件与已装入集合的干涉。
   * @returns 命中该零件的已存在零件 id 列表
   */
  queryInteractive(movingPart: ClearancePart): string[] {
    if (!this.bvh) return [];
    const box = movingPart.aabb ?? computeAabbFromObb(movingPart.obb);
    return this.bvh.queryAgainstSingle(movingPart.partId, box).filter((pid) => {
      const other = this.parts.get(pid);
      return other ? obbIntersect(movingPart.obb, other.obb) : false;
    });
  }

  /**
   * 离线批量路径：全量自交检测，输出完整干涉报告数据。
   * 用于服务端对数千零件的整线校验。
   */
  runFull(): ClearanceRunResult {
    const t0 = performance.now();
    const ids = Array.from(this.parts.keys());
    const totalPossiblePairs = (ids.length * (ids.length - 1)) / 2;
    if (!this.bvh) this.rebuild();
    const candidates = this.bvh!.selfIntersect();
    const hits: InterferenceHit[] = [];
    for (const [a, b] of candidates) {
      const pa = this.parts.get(a)!;
      const pb = this.parts.get(b)!;
      if (obbIntersect(pa.obb, pb.obb)) {
        hits.push(this.intersectPair(pa, pb));
      }
    }
    const elapsedMs = performance.now() - t0;
    const broadCullRatio =
      totalPossiblePairs > 0 ? 1 - candidates.length / totalPossiblePairs : 1;
    return {
      hits,
      totalPartCount: ids.length,
      pairsChecked: candidates.length,
      totalPossiblePairs,
      elapsedMs,
      broadCullRatio,
    };
  }

  /**
   * 便捷：给定一批零件做两两 AABB 快速粗判（broad-only，用于极小集合或不需高精度时）。
   * 保留以匹配 severity='info' 阶段（不做 OBB-SAT）。
   */
  roughIntersect(parts: ClearancePart[]): InterferenceHit[] {
    const out: InterferenceHit[] = [];
    for (let i = 0; i < parts.length; i++) {
      for (let j = i + 1; j < parts.length; j++) {
        const a = parts[i]!;
        const b = parts[j]!;
        const aa = a.aabb ?? computeAabbFromObb(a.obb);
        const bb = b.aabb ?? computeAabbFromObb(b.obb);
        if (Bvh.aabbOverlap(aa, bb)) {
          const firstId = a.partId < b.partId ? a.partId : b.partId;
          const secondId = a.partId < b.partId ? b.partId : a.partId;
          const box = aabbFromPoints(aa.min, bb.max);
          const c = [
            (box.min[0] + box.max[0]) / 2,
            (box.min[1] + box.max[1]) / 2,
            (box.min[2] + box.max[2]) / 2,
          ] as readonly [number, number, number];
          out.push({
            firstPartId: firstId,
            secondPartId: secondId,
            severity: 'info',
            overlapEstimate: 1,
            contactPoint: c,
            phase: 'broad',
          });
        }
      }
    }
    return out;
  }
}
