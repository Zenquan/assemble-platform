import type { AABB, OBB, Vec3 } from '@assemble/domain';

/**
 * 由 AABB 派生「轴对齐的 OBB」。当零件尚未旋转时，OBB 三个轴向即世界轴。
 * 这在把后端/模型数据（仅含 AABB）快速接入 SAT 判定时很有用。
 */
export function aabbToObb(a: AABB): OBB {
  const cx = (a.min[0] + a.max[0]) / 2;
  const cy = (a.min[1] + a.max[1]) / 2;
  const cz = (a.min[2] + a.max[2]) / 2;
  return {
    center: [cx, cy, cz],
    axes: [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ],
    halfExtents: [
      (a.max[0] - a.min[0]) / 2,
      (a.max[1] - a.min[1]) / 2,
      (a.max[2] - a.min[2]) / 2,
    ],
  };
}

export function obbFromCenterHalfExtents(center: Vec3, halfExtents: Vec3): OBB {
  return {
    center,
    axes: [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ],
    halfExtents,
  };
}

export function obbCenter(obb: OBB): Vec3 {
  return [obb.center[0], obb.center[1], obb.center[2]];
}
