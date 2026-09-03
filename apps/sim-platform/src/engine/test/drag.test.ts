/**
 * S3 · 手动拖拽纯逻辑单测（无 Babylon / WebGL，node 环境可跑）
 *
 * 覆盖 drag.ts：
 *   1. `boxObbAt` 由中心+半轴构造轴对齐 OBB（轴向即世界轴、半轴正确）；
 *   2. `candidateCenterAt` 把指针在水平拖拽平面上的 XZ 换算为候选中心（保持 planeY）；
 *   3. `adjudicateLand` 三态裁决：贴近 seat 且无干涉→可落位；贴近但干涉→被拦截；
 *      未贴近→不可落位（无论是否干涉）；
 *   4. 吸附半径默认取零件最大半轴长；显式传入可收窄/放宽。
 *   5. 用 NoopClearance（委托 clearance-core 真算法）验证"命中已装配件"判定真实生效。
 */
import { describe, expect, it } from 'vitest';

import type { OBB, Vec3 } from '@assemble/domain';
import { NoopClearance } from '@/engine/noop';
import {
  adjudicateLand,
  boxObbAt,
  candidateCenterAt,
  ManualDragSession,
  rayPlaneYIntersect,
  type QueryInteractive,
} from '@/engine/drag';

/** 轴对齐 OBB 快捷构造（同 engine.test 语义） */
function box(center: [number, number, number], half: number): OBB {
  return {
    center,
    axes: [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ],
    halfExtents: [half, half, half],
  };
}

const part = (partId: string, center: [number, number, number], half = 5) => ({
  partId,
  obb: box(center, half),
});

describe('S3 · boxObbAt / candidateCenterAt', () => {
  it('boxObbAt：由中心+半轴构造轴对齐 OBB，半轴与轴向正确', () => {
    const obb = boxObbAt([3, 2, 1], [0.5, 0.8, 0.6] as Vec3);
    expect(obb.center).toEqual([3, 2, 1]);
    expect(obb.halfExtents).toEqual([0.5, 0.8, 0.6]);
    expect(obb.axes[0]).toEqual([1, 0, 0]);
    expect(obb.axes[1]).toEqual([0, 1, 0]);
    expect(obb.axes[2]).toEqual([0, 0, 1]);
  });

  it('candidateCenterAt：保持 planeY，XZ 取指针命中点', () => {
    const c = candidateCenterAt({ x: 12, y: 0, z: -7 }, 3.5);
    expect(c).toEqual([12, 3.5, -7]);
  });

  it('rayPlaneYIntersect：竖直向下射线命中水平面 y=planeY', () => {
    // 原点 (0,10,0) 沿 -Y → 命中 y=3 → t=7
    const p = rayPlaneYIntersect({ origin: [0, 10, 0], direction: [0, -1, 0] }, 3);
    expect(p).not.toBeNull();
    expect(p!.y).toBe(3);
    expect(p!.x).toBeCloseTo(0);
    expect(p!.z).toBeCloseTo(0);
  });

  it('rayPlaneYIntersect：与平面平行（dy≈0）→ null；交点反向 → null', () => {
    // 水平方向 dy=0
    expect(rayPlaneYIntersect({ origin: [0, 3, 0], direction: [1, 0, 0] }, 3)).toBeNull();
    // 方向 +Y（朝上远离 y=3 下方平面）在 origin.y>planeY 时 t<0 → null
    expect(rayPlaneYIntersect({ origin: [0, 3, 0], direction: [0, 1, 0] }, 1)).toBeNull();
  });
});

describe('S3 · adjudicateLand 落位裁决', () => {
  const half = [1, 1, 1] as Vec3; // 半轴 1 → 默认吸附半径 1
  const seat = [0, 1, 0] as Vec3; // seat 在原点、y=1
  // 拖拽平面 y=1（seat 高度）
  const boxInput = { partId: 'drag', center: seat, half };

  it('候选贴近 seat 且无干涉 → 可落位', () => {
    const clearQuery: QueryInteractive = () => [];
    const r = adjudicateLand('drag', boxInput.half, boxInput.center, [0.3, 1, 0.2], clearQuery);
    expect(r.canSnap).toBe(true);
    expect(r.clear).toBe(true);
    expect(r.hits).toHaveLength(0);
    expect(r.land).toBe(true);
  });

  it('候选贴近 seat 但未贴近（XZ 超吸附半径）→ 不可落位', () => {
    const clearQuery: QueryInteractive = () => [];
    const r = adjudicateLand('drag', boxInput.half, boxInput.center, [3, 1, 0], clearQuery);
    expect(r.canSnap).toBe(false);
    expect(r.land).toBe(false);
  });

  it('候选贴近 seat 且 XZ 进入但被已装配件挡住 → 被拦截（命中返回、不可落位）', () => {
    // 用一个真实 clearance：把一块已装配件放在靠近 seat 的位置
    const c = new NoopClearance();
    c.registerAssembled([part('seated', [0.6, 1, 0], 1)]); // 与 seat 重叠
    const hits = adjudicateLand('drag', half, seat, [0, 1, 0], (m) => c.queryInteractive(m));
    expect(hits.canSnap).toBe(true); // XZ 贴近（距离 0）
    expect(hits.clear).toBe(false); // 被 seated 挡住
    expect(hits.land).toBe(false); // 无法贴合
    expect(hits.hits.length).toBeGreaterThan(0);
    // hits 命中对含被拖拽件与已装配件（顺序按 domain 无向排序：firstId <= secondId）
    const ids = [hits.hits[0]!.firstPartId, hits.hits[0]!.secondPartId];
    expect(ids).toContain('seated');
    expect(ids).toContain('drag');
  });

  it('候选贴近 seat、无干涉但吸附半径显式放宽 → 更大范围可落位', () => {
    const clearQuery: QueryInteractive = () => [];
    const r = adjudicateLand('drag', half, seat, [1.5, 1, 0], clearQuery, 2);
    expect(r.canSnap).toBe(true); // 显式 snapRadius=2 > 距离 1.5
    expect(r.land).toBe(true);
  });

  it('候选贴近 seat、无干涉但吸附半径收紧 → 超出即不可落位', () => {
    const clearQuery: QueryInteractive = () => [];
    const r = adjudicateLand('drag', half, seat, [1.5, 1, 0], clearQuery, 1);
    expect(r.canSnap).toBe(false);
    expect(r.land).toBe(false);
  });
});

describe('S3c · ManualDragSession 有状态会话', () => {
  const half = [1, 1, 1] as Vec3;
  const seat = [0, 1, 0] as Vec3;

  it('begin → 贴近 seat 拖到干净候选 → 状态可落位', () => {
    const c = new NoopClearance(); // 无已装配 → 恒干净
    const s = new ManualDragSession();
    s.begin(
      { partId: 'p1', seat, half },
      (m) => c.queryInteractive(m),
      () => true,
    );
    expect(s.state.dragging).toBe(true);
    expect(s.state.partId).toBe('p1');
    // 移到 seat 附近（无干涉）
    s.moveTo([0.2, 1, 0]);
    expect(s.state.blocked).toBe(false);
    expect(s.state.nearSeat).toBe(true);
    expect(s.state.canLand).toBe(true);
    expect(s.state.reason).toBe('dragging');
  });

  it('moveTo 到已装配件干涉处 → blocked，reason=blocked', () => {
    const c = new NoopClearance();
    c.registerAssembled([part('seated', [0.5, 1, 0], 1)]); // 挡住 seat 附近
    const s = new ManualDragSession();
    s.begin({ partId: 'p1', seat, half }, (m) => c.queryInteractive(m), () => true);
    // 候选直接叠到 seated 上方 → 干涉
    s.moveTo([0.5, 1, 0]);
    expect(s.state.blocked).toBe(true);
    expect(s.state.hitPartId).toBe('seated');
    expect(s.state.canLand).toBe(false);
    expect(s.state.reason).toBe('blocked');
  });

  it('finish 命中 landDecision=true → landed；=false → snapped-back', () => {
    const c = new NoopClearance();
    const s = new ManualDragSession();
    // 决策可贴合
    const ok = new ManualDragSession();
    ok.begin({ partId: 'p1', seat, half }, (m) => c.queryInteractive(m), () => true);
    ok.moveTo([0.1, 1, 0]);
    expect(ok.finish()).toBe(true);
    expect(ok.state.reason).toBe('landed');

    // 决策驳回
    const no = new ManualDragSession();
    no.begin({ partId: 'p1', seat, half }, (m) => c.queryInteractive(m), () => false);
    no.moveTo([0.1, 1, 0]);
    expect(no.finish()).toBe(false);
    expect(no.state.reason).toBe('snapped-back');
  });

  it('abort → 清回 idle', () => {
    const c = new NoopClearance();
    const s = new ManualDragSession();
    s.begin({ partId: 'p1', seat, half }, (m) => c.queryInteractive(m), () => true);
    expect(s.dragging).toBe(true);
    s.abort();
    expect(s.dragging).toBe(false);
    expect(s.state.partId).toBe('');
    expect(s.state.reason).toBe('idle');
  });
});

