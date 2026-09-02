import type { AABB, Vec3 } from '@assemble/domain';

export function vec3Min(a: Vec3, b: Vec3): Vec3 {
  return [
    a[0] < b[0] ? a[0] : b[0],
    a[1] < b[1] ? a[1] : b[1],
    a[2] < b[2] ? a[2] : b[2],
  ];
}

export function vec3Max(a: Vec3, b: Vec3): Vec3 {
  return [
    a[0] > b[0] ? a[0] : b[0],
    a[1] > b[1] ? a[1] : b[1],
    a[2] > b[2] ? a[2] : b[2],
  ];
}

/** 由两个点扩出 AABB */
export function aabbFromPoints(a: Vec3, b: Vec3): AABB {
  return { min: vec3Min(a, b), max: vec3Max(a, b) };
}

/** 体积 */
export function aabbVolume(a: AABB): number {
  const dx = a.max[0] - a.min[0];
  const dy = a.max[1] - a.min[1];
  const dz = a.max[2] - a.min[2];
  return dx * dy * dz;
}
