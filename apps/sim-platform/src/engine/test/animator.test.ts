/**
 * S2 · 装配过程动画纯逻辑单测（无 Babylon / WebGL，node 环境可跑）
 *
 * 覆盖 animator.ts 装配动画驱动器：
 *   1. `play()` 后按 BOM 步骤序 + durationSeconds 逐件自动贴合（散落→贴合走缓动）；
 *   2. 单件飞行中 `pose()` 返回 scatter→seat 插值位；动画完成才回调 onAssemble 落集合
 *      （视觉先滑、到位才落集合，杜绝跳变），此后由 S1 seat/scatter 判定接管；
 *   3. `seekTo` / `undoStep` 走跳变（清飞行、不插帧）；
 *   4. 用注入假时钟锁定推进节奏，无需真 rAF。
 *
 * 对齐验收「无 WebGL 单测走 Noop 状态断言」：onAssemble 回调即宿主对装配机的贴合动作，
 * 这里断言其调用序 = 步骤序、最终集合推进到全贴合。
 */
import { describe, expect, it } from 'vitest';

import type { AssemblyStep, Vec3 } from '@assemble/domain';
import { AssemblyAnimator } from '@/engine/animator';
import type { PartPlacement } from '@/engine/placement';

/** 造一个 layout（partId + seat/scatter 两目标位） */
function pl(partId: string, seat: [number, number, number], scatter: [number, number, number]): PartPlacement {
  return { partId, seat: seat as Vec3, scatter: scatter as Vec3 };
}

/** 造步骤表：seq 连续，durationSeconds 由入参给定 */
function mkSteps(partIds: string[], durations: number[]): AssemblyStep[] {
  return partIds.map((partId, i) => ({
    seq: i,
    partId,
    stationId: `station-${i}`,
    constraintIds: [],
    durationSeconds: durations[i] ?? 1,
    description: `装配第 ${i + 1} 件`,
  }));
}

/** 假时钟 + 一次性装配现场 */
function rig(partIds: string[], durations: number[]) {
  let now = 0;
  const parts = partIds.map((id, i) => pl(id, [i, 1, 0], [10 + i, 8, 0]));
  const steps = mkSteps(partIds, durations);
  const assembled: string[] = [];
  const anim = new AssemblyAnimator({
    placements: parts,
    getSteps: () => steps,
    onAssemble: (partId) => assembled.push(partId),
    now: () => now,
  });
  const clock = { advance: (ms: number) => { now += ms; }, get value() { return now; } };
  return { anim, steps, parts, assembled, clock };
}

describe('AssemblyAnimator · 装配过程动画（S2）', () => {
  it('play 后按步骤序 + durationSeconds 逐件自动贴合，最终集合推进到全贴合', () => {
    const { anim, steps, assembled, clock } = rig(['a', 'b', 'c'], [1, 2, 1]);
    expect(anim.play()).toBe(true);

    // 逐秒推进，覆盖三件各自动画时长（1+2+1 秒），每步 tick 足够多次保证动画完成
    for (let ms = 0; ms <= 4000; ms += 50) {
      clock.advance(50);
      anim.tick();
    }

    expect(anim.cursorSeq).toBe(3);
    expect(anim.cursorSeq).toBe(anim.totalSteps); // 播到全贴合
    expect(anim.playing).toBe(false);
    // 落集合序 = 步骤序，最终全贴合
    expect(assembled).toEqual(['a', 'b', 'c']);
    expect(anim.hasFlight).toBe(false);
  });

  it('单件动画期间 pose 返回 scatter→seat 插值；动画完成才落集合（onAssemble），此后脱离飞行', () => {
    const { anim, assembled, clock } = rig(['a'], [1]);
    anim.play();
    anim.tick(); // 第 0ms 把 a 登记进飞行（cursor→1），但尚未落集合
    expect(anim.hasFlight).toBe(true);
    expect(anim.cursorSeq).toBe(1);
    expect(assembled).toEqual([]); // 视觉滑行中，未落集合

    // 半程：position 介于 scatter 与 seat 之间（x 从 10 → 0），仍未落集合
    clock.advance(500);
    const mid = anim.pose('a');
    expect(mid).not.toBeNull();
    const mx = mid![0];
    expect(mx).toBeGreaterThan(0);
    expect(mx).toBeLessThan(10);
    expect(assembled).toEqual([]);

    // 全程结束（再 +500ms）：此刻回调 onAssemble 落集合，且脱离飞行表
    clock.advance(500);
    const r = anim.tick();
    expect(r.seatedPartId).toBe('a');
    expect(assembled).toEqual(['a']);
    expect(anim.hasFlight).toBe(false);
    expect(anim.pose('a')).toBeNull(); // 由 S1 seat/scatter 判定接管
  });

  it('seekTo 跳变：清飞行、游标对齐、停止播放（不产生过渡、不回调落集合）', () => {
    const { anim, assembled } = rig(['a', 'b', 'c'], [1, 1, 1]);
    anim.play();
    anim.tick();
    expect(anim.hasFlight).toBe(true);
    expect(anim.seekTo(2)).toBe(true);
    expect(anim.cursorSeq).toBe(2);
    expect(anim.hasFlight).toBe(false);
    expect(anim.playing).toBe(false);
    expect(assembled).toEqual([]); // 跳变不触发 onAssemble（落集合由宿主 seekTo 装配机自行处理）
  });

  it('undoStep 跳变回退游标并清飞行', () => {
    const { anim } = rig(['a', 'b', 'c'], [1, 1, 1]);
    anim.syncCursor(2);
    expect(anim.undoStep()).toBe(true);
    expect(anim.cursorSeq).toBe(1);
    expect(anim.undoStep()).toBe(true);
    expect(anim.cursorSeq).toBe(0);
    expect(anim.undoStep()).toBe(false); // 游标 0 时无法再退
  });

  it('非法 seek 越界返回 false 且不改状态', () => {
    const { anim } = rig(['a', 'b'], [1, 1]);
    anim.syncCursor(1);
    expect(anim.seekTo(5)).toBe(false);
    expect(anim.cursorSeq).toBe(1);
    expect(anim.seekTo(-1)).toBe(false);
    expect(anim.cursorSeq).toBe(1);
  });
});
