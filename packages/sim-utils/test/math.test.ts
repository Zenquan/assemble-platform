import { describe, expect, it } from 'vitest';
import {
  clamp01,
  lerp,
  mat4FromTranslation,
  mat4Identity,
  mat4Multiply,
  mat4TransformPoint,
  quatIdentity,
  quatRotate,
  slerp,
  vec3,
  vec3Add,
  vec3Cross,
  vec3DistanceSq,
  vec3Dot,
  vec3Length,
  vec3Normalize,
  vec3Scale,
  vec3Sub,
  vec3Zero,
} from '../src/index.js';

describe('sim-utils math', () => {
  it('vec3Dot / vec3Cross 正确', () => {
    expect(vec3Dot([1, 0, 0], [1, 0, 0])).toBe(1);
    const c = vec3Cross([1, 0, 0], [0, 1, 0]);
    expect(c[0]).toBeCloseTo(0);
    expect(c[1]).toBeCloseTo(0);
    expect(c[2]).toBeCloseTo(1);
  });

  it('vec3 构造/零向量/加减/缩放/长度/距离', () => {
    expect(vec3()).toEqual([0, 0, 0]);
    expect(vec3(1, 2, 3)).toEqual([1, 2, 3]);
    expect(vec3Zero()).toEqual([0, 0, 0]);
    expect(vec3Add([1, 2, 3], [4, 5, 6])).toEqual([5, 7, 9]);
    expect(vec3Sub([4, 5, 6], [1, 2, 3])).toEqual([3, 3, 3]);
    expect(vec3Scale([1, 2, 3], 2)).toEqual([2, 4, 6]);
    expect(vec3Length([3, 4, 0])).toBeCloseTo(5);
    expect(vec3DistanceSq([0, 0, 0], [3, 4, 0])).toBe(25);
  });

  it('vec3Normalize 归一化单位向量，零向量退回零', () => {
    const n = vec3Normalize([3, 0, 0]);
    expect(n[0]).toBeCloseTo(1);
    expect(n[1]).toBeCloseTo(0);
    expect(n[2]).toBeCloseTo(0);
    expect(vec3Normalize([0, 0, 0])).toEqual([0, 0, 0]);
  });

  it('lerp / clamp01 线性插值与边界裁剪', () => {
    expect(lerp(0, 10, 0.5)).toBe(5);
    expect(clamp01(-1)).toBe(0);
    expect(clamp01(0.5)).toBe(0.5);
    expect(clamp01(2)).toBe(1);
  });

  it('slerp 在 t=0 返回 a，t=1 返回 b', () => {
    const qa = { x: 0, y: 0, z: 0, w: 1 };
    const qb = { x: 0, y: 0, z: Math.SQRT1_2, w: Math.SQRT1_2 };
    const s0 = slerp(qa, qb, 0);
    const s1 = slerp(qa, qb, 1);
    expect(s0).toEqual(qa);
    expect(s1.x).toBeCloseTo(qb.x);
    expect(s1.y).toBeCloseTo(qb.y);
    expect(s1.z).toBeCloseTo(qb.z);
    expect(s1.w).toBeCloseTo(qb.w);
  });

  it('slerp 中点 t=0.5 长度为 1 且在正确方向', () => {
    const qa = quatIdentity();
    const qb = { x: 0, y: 0, z: Math.SQRT1_2, w: Math.SQRT1_2 };
    const mid = slerp(qa, qb, 0.5);
    const len = Math.hypot(mid.x, mid.y, mid.z, mid.w);
    expect(len).toBeCloseTo(1);
    // 绕 Z 转 45° 的一半约 22.5°，z 分量 = sin(22.5°)
    expect(mid.z).toBeCloseTo(Math.sin(Math.PI / 8), 4);
  });

  it('slerp 负点积翻转走最短路径', () => {
    // qb = -qa，点积为负，应翻转而非绕远路
    const qa = quatIdentity();
    const qb = { x: 0, y: 0, z: 0, w: -1 };
    const mid = slerp(qa, qb, 0.5);
    // 最短路径下，绕 180° 的中点在单位四元数球面上，长度恒为 1
    expect(Math.hypot(mid.x, mid.y, mid.z, mid.w)).toBeCloseTo(1);
  });

  it('slerp 夹角极小退化 nlerp 仍返回单位四元数', () => {
    const qa = quatIdentity();
    const qb = { x: 0.000001, y: 0, z: 0, w: 1 };
    const out = slerp(qa, qb, 0.5);
    expect(Math.hypot(out.x, out.y, out.z, out.w)).toBeCloseTo(1);
  });

  it('quatRotate 与 Babylon RotationYawPitchRoll 一致：Y 轴正转 90° 把 X 转到 -Z', () => {
    const q = { x: 0, y: Math.SQRT1_2, z: 0, w: Math.SQRT1_2 };
    const out = quatRotate([1, 0, 0], q);
    expect(out[0]).toBeCloseTo(0, 8);
    expect(out[1]).toBeCloseTo(0, 8);
    expect(out[2]).toBeCloseTo(-1, 8);
  });

  it('mat4 单位阵/平移/点变换/乘法', () => {
    const id = mat4Identity();
    expect(id.elements).toEqual([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

    const t = mat4FromTranslation([10, 20, 30]);
    expect(t.elements[12]).toBe(10);
    expect(t.elements[13]).toBe(20);
    expect(t.elements[14]).toBe(30);

    // 平移变换
    const p = mat4TransformPoint(t, [1, 2, 3]);
    expect(p[0]).toBeCloseTo(11);
    expect(p[1]).toBeCloseTo(22);
    expect(p[2]).toBeCloseTo(33);

    // 单位阵变换点不变
    const q = mat4TransformPoint(id, [5, 6, 7]);
    expect(q).toEqual([5, 6, 7]);

    // 矩阵乘法：单位阵 * 平移 = 平移
    const prod = mat4Multiply(id, t);
    expect(prod.elements[12]).toBeCloseTo(10);
    expect(prod.elements[13]).toBeCloseTo(20);
    expect(prod.elements[14]).toBeCloseTo(30);
  });
});

