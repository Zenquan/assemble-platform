/**
 * S1 · 分态渲染纯布局单测（无 Babylon / WebGL，node 环境可跑）
 *
 * 覆盖 placement.ts 两条纯逻辑：
 *   1. `computeTwoStatePlacement` —— 每个零件算出 seat(贴合位) + scatter(散落待料位)，
 *      确定性、seat 恒等于输入 center、scatter 与 seat 分离。
 *   2. `selectActivePoses` —— 由 `assembledPartIds` 选出「已贴合→seat / 待装配→scatter」，
 *      对应 S1 验收判据「渲染集合与 assembledPartIds 一致」。
 */
import { describe, expect, it } from 'vitest';

import type { Vec3 } from '@assemble/domain';
import { computeTwoStatePlacement, floorCenterOffset, selectActivePoses, type SeatInput } from '@/engine/placement';

/** 造一个零件（seat 中心 + 半轴） */
const p = (partId: string, center: [number, number, number], half: [number, number, number] = [1, 1, 1]): SeatInput => ({
  partId,
  center: center as Vec3,
  half: half as Vec3,
});

/** 一个紧凑装配体样本（座 + 两轴上件，仿 8×N 合成布局的一角） */
function sample(): SeatInput[] {
  return [
    p('base', [0, 1, 0], [4, 1, 4]),
    p('a', [0, 3, 0], [1, 1, 1]),
    p('b', [2.2, 3, 0], [1, 1, 1]),
    p('c', [0, 3, 2.2], [1, 1, 1]),
    p('d', [2.2, 3, 2.2], [1, 1, 1]),
  ];
}

describe('computeTwoStatePlacement（S1 分态布局）', () => {
  it('按零件外包络计算底板居中偏移，不改变 Y 高度', () => {
    const offset = floorCenterOffset([
      p('left', [-4, 2, 3], [2, 1, 1]),
      p('right', [8, 5, -1], [1, 2, 2]),
    ]);
    expect(offset).toEqual([1.5, 0, 0.5]);
  });

  it('每件算出 seat（=输入贴合中心）与一个与之分离的 scatter 待料位', () => {
    const parts = sample();
    const res = computeTwoStatePlacement(parts);
    expect(res).toHaveLength(parts.length);
    for (const [i, pl] of res.entries()) {
      const src = parts[i] as SeatInput;
      expect(pl.partId).toBe(src.partId);
      // seat 恒等于贴合中心（已装配常驻位）
      expect(pl.seat).toEqual(src.center);
      // scatter 须与 seat 分离（待装配要"离开贴合位"，否则分态无意义）
      const dx = Math.abs(pl.scatter[0] - pl.seat[0]);
      const dy = Math.abs(pl.scatter[1] - pl.seat[1]);
      const dz = Math.abs(pl.scatter[2] - pl.seat[2]);
      expect(dx + dy + dz).toBeGreaterThan(1e-6);
    }
  });

  it('确定性：同输入两次调用输出逐位一致（散落位可复现）', () => {
    const parts = sample();
    const a = computeTwoStatePlacement(parts);
    const b = computeTwoStatePlacement(parts);
    expect(a).toEqual(b);
    for (let i = 0; i < a.length; i++) {
      expect(a[i]!.scatter).toEqual(b[i]!.scatter);
    }
  });

  it('空输入返回空数组（不炸）', () => {
    expect(computeTwoStatePlacement([])).toEqual([]);
  });

  it('散落件不与贴合簇同一高度：scatter 的 y 高于任一 seat 顶面（待料环悬空）', () => {
    const parts = sample();
    const res = computeTwoStatePlacement(parts);
    const maxSeatTop = Math.max(...parts.map((s) => s.center[1] + s.half[1]));
    for (const pl of res) {
      expect(pl.scatter[1]).toBeGreaterThan(maxSeatTop);
    }
  });
});

describe('selectActivePoses（assembledPartIds → 应停位）', () => {
  it('已装配零件选 seat，未装配零件选 scatter —— 与集合一致', () => {
    const parts = sample();
    const placements = computeTwoStatePlacement(parts);
    // 例：base + a 已装，其余待装配
    const assembled = new Set(['base', 'a']);
    const poses = selectActivePoses(placements, assembled);
    expect(poses).toHaveLength(parts.length);
    for (const pose of poses) {
      const isAssembled = assembled.has(pose.partId);
      expect(pose.assembled).toBe(isAssembled);
      const expected = isAssembled
        ? (placements.find((pl) => pl.partId === pose.partId)!.seat as Vec3)
        : (placements.find((pl) => pl.partId === pose.partId)!.scatter as Vec3);
      expect(pose.target).toEqual(expected);
    }
  });

  it('空集合 → 全部落 scatter（散落态起点）；全集合 → 全部落 seat（整机态）', () => {
    const parts = sample();
    const placements = computeTwoStatePlacement(parts);
    const none = selectActivePoses(placements, new Set());
    expect(none.every((q) => !q.assembled)).toBe(true);
    expect(none.every((q) => q.target[1] > 0 && q.target[1] > 2)).toBe(true);

    const all = selectActivePoses(placements, new Set(parts.map((s) => s.partId)));
    expect(all.every((q) => q.assembled)).toBe(true);
    for (let i = 0; i < all.length; i++) {
      expect(all[i]!.target).toEqual(placements[i]!.seat);
    }
  });

  it('部分撤销：集合缩减后该件回到散落位（与当前集合一致）', () => {
    const parts = sample();
    const placements = computeTwoStatePlacement(parts);
    const all = new Set(parts.map((s) => s.partId));
    // 撤销 "d"（等价于从 assembledPartIds 移除）
    const after = new Set(all);
    after.delete('d');
    const poses = selectActivePoses(placements, after);
    const d = poses.find((q) => q.partId === 'd')!;
    expect(d.assembled).toBe(false);
    // d 的目标应等于它的 scatter（放回待料位）
    expect(d.target).toEqual(placements.find((pl) => pl.partId === 'd')!.scatter);
  });
});
