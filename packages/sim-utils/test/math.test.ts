import { describe, expect, it } from 'vitest';
import { slerp, quatIdentity, vec3Dot, vec3Cross } from '../src/index.js';

describe('sim-utils math', () => {
  it('vec3Dot / vec3Cross 正确', () => {
    expect(vec3Dot([1, 0, 0], [1, 0, 0])).toBe(1);
    const c = vec3Cross([1, 0, 0], [0, 1, 0]);
    expect(c[0]).toBeCloseTo(0);
    expect(c[1]).toBeCloseTo(0);
    expect(c[2]).toBeCloseTo(1);
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
});
