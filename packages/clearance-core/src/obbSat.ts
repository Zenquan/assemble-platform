import type { OBB, Vec3 } from '@assemble/domain';

/**
 * OBB-OBB 精确相交判定 —— Narrow Phase（SAT 分离轴定理）。
 *
 * 对两个方向包围盒，考察 15 条候选分离轴：
 *   - A 的三个面法向（A 的三条轴）      3
 *   - B 的三个面法向（B 的三条轴）      3
 *   - A 每条边与 B 每条边的叉积       3×3 = 9
 * 在任一条轴上，若两盒中心距在该轴的投影超过两盒半宽投影之和 => 分离（无干涉）；
 * 15 条轴全部未分离 => 两盒相交（干涉）。
 *
 * 对任意候选轴 L（单位向量），A 的半宽投影：
 *   ra = Σ_i hA[i] · |dot(A_i, L)|
 * B 同理。中心距投影 |dot(t, L)| > ra + rb 即分离。
 *
 * 复杂度：15 轴 × 常数次点积，单对判定在 ns~µs 级，满足装配拖拽逐帧检测目标。
 */

const EPS = 1e-9;
/** 端面接触容差（米）：恰好相贴不算干涉。 */
const CONTACT_EPS = 1e-6;

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

interface ObbData {
  center: Vec3;
  axes: readonly [Vec3, Vec3, Vec3];
  halfExtents: Vec3;
}

function fromObb(obb: OBB): ObbData {
  return { center: obb.center, axes: obb.axes, halfExtents: obb.halfExtents };
}

/** 半宽投影 */
function projectHalfWidth(d: ObbData, L: Vec3): number {
  const a = d.axes;
  const h = d.halfExtents;
  return (
    h[0] * Math.abs(dot(a[0], L)) +
    h[1] * Math.abs(dot(a[1], L)) +
    h[2] * Math.abs(dot(a[2], L))
  );
}

/** 沿轴 L 的分离测试：true = 该轴分离（两盒不相交） */
function separatedOnAxis(L: Vec3, a: ObbData, b: ObbData): boolean {
  const t: Vec3 = [
    b.center[0] - a.center[0],
    b.center[1] - a.center[1],
    b.center[2] - a.center[2],
  ];
  const dist = Math.abs(dot(t, L));
  const overlap = projectHalfWidth(a, L) + projectHalfWidth(b, L) - dist;
  return overlap <= CONTACT_EPS;
}

/** 叉积轴可能因平行退化，返回 null 则跳过 */
function crossAxis(a: Vec3, b: Vec3): Vec3 | null {
  const c = cross(a, b);
  const l = Math.hypot(c[0], c[1], c[2]);
  if (l < EPS) return null;
  return [c[0] / l, c[1] / l, c[2] / l];
}

/**
 * 判定两个 OBB 是否相交（存在干涉）。
 * @returns true = 相交（干涉）；false = 分离。
 */
export function obbIntersect(x: OBB, y: OBB): boolean {
  const A = fromObb(x);
  const B = fromObb(y);

  // A 的三条面法向
  for (let i = 0; i < 3; i++) {
    const ai = A.axes[i]!;
    if (separatedOnAxis(ai, A, B)) return false;
  }
  // B 的三条面法向
  for (let i = 0; i < 3; i++) {
    const bi = B.axes[i]!;
    if (separatedOnAxis(bi, A, B)) return false;
  }
  // A 边 × B 边 叉积（edge-edge）9 条
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      const L = crossAxis(A.axes[i]!, B.axes[j]!);
      if (!L) continue; // 平行边退化，跳过
      if (separatedOnAxis(L, A, B)) return false;
    }
  }
  return true;
}
