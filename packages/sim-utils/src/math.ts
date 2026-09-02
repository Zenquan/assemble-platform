import type { Vec3, Quat, Matrix4 } from '@assemble/domain';

/** 向量构造（尽量复用预分配对象减少 GC） */
export function vec3(x = 0, y = 0, z = 0): Vec3 {
  return [x, y, z];
}

export function vec3Zero(): Vec3 {
  return [0, 0, 0];
}

export function vec3Length(v: Vec3): number {
  return Math.hypot(v[0], v[1], v[2]);
}

export function vec3Add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function vec3Sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function vec3Scale(a: Vec3, s: number): Vec3 {
  return [a[0] * s, a[1] * s, a[2] * s];
}

export function vec3Dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function vec3Cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

export function vec3Normalize(v: Vec3): Vec3 {
  const len = vec3Length(v);
  if (len < 1e-12) return vec3Zero();
  return vec3Scale(v, 1 / len);
}

export function vec3DistanceSq(a: Vec3, b: Vec3): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];
  return dx * dx + dy * dy + dz * dz;
}

/** 线性插值 0..1 */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

const EPS = 1e-8;

/**
 * 四元数线性插值（近似 slerp），用于装配贴合平滑过渡。
 * 处理了负点积翻转，保证最短路径；当夹角很小时退化为 nlerp 提升数值稳定。
 */
export function slerp(a: Quat, b: Quat, t: number): Quat {
  let cosOmega = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;
  let bFlip = b;
  if (cosOmega < 0) {
    cosOmega = -cosOmega;
    bFlip = { x: -b.x, y: -b.y, z: -b.z, w: -b.w };
  }
  if (cosOmega > 1 - EPS) {
    // 夹角极小 -> nlerp
    const out = {
      x: a.x + (bFlip.x - a.x) * t,
      y: a.y + (bFlip.y - a.y) * t,
      z: a.z + (bFlip.z - a.z) * t,
      w: a.w + (bFlip.w - a.w) * t,
    };
    const len = Math.hypot(out.x, out.y, out.z, out.w) || 1;
    return { x: out.x / len, y: out.y / len, z: out.z / len, w: out.w / len };
  }
  const omega = Math.acos(cosOmega);
  const sinOmega = Math.sin(omega);
  const s0 = Math.sin((1 - t) * omega) / sinOmega;
  const s1 = Math.sin(t * omega) / sinOmega;
  return {
    x: a.x * s0 + bFlip.x * s1,
    y: a.y * s0 + bFlip.y * s1,
    z: a.z * s0 + bFlip.z * s1,
    w: a.w * s0 + bFlip.w * s1,
  };
}

export function quatIdentity(): Quat {
  return { x: 0, y: 0, z: 0, w: 1 };
}

/** 单位阵 */
export function mat4Identity(): Matrix4 {
  return {
    elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
  };
}

/** 由平移构建（行主序） */
export function mat4FromTranslation(t: Vec3): Matrix4 {
  return { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, t[0], t[1], t[2], 1] };
}

/**
 * 求矩阵对点 p 的变换（列主序约定行主序 elements，最后一个为平移列。
 * 这里采用 glTF/Babylon 通用的列主序乘法语义：elements[c*4+r]）。
 * 简化为直接支持平移 + 旋转提取。
 */
export function mat4TransformPoint(m: Matrix4, p: Vec3): Vec3 {
  const e = m.elements;
  const x = p[0]!, y = p[1]!, z = p[2]!;
  return [
    e[0]! * x + e[4]! * y + e[8]! * z + e[12]!,
    e[1]! * x + e[5]! * y + e[9]! * z + e[13]!,
    e[2]! * x + e[6]! * y + e[10]! * z + e[14]!,
  ];
}

export function mat4Multiply(a: Matrix4, b: Matrix4): Matrix4 {
  const A = a.elements, B = b.elements;
  const out = new Array<number>(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      out[c * 4 + r] =
        A[0 * 4 + r]! * B[c * 4 + 0]! +
        A[1 * 4 + r]! * B[c * 4 + 1]! +
        A[2 * 4 + r]! * B[c * 4 + 2]! +
        A[3 * 4 + r]! * B[c * 4 + 3]!;
    }
  }
  return { elements: out as unknown as readonly number[] };
}

/** clamp 0..1 */
export function clamp01(t: number): number {
  return t < 0 ? 0 : t > 1 ? 1 : t;
}
