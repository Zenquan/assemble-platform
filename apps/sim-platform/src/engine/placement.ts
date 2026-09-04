/**
 * S1 · 分态渲染 —— 纯布局数学（无 Babylon / DOM，可被 vitest 无 WebGL 验证）
 *
 * 语义（对齐 FEAT-20260903-003 S1）：
 *   把一条产线的零件分成「已贴合 / 待装配」两态。已贴合零件停在**贴合基准位**
 *   （seat = `AssemblyPart.localPosition`，S1 阶段用确定性合成的 seat 中心）；
 *   待装配零件停在**确定性散落起点**（一个相对装配体稳定、可复现的"待料位"），
 *   归属切换由 `assembledPartIds` 驱动。本模块只负责算出每个零件的两个目标位，
 *   不接触任何渲染句柄 —— 让 S1 的核心可被纯单测锁定，Babylon 侧仅消费结果。
 *
 * 散落规则（确定性、可复现）：
 *   - 待装配件绕装配体质心排成一层"待料环"：半径 = 装配体包围半径 + 预留边距；
 *   - 每件在环上按**稳定序号**等角分布（Golden-angle 错峰避免排成规则十字/叠角）；
 *   - 环整体抬升到装配体顶面以上，让"待装配"在视觉上一目了然且与已贴合不粘连。
 *   - 全部输入只来自 seat 列表本身 → 同输入恒同输出（可单测快照）。
 */

import type { Vec3 } from '@assemble/domain';

/** 一份零件的贴合基准位（seat）输入 */
export interface SeatInput {
  partId: string;
  /** 贴合基准中心（局部坐标原点对应的世界贴合位） */
  center: Vec3;
  /** 该件 OBB 半轴长（用于估算高度与包围半径） */
  half: Vec3;
}

/** 一个零件的分态布局结果 */
export interface PartPlacement {
  partId: string;
  /** 已贴合 → 停此位 */
  seat: Vec3;
  /** 待装配 → 停此位 */
  scatter: Vec3;
}

/** 计算真实装配体外包络中心到地板原点的平移量（只居中 X/Z，不改变高度）。 */
export function floorCenterOffset(parts: readonly SeatInput[]): Vec3 {
  if (parts.length === 0) return [0, 0, 0];
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const part of parts) {
    minX = Math.min(minX, part.center[0] - part.half[0]);
    maxX = Math.max(maxX, part.center[0] + part.half[0]);
    minZ = Math.min(minZ, part.center[2] - part.half[2]);
    maxZ = Math.max(maxZ, part.center[2] + part.half[2]);
  }
  return [(minX + maxX) / 2, 0, (minZ + maxZ) / 2];
}

/** 装配体质心（各零件 seat 中心的算术平均） */
function centroid(parts: readonly SeatInput[]): Vec3 {
  let x = 0;
  let y = 0;
  let z = 0;
  for (const p of parts) {
    x += p.center[0];
    y += p.center[1];
    z += p.center[2];
  }
  const n = Math.max(1, parts.length);
  return [x / n, y / n, z / n];
}

/**
 * 装配体包围半径：从质心到任一零件最远角点的距离。
 * 用来确定待料环半径，保证散落件落在装配体"外包络"之外、不互相遮挡贴合位。
 */
function boundingRadius(parts: readonly SeatInput[], c: Vec3): number {
  let r = 0;
  for (const p of parts) {
    const [hx, hy, hz] = p.half;
    const dx = Math.abs(p.center[0] - c[0]) + hx;
    const dy = Math.abs(p.center[1] - c[1]) + hy;
    const dz = Math.abs(p.center[2] - c[2]) + hz;
    const rr = Math.hypot(dx, dy, dz);
    if (rr > r) r = rr;
  }
  return r;
}

/** 装配体最高顶面高度（决定待料环抬升多少） */
function topHeight(parts: readonly SeatInput[]): number {
  let top = -Infinity;
  for (const p of parts) {
    const y = p.center[1] + p.half[1];
    if (y > top) top = y;
  }
  return Number.isFinite(top) ? top : 0;
}

/**
 * 为一批零件计算「贴合位 + 散落待料位」。
 *
 * @param parts  零件贴合基准（含 seat 中心与半轴）
 * @returns 每件两个目标位；顺序与入参一致。
 */
export function computeTwoStatePlacement(parts: readonly SeatInput[]): PartPlacement[] {
  if (parts.length === 0) return [];
  const c = centroid(parts);
  const r = boundingRadius(parts, c);
  const top = topHeight(parts);

  // 待料环参数：半径留出零件半身外扩；抬升到顶面以上 ~1.6 倍高度，保证悬空可见。
  const ringRadius = r + Math.max(4, r * 0.5);
  const lift = top + Math.max(3, r * 0.35);

  // Golden angle（~137.5°）错峰布环，避免排成规则对称导致视觉重叠
  const golden = Math.PI * (3 - Math.sqrt(5));

  return parts.map((p, i) => {
    const angle = golden * i;
    const scatter: Vec3 = [
      c[0] + ringRadius * Math.cos(angle),
      lift, // 平面待料环：y 恒为抬升高度
      c[2] + ringRadius * Math.sin(angle),
    ];
    return { partId: p.partId, seat: p.center as Vec3, scatter };
  });
}

/**
 * 由 `assembledPartIds` 选出每件的「当前应停位」：已贴合→seat，待装配→scatter。
 * 纯逻辑、可单测 —— 对应 S1 验收「渲染集合与 `assembledPartIds` 一致」的判据。
 *
 * @returns 按 placements 顺序输出 {partId, assembled, target}
 */
export function selectActivePoses(
  placements: readonly PartPlacement[],
  assembledIds: ReadonlySet<string>,
): Array<{ partId: string; assembled: boolean; target: Vec3 }> {
  return placements.map((pl) => {
    const assembled = assembledIds.has(pl.partId);
    return { partId: pl.partId, assembled, target: (assembled ? pl.seat : pl.scatter) as Vec3 };
  });
}
