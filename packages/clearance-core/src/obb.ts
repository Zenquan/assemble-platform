import type { AssemblyPart, AABB, OBB, Quat, Vec3 } from '@assemble/domain';
import { quatRotate } from '@assemble/sim-utils';

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

/**
 * 由「BOM 零件位姿 + 资产实测包络尺寸」构造与 Babylon 视口同一口径的世界 OBB。
 *
 * Babylon 装配挂载统一执行 x/z 居中、y 底面贴锚点，因此：
 * - 局部中心偏移恒为 [0, sizeY/2, 0]，再由 localRotation 旋到世界；
 * - 半轴按旋转后的 AABB 外扩计算（世界 AABB），与当前前端不可见拾取/干涉
 *   代理的口径一致，避免离线报告与工作台实时判定出现“一侧说冲突一侧说干净”。
 * 当前仅需绕 Y 旋转（facingDeg），但实现按通用四元数处理，后续扩展不返工。
 */
export function obbFromBomPart(
  part: Pick<AssemblyPart, 'localPosition' | 'localRotation'>,
  size: Vec3,
): OBB {
  const [sx, sy, sz] = size;
  const localHalf: Vec3 = [(sx ?? 0) / 2, (sy ?? 0) / 2, (sz ?? 0) / 2];
  const q = part.localRotation;
  const axisX = quatRotate([1, 0, 0], q);
  const axisY = quatRotate([0, 1, 0], q);
  const axisZ = quatRotate([0, 0, 1], q);
  const halfExtents: Vec3 = [
    (localHalf[0] ?? 0) * Math.abs(axisX[0]) +
      (localHalf[1] ?? 0) * Math.abs(axisY[0]) +
      (localHalf[2] ?? 0) * Math.abs(axisZ[0]),
    (localHalf[0] ?? 0) * Math.abs(axisX[1]) +
      (localHalf[1] ?? 0) * Math.abs(axisY[1]) +
      (localHalf[2] ?? 0) * Math.abs(axisZ[1]),
    (localHalf[0] ?? 0) * Math.abs(axisX[2]) +
      (localHalf[1] ?? 0) * Math.abs(axisY[2]) +
      (localHalf[2] ?? 0) * Math.abs(axisZ[2]),
  ];
  const offset = quatRotate([0, (sy ?? 0) / 2, 0], q);
  const pos = part.localPosition;
  return {
    center: [(pos[0] ?? 0) + offset[0], (pos[1] ?? 0) + offset[1], (pos[2] ?? 0) + offset[2]],
    axes: [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ],
    halfExtents,
  };
}
