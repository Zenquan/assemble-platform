/**
 * S4 · 节拍面板纯逻辑单测（无 HTTP / 无 DOM，node 环境可跑）
 *
 * 覆盖 taktpanel.ts：
 *   1. `recommendTargetPerHour`：取瓶颈工位小时速率向上取整；空/零 takt 兜底。
 *   2. `deriveTaktPanel`：瓶颈标注 + 工位负荷分级（ok/busy/overload）+ 达产 summary。
 *   3. 负荷分级边界：load<=0.9 → ok；0.9<=load<=1 → busy；>1 → overload。
 *   4. 工位名缺省回退 stationId；meetsTarget 直接透传。
 */
import { describe, expect, it } from 'vitest';

import type { Station, TaktBottleneckResult } from '@assemble/domain';
import {
  deriveTaktPanel,
  recommendTargetPerHour,
  type TaktPanelModel,
} from '@/engine/taktpanel';

const stations: Station[] = [
  { id: 'st-a', lineId: 'L', seq: 1, name: '上料', taktSeconds: 3.2 },
  { id: 'st-b', lineId: 'L', seq: 2, name: '分拣', taktSeconds: 2.6 },
  { id: 'st-c', lineId: 'L', seq: 3, name: '装箱', taktSeconds: 3.8 },
];

function makeResult(partial: Partial<TaktBottleneckResult> = {}): TaktBottleneckResult {
  return {
    lineId: 'L',
    targetUnitsPerHour: 60,
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

describe('S4 · recommendTargetPerHour', () => {
  it('取最大 CT 工位的小时速率向上取整', () => {
    // maxTakt=3.8 → 3600/3.8=947.37 → 948
    expect(recommendTargetPerHour(stations)).toBe(948);
  });
  it('全部 takt<=0 → 兜底 60', () => {
    const bad: Station[] = [{ id: 'x', lineId: 'L', seq: 1, name: 'x', taktSeconds: 0 }];
    expect(recommendTargetPerHour(bad)).toBe(60);
  });
  it('空工位 → 兜底 60', () => {
    expect(recommendTargetPerHour([])).toBe(60);
  });
});

describe('S4 · deriveTaktPanel 视图模型', () => {
  it('负荷分级 + 瓶颈标注正确映射', () => {
    const model: TaktPanelModel = deriveTaktPanel(
      { lineId: 'L', targetUnitsPerHour: 60, availability: 0.85 },
      makeResult(),
      stations,
    );
    expect(model.lineId).toBe('L');
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
    const ok = deriveTaktPanel({ lineId: 'L', targetUnitsPerHour: 60, availability: 1 }, makeResult(), stations);
    expect(ok.meetsTarget).toBe(true);
    expect(ok.summary).toContain('达产');

    const notOk = deriveTaktPanel(
      { lineId: 'L', targetUnitsPerHour: 60, availability: 0.85 },
      makeResult({ theoreticalThroughputPerHour: 947, meetsTarget: false }),
      stations,
    );
    expect(notOk.meetsTarget).toBe(false);
    expect(notOk.summary).toContain('未达产');
    expect(notOk.summary).toContain('装箱');
  });

  it('工位名缺省回退 stationId（找不到匹配）', () => {
    const model = deriveTaktPanel(
      { lineId: 'L', targetUnitsPerHour: 60, availability: 1 },
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
    const model = deriveTaktPanel({ lineId: 'L', targetUnitsPerHour: 60, availability: 1 }, res, stations);
    const byId = new Map(model.stationLoads.map((s) => [s.stationId, s]));
    expect(byId.get('st-a')!.loadClass).toBe('ok');
    expect(byId.get('st-b')!.loadClass).toBe('busy');
    expect(byId.get('st-c')!.loadClass).toBe('overload');
  });
});
