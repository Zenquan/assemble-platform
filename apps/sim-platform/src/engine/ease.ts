/**
 * S2 · 装配过程动画 —— 缓动与插值纯函数基元（无 Babylon / DOM，可无 WebGL 单测）
 *
 * 只做「一个标量 / 一个 Vec3 从 A 平滑到 B」的时间函数，不含任何装配/渲染语义。
 * 动画的"谁在动、动到哪、何时开始/结束"由 animator.ts 编排，本模块只回答：
 *   ease(t)     → 把 [0,1] 时间映射为 [0,1] 位移（默认 easeInOutCubic）；
 *   lerpVec3    → 按位移在两向量间取点。
 * 纯函数、无副作用 → vitest 可锁定曲线端点/单调性/对称性。
 */
import type { Vec3 } from '@assemble/domain';

/** 缓动函数：入参 t∈[0,1]，返回位移∈[0,1] */
export type EaseFn = (t: number) => number;

/** 三次缓入缓出 —— 工业装配动画常用：起步慢、中段快、收尾缓，视觉"平滑就位" */
export function easeInOutCubic(t: number): number {
  const x = clamp01(t);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

/** 线性（诊断/调试或 seek 预览用，默认装配走 easeInOutCubic） */
export function easeLinear(t: number): number {
  return clamp01(t);
}

function clamp01(x: number): number {
  return x <= 0 ? 0 : x >= 1 ? 1 : x;
}

/** 标量插值：a + (b-a)*k */
export function lerp(a: number, b: number, k: number): number {
  return a + (b - a) * k;
}

/** 向量插值（逐分量） */
export function lerpVec3(a: Vec3, b: Vec3, k: number): Vec3 {
  return [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)] as Vec3;
}

/**
 * 把"某个 [t0,t1] 内的时间点"归一为位移进度。
 * - t0 未到 → 0；t1 已过 → 1；之间 → ease((t-t0)/(t1-t0))。
 * - t0===t1（零时长）→ 瞬时到 1（seek/瞬时贴合用）。
 * 纯函数、确定性，可单测锁定端点与对称性。
 */
export function progressAt(now: number, t0: number, t1: number, ease: EaseFn = easeInOutCubic): number {
  if (t1 <= t0) return now >= t1 ? 1 : 0;
  if (now <= t0) return 0;
  if (now >= t1) return 1;
  return ease((now - t0) / (t1 - t0));
}
