/**
 * S2 · 装配过程动画纯逻辑单测（无 Babylon / WebGL，node 环境可跑）
 *
 * 覆盖 animator.ts 装配动画驱动器：
 *   1. `play()` 后按 BOM 步骤序 + durationSeconds 逐件自动贴合（散落→贴合走缓动）；
 *   2. 单件飞行中 `pose()` 返回 scatter→seat 插值位；过渡结束从飞行表移除，
 *      由 S1 seat/scatter 判定接管；
 *   3. `seekTo` / `undoStep` 走跳变（清飞行、不插帧）；
 *   4. 用注入假时钟锁定推进节奏，无需真 rAF。
 *
 * 对齐验收「无 WebGL 单测走 Noop 状态断言」：onAssemble 回调即宿主对装配机的贴合动作，
 * 这里断言其调用序 = 步骤序、最终集合推进到全贴合。
 */
import { describe, expect, it } from 'vitest';

import type { AssemblyStep, Vec3 } from '@assemble/domain';
import { AssemblyAnimator, type PartPlacement } from '@/engine/animator';

/** 造一个 layout（partId + seat/scatter 两目标位） */
function pl(partId: string, seat: [number, number, number], scatter: [number, number, number]): PartPlacement {
  return { partId, seat: seat as Vec3, scatter: scatter as Vec3 };
}

/** 造步骤表：seq 连续，durationSeconds 由入参给定 */
function mkSteps(partIds: string[], durations: number[]): AssemblyStep[] {
  return partIds.map((partId, i) => ({
    seq: i,
    partId,
    constraintIds: [],
    durationSeconds: durations[i] ?? 1,
    description: `装配第 ${i + 1} 件`,
  }));
}

/** 假时钟 + 一次性装配现场 */
function rig(partIds: string[], durations: number[]) {
  let now = 0;
  const seats = new Map<string, Vec3>();
  const parts = partIds.map((id, i) => pl(id, [i, 1, 0], [10 + i, 8, 0]));
  const steps = mkSteps(partIds, durations);
  const assembled: string[] = [];
  const anim = new AssemblyAnimator({
    placements: parts,
    getSteps: () => steps,
    onAssemble: (partId) => {
      assembled.push(partId);
      seats.set(partId, parts.find((p) => p.partId === partId)!.seat);
    },
    now: () => now,
  });
  const clock = { advance: (ms: number) => { now += ms; }, get now() { return now; } };
  return { anim, steps, parts, assembled, seats, clock };
}

describe('AssemblyAnimator · 装配过程动画（S2）', () => {
  it('play 后按步骤序 + durationSeconds 逐件自动贴合，最终集合推进到全贴合', () => {
    const { anim, steps, assembled, clock } = rig(['a', 'b', 'c'], [1, 2, 1]);
    // play 触发第一件在 now（第 0ms）贴合
    expect(anim.play()).toBe(true);
    anim.tick();
    // 尚未到贴合结束（第 0ms 贴合，需推进 1s 才播完过渡），但游标应已到 1
    expect(anim.cursorSeq).toBe(1);

    // 推进到第一件完成（1000ms）
    clock.advance(1000);
    let r = anim.tick();
    // 此刻已可贴合第二件（其贴合时刻 = 首件开始 + dur0 = 1000ms）
    expect(r.seatedPartId).toBe('b');

    clock.advance(2000); // 第二件 duration 2s
    r = anim.tick();
    expect(r.seatedPartId).toBe('c');

    clock.advance(1000); // 第三件 duration 1s
    r = anim.tick();
    expect(r.done).toBe(true);
    expect(anim.cursorSeq).toBe(3);
    expect(anim.playing).toBe(false);
    // 装配集合 = 全部步骤序
    expect(assembled).toEqual(['a', 'b', 'c']);
  });

  it('单件飞行中 pose 返回 scatter→seat 插值；过渡结束脱离飞行（由 S1 seat/scatter 判定接管）', () => {
    const { anim, clock } = rig(['a'], [1]);
    anim.play();
    anim.tick(); // 第 0ms 贴合 a，进入飞行（t0=0,t1=1000）
    expect(anim.hasFlight).toBe(true);

    // 半程：position 应介于 scatter 与 seat 之间（x 从 10 → 0）
    clock.advance(500);
    const mid = anim.pose('a');
    expect(mid).not.toBeNull();
    const mx = mid![0];
    expect(mx).toBeGreaterThan(0);
    expect(mx).toBeLessThan(10);

    // 全程结束：脱离飞行表，pose 返回 null（后续由渲染层按 assembledId 落 seat）
    clock.advance(500);
    anim.tick();
    expect(anim.hasFlight).toBe(false);
    expect(anim.pose('a')).toBeNull();
  });

  it('seekTo 跳变：清飞行、游标对齐、停止播放（不产生过渡）', () => {
    const { anim } = rig(['a', 'b', 'c'], [1, 1, 1]);
    anim.play();
    anim.tick();
    expect(anim.hasFlight).toBe(true);
    expect(anim.seekTo(2)).toBe(true);
    expect(anim.cursorSeq).toBe(2);
    expect(anim.hasFlight).toBe(false);
    expect(anim.playing).toBe(false);
  });

  it('undoStep 跳变回退游标并清飞行', () => {
    const { anim } = rig(['a', 'b', 'c'], [1, 1, 1]);
    anim.syncCursor(2);
    expect(anim.undoStep()).toBe(true);
    expect(anim.cursorSeq).toBe(1);
    expect(anim.undoStep()).toBe(true);
    expect(anim.cursorSeq).toBe(0);
    // 游标 0 时无法再退
    expect(anim.undoStep()).toBe(false);
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
