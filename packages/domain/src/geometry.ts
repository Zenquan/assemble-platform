/**
 * 领域基础类型 —— 坐标/几何基元
 * 与 Babylon / 后端统一使用同一套数学契约。
 */

export type Vec3 = readonly [number, number, number];

/** 轴对齐包围盒 Axis-Aligned Bounding Box */
export interface AABB {
  min: Vec3;
  max: Vec3;
}

/** 方向包围盒 Oriented Bounding Box */
export interface OBB {
  /** 包围盒中心 */
  center: Vec3;
  /** 三个正交半轴方向（单位向量），索引 0/1/2 -> 局部 x/y/z 世界轴向 */
  axes: readonly [Vec3, Vec3, Vec3];
  /** 三个半轴长度 */
  halfExtents: Vec3;
}

export interface Quat {
  x: number;
  y: number;
  z: number;
  w: number;
}

export interface Matrix4 {
  /** 行主序 16 元数组 */
  elements: readonly number[];
}
