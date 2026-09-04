/**
 * S4 · 节拍面板纯逻辑单测（无 HTTP / 无 DOM，node 环境可跑）
 *
 * 覆盖 taktpanel.ts：
 *   1. `deriveTaktPanel`：服务端目标、开动率、瓶颈和工位负荷映射。
 *   2. 负荷分级边界：load<0.9 → ok；0.9<=load<=1 → busy；>1 → overload。
 *   3. 工位名缺省回退 stationId；meetsTarget 直接透传。
 */
import { describe, expect, it } from 'vitest';

import type { Station, TaktBottleneckResult } from '@assemble/domain';
import { deriveTaktPanel, type TaktPanelModel } from '@/engine/taktpanel';

const stations: Station[] = [
  { id: 'st-a', lineId: 'L', seq: 1, name: '上料', taktSeconds: 3.2 },
  { id: 'st-b', lineId: 'L', seq: 2, name: '分拣', taktSeconds: 2.6 },
  { id: 'st-c', lineId: 'L', seq: 3, name: '装箱', taktSeconds: 3.8 },
];

function makeResult(partial: Partial<TaktBottleneckResult> = {}): TaktBottleneckResult {
  return {
    lineId: 'L',
    targetUnitsPerHour: 60,
    availability: 0.85,
    cycleTimeSeconds: 3.8,
    theoreticalThroughputPerHour: 947,
    meetsTarget: true,
    bottleneckStationId: 'st-c',
    bottleneckTaktSeconds: 3.8,
    stationLoads: [
      { stationId: 'st-a', load: 0.6 },
      { stationId: 'st-b', load: 0.95 },
      { stationId: 'st-c', load: 1.18 },
    ],
    ...partial,
  };
}

describe('S4 · deriveTaktPanel 视图模型', () => {
  it('负荷分级 + 瓶颈标注正确映射', () => {
    const model: TaktPanelModel = deriveTaktPanel(
      { lineId: 'L' },
      makeResult(),
      stations,
    );
    expect(model.lineId).toBe('L');
    expect(model.targetUnitsPerHour).toBe(60);
    expect(model.availability).toBe(0.85);
    expect(model.bottleneckStationId).toBe('st-c');
    expect(model.bottleneckStationName).toBe('装箱');
    const byId = new Map(model.stationLoads.map((s) => [s.stationId, s]));
    expect(byId.get('st-a')!.loadClass).toBe('ok');
    expect(byId.get('st-b')!.loadClass).toBe('busy'); // 0.95
    expect(byId.get('st-c')!.loadClass).toBe('overload'); // 1.18
    expect(byId.get('st-c')!.isBottleneck).toBe(true);
    expect(byId.get('st-a')!.isBottleneck).toBe(false);
  });

  it('达产 → summary 含「达产」；未达产 → summary 含「未达产 + 瓶颈名」', () => {
    const ok = deriveTaktPanel({ lineId: 'L' }, makeResult(), stations);
    expect(ok.meetsTarget).toBe(true);
    expect(ok.summary).toContain('达产');

    const notOk = deriveTaktPanel(
      { lineId: 'L' },
      makeResult({ theoreticalThroughputPerHour: 947, meetsTarget: false }),
      stations,
    );
    expect(notOk.meetsTarget).toBe(false);
    expect(notOk.summary).toContain('未达产');
    expect(notOk.summary).toContain('装箱');
  });

  it('工位名缺省回退 stationId（找不到匹配）', () => {
    const model = deriveTaktPanel(
      { lineId: 'L' },
      makeResult(),
      [], // 无工位
    );
    const c = model.stationLoads.find((s) => s.stationId === 'st-c')!;
    expect(c.name).toBe('st-c');
    expect(model.bottleneckStationName).toBe('st-c');
  });

  it('load 边界：0.9 → busy、恰好 1.0 → busy、>1 → overload', () => {
    const res = makeResult({
      stationLoads: [
        { stationId: 'st-a', load: 0.89 },
        { stationId: 'st-b', load: 0.9 },
        { stationId: 'st-c', load: 1.0001 },
      ],
    });
    const model = deriveTaktPanel({ lineId: 'L' }, res, stations);
    const byId = new Map(model.stationLoads.map((s) => [s.stationId, s]));
    expect(byId.get('st-a')!.loadClass).toBe('ok');
    expect(byId.get('st-b')!.loadClass).toBe('busy');
    expect(byId.get('st-c')!.loadClass).toBe('overload');
  });
});
