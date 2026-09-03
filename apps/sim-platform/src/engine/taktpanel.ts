/**
 * S4 · 节拍面板 —— 纯逻辑：把 takt-svc 的 `TaktBottleneckResult` + 产线工位
 * 映射成 HUD 友好视图模型（中文汇总 + 每工位负荷分级 + 瓶颈标注）。
 *
 * 架构红线延续：本模块**无 DOM / 无 HTTP**，只消费 @assemble/domain 值类型，
 * 产出可单测的纯模型。真正的 HTTP 调用在 `api/takt.ts`（代理 → takt-svc:7104），
 * UI 拿到 `TaktBottleneckResult` 后经 `deriveTaktPanel` 转视图。
 *
 * 负荷分级（与 rhythm.ts 语义对齐：load = 实际需求节拍下的占用，>1 即超负荷堵点）：
 *   load > 1        → 'overload'  超负荷（该工位成为产线堵点）
 *   0.9 <= load <=1 → 'busy'      高负荷（接近饱和）
 *   瓶颈工位          → 额外标 isBottleneck（若 load 未超 1 也亮"瓶颈"）
 *   其余            → 'ok'
 */

import type { Station, TaktBottleneckResult } from '@assemble/domain';

/** 单工位负荷的行（含展示名与分级） */
export interface TaktStationLoad {
  stationId: string;
  /** 工位显示名（缺省回退 id） */
  name: string;
  /** 理论节拍（秒/件） */
  taktSeconds: number;
  /** 负荷（实际需求节拍占用，>1 超负荷） */
  load: number;
  /** 是否瓶颈工位（由 takt 服务判定） */
  isBottleneck: boolean;
  /** 负荷分级（驱动色条/文案） */
  loadClass: 'ok' | 'busy' | 'overload';
}

/** 节拍面板视图模型（供右栏一次消费） */
export interface TaktPanelModel {
  lineId: string;
  targetUnitsPerHour: number;
  availability: number;
  /** 产线理论单件 CT（秒） */
  cycleTimeSeconds: number;
  /** 理论小时产能（件/时） */
  theoreticalThroughputPerHour: number;
  /** 是否达产（理论产能 >= 目标） */
  meetsTarget: boolean;
  /** 瓶颈工位 id 与名 */
  bottleneckStationId: string;
  bottleneckStationName: string;
  bottleneckTaktSeconds: number;
  /** 各工位负荷行 */
  stationLoads: TaktStationLoad[];
  /** 一句话中文汇总（HUD 顶部） */
  summary: string;
}

/** 由 load 值定分级 */
function loadClassOf(load: number): TaktStationLoad['loadClass'] {
  if (load > 1) return 'overload';
  if (load >= 0.9) return 'busy';
  return 'ok';
}

/**
 * 建议的目标小时产能（件/时）：取瓶颈工位（最大 CT）对应的小时速率向上取整。
 * 让演示产线的节拍面板落在"瓶颈处逼近/超负荷、可对照是否达产"的可读区间，
 * 而非极低目标导致全绿无信息量。纯函数、可单测。
 */
export function recommendTargetPerHour(stations: readonly Station[]): number {
  const maxTakt = stations.reduce((m, s) => Math.max(m, s.taktSeconds), 0);
  if (maxTakt <= 0) return 60;
  return Math.ceil(3600 / maxTakt);
}

/**
 * 由 takt 结果 + 产线工位推导节拍面板模型。纯函数、可单测。
 *
 * @param reqInfo 请求时用的 lineId/targetUnitsPerHour/availability（复用于展示）
 * @param result  takt-svc 返回的 TaktBottleneckResult
 * @param stations 产线工位（取显示名；无匹配则用 stationId）
 */
export function deriveTaktPanel(
  reqInfo: { lineId: string; targetUnitsPerHour: number; availability: number },
  result: TaktBottleneckResult,
  stations: readonly Station[],
): TaktPanelModel {
  const nameOf = (id: string) => stations.find((s) => s.id === id)?.name ?? id;
  const stationLoads: TaktStationLoad[] = result.stationLoads.map((l) => {
    const st = stations.find((s) => s.id === l.stationId);
    const isBottleneck = l.stationId === result.bottleneckStationId;
    return {
      stationId: l.stationId,
      name: st?.name ?? l.stationId,
      taktSeconds: st?.taktSeconds ?? 0,
      load: l.load,
      isBottleneck,
      loadClass: loadClassOf(l.load),
    };
  });

  const bn = stations.find((s) => s.id === result.bottleneckStationId);
  const meetsTarget = result.meetsTarget;
  const summary = meetsTarget
    ? `理论产能 ${result.theoreticalThroughputPerHour.toFixed(1)} 件/时 ≥ 目标 ${reqInfo.targetUnitsPerHour} · 达产`
    : `理论产能 ${result.theoreticalThroughputPerHour.toFixed(1)} 件/时 < 目标 ${reqInfo.targetUnitsPerHour} · 未达产（瓶颈 ${bn?.name ?? result.bottleneckStationId} ${result.bottleneckTaktSeconds}s）`;

  return {
    lineId: reqInfo.lineId,
    targetUnitsPerHour: reqInfo.targetUnitsPerHour,
    availability: reqInfo.availability,
    cycleTimeSeconds: result.cycleTimeSeconds,
    theoreticalThroughputPerHour: result.theoreticalThroughputPerHour,
    meetsTarget,
    bottleneckStationId: result.bottleneckStationId,
    bottleneckStationName: bn?.name ?? result.bottleneckStationId,
    bottleneckTaktSeconds: result.bottleneckTaktSeconds,
    stationLoads,
    summary,
  };
}
