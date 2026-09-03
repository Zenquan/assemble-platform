/**
 * S4 · BOM 树纯逻辑单测（无 Babylon / WebGL，node 环境可跑）
 *
 * 覆盖 bomtree.ts：
 *   1. `groupStepsByStation` round-robin 归组：step seq i → stations[i % n]，
 *      组内/组间顺序确定（可复现快照）。
 *   2. `deriveBomTreeState` 状态标注：done（已装配 / step<current）/ current（==current）
 *      / pending（>current），工位 doneCount、选中零件透传、allDone 判定。
 *   3. 防御：孤儿步骤（BOM 里零件缺失）跳过；空 stations 兜底不崩。
 *   4. 基座（isMovable=false）标记 isBase，非可动。
 */
import { describe, expect, it } from 'vitest';

import type { AssemblyBom, AssemblyPart, Station } from '@assemble/domain';
import { deriveBomTreeState, groupStepsByStation } from '@/engine/bomtree';

/** 造 3 工位 */
const stations: Station[] = [
  { id: 'st-a', lineId: 'L', seq: 1, name: '上料', taktSeconds: 3.2 },
  { id: 'st-b', lineId: 'L', seq: 2, name: '分拣', taktSeconds: 2.6 },
  { id: 'st-c', lineId: 'L', seq: 3, name: '装箱', taktSeconds: 3.8 },
];

/** 造 n 个可动零件 + 一个基座（第 0 件不可动），全部有对应 step */
function makeBom(n = 6): AssemblyBom {
  const parts: AssemblyPart[] = [];
  const steps: AssemblyBom['steps'] = [];
  for (let i = 0; i < n; i++) {
    parts.push({
      id: `L-${String(i).padStart(3, '0')}`,
      name: `部件 ${i + 1}`,
      assetId: `L-${i}`,
      localPosition: [0, 0, 0],
      localRotation: { x: 0, y: 0, z: 0, w: 1 },
      isMovable: i !== 0,
    });
    steps.push({ seq: i, partId: `L-${String(i).padStart(3, '0')}`, constraintIds: [], durationSeconds: 1 });
  }
  return { lineId: 'L', parts, constraints: [], steps };
}

describe('S4 · groupStepsByStation round-robin 归组', () => {
  it('step seq i 归到 stations[i % n]，组内按 seq 升序', () => {
    const bom = makeBom(6);
    const assigned = groupStepsByStation(bom, stations);
    // seq0→st-a, seq1→st-b, seq2→st-c, seq3→st-a, seq4→st-b, seq5→st-c
    expect(assigned.map((a) => `${a.station.id}:${a.step.seq}`)).toEqual([
      'st-a:0',
      'st-a:3',
      'st-b:1',
      'st-b:4',
      'st-c:2',
      'st-c:5',
    ]);
  });

  it('同一 (bom, stations) 恒同输出（可复现）', () => {
    const bom = makeBom(5);
    const a = groupStepsByStation(bom, stations);
    const b = groupStepsByStation(bom, stations);
    expect(a).toEqual(b);
  });

  it('孤儿步骤（BOM 缺零件）被跳过，不崩溃', () => {
    const bom = makeBom(3);
    bom.steps.push({ seq: 99, partId: 'missing-part', constraintIds: [], durationSeconds: 1 });
    const assigned = groupStepsByStation(bom, stations);
    expect(assigned.some((a) => a.step.partId === 'missing-part')).toBe(false);
  });

  it('空工位兜底：单件也不崩（%1 全归唯一工位）', () => {
    const bom = makeBom(2);
    const one: Station[] = [{ id: 'st-only', lineId: 'L', seq: 1, name: '唯一', taktSeconds: 1 }];
    const assigned = groupStepsByStation(bom, one);
    expect(assigned.length).toBe(2);
    expect(assigned.every((a) => a.station.id === 'st-only')).toBe(true);
  });
});

describe('S4 · deriveBomTreeState 状态标注', () => {
  it('当前 step 高亮 current，此前 done，此后 pending；doneCount 累计', () => {
    const bom = makeBom(6);
    // step0 done（assembled），cur=1 → seq1 为 current
    const model = deriveBomTreeState(bom, stations, {
      assembledIds: ['L-000'],
      currentStepSeq: 1,
    });
    expect(model.totalSteps).toBe(6);
    expect(model.assembledCount).toBe(1);
    expect(model.allDone).toBe(false);

    // 全部行展平找各状态
    const rows = model.groups.flatMap((g) => g.parts);
    const byId = new Map(rows.map((r) => [r.partId, r]));
    // L-000(seq0)→st-a, L-001(seq1)→st-b, L-002(seq2)→st-c, ...
    expect(byId.get('L-000')!.done).toBe(true);
    expect(byId.get('L-000')!.current).toBe(false);
    expect(byId.get('L-001')!.done).toBe(false); // 未装配，seq1===cur 是 current 非 done
    expect(byId.get('L-001')!.current).toBe(true);
    expect(byId.get('L-002')!.current).toBe(false);
    expect(byId.get('L-002')!.done).toBe(false); // pending
  });

  it('done 也以 step<current 判定（seekTo 语义），与 assembledIds 解耦', () => {
    const bom = makeBom(4);
    // cur=3 但 assembledIds 为空 → done 仍按 seq<3 判定（NoopAssembler.seekTo 后集合与游标一致，
    // 但本函数对"集合缺同步"免疫）
    const model = deriveBomTreeState(bom, stations, { assembledIds: [], currentStepSeq: 3 });
    const rows = model.groups.flatMap((g) => g.parts);
    const doneRows = rows.filter((r) => r.done);
    expect(doneRows.map((r) => r.partId).sort()).toEqual(['L-000', 'L-001', 'L-002'].sort());
  });

  it('全部贴合 → allDone=true，工位 doneCount=行数', () => {
    const bom = makeBom(3);
    const model = deriveBomTreeState(bom, stations, {
      assembledIds: ['L-000', 'L-001', 'L-002'],
      currentStepSeq: 3,
    });
    expect(model.allDone).toBe(true);
    const totalDone = model.groups.reduce((s, g) => s + g.doneCount, 0);
    expect(totalDone).toBe(3);
  });

  it('选中零件透传到 selectedPartId（供视口联动）', () => {
    const bom = makeBom(4);
    const model = deriveBomTreeState(bom, stations, {
      assembledIds: [],
      currentStepSeq: 0,
      selectedPartId: 'L-002',
    });
    expect(model.selectedPartId).toBe('L-002');
  });

  it('基座（isMovable=false）行标 isBase=true 且不可动', () => {
    const bom = makeBom(4);
    const model = deriveBomTreeState(bom, stations, { assembledIds: [], currentStepSeq: 0 });
    const rows = model.groups.flatMap((g) => g.parts);
    const base = rows.find((r) => r.partId === 'L-000')!;
    expect(base.isBase).toBe(true);
    expect(base.isMovable).toBe(false);
    const mover = rows.find((r) => r.partId === 'L-001')!;
    expect(mover.isBase).toBe(false);
    expect(mover.isMovable).toBe(true);
  });

  it('空步骤 BOM → groups 空、totalSteps 0、allDone true（无待装）', () => {
    const bom: AssemblyBom = { lineId: 'L', parts: [], constraints: [], steps: [] };
    const model = deriveBomTreeState(bom, stations, { assembledIds: [], currentStepSeq: 0 });
    expect(model.groups.length).toBe(0);
    expect(model.totalSteps).toBe(0);
    expect(model.allDone).toBe(true);
  });
});
