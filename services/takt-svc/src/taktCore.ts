import type { TaktBottleneckResult, Station } from '@assemble/domain';

export interface TaktSimRequest {
  lineId: string;
  stations: Array<Pick<Station, 'id' | 'taktSeconds'>>;
  targetUnitsPerHour: number;
  availability: number;
}

/**
 * 节拍仿真：找出瓶颈工位、计算理论 CT / 产能 / 各工位负荷。
 * 负荷 = (3600/目标每小时)/理论Takt 的实际占用 —— >1 表示该工位成为瓶颈堵点。
 */
export function computeTakt(req: TaktSimRequest): TaktBottleneckResult {
  const availability = Math.max(0.01, Math.min(1, req.availability ?? 1));
  // 有效可用秒/小时
  const effSecondsPerHour = 3600 * availability;

  let bottleneckId = req.stations[0]!.id;
  let bottleneckTakt = req.stations[0]!.taktSeconds;
  const stationLoads: Array<{ stationId: string; load: number }> = [];
  for (const st of req.stations) {
    const t = st.taktSeconds;
    if (t > bottleneckTakt) {
      bottleneckTakt = t;
      bottleneckId = st.id;
    }
    // 该工位每小时能产 3600/t 件；相对有效产能的利用率负荷
    const load = t / (effSecondsPerHour / req.targetUnitsPerHour);
    stationLoads.push({ stationId: st.id, load });
  }
  const cycleTimeSeconds = bottleneckTakt;
  const theoreticalThroughputPerHour = effSecondsPerHour / cycleTimeSeconds;

  return {
    lineId: req.lineId,
    targetUnitsPerHour: req.targetUnitsPerHour,
    cycleTimeSeconds,
    theoreticalThroughputPerHour,
    meetsTarget: theoreticalThroughputPerHour >= req.targetUnitsPerHour,
    bottleneckStationId: bottleneckId,
    bottleneckTaktSeconds: bottleneckTakt,
    stationLoads,
  };
}
