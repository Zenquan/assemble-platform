/**
 * takt-svc(7104) 节拍仿真客户端 —— S4 节拍面板数据源。
 *
 * 真实口径：POST /takt/simulate 需 {lineId, stations:[{id,taktSeconds}], targetUnitsPerHour,
 * availability}，返回 TaktBottleneckResult（瓶颈工位/理论CT/产能/各工位负荷）。
 * 前端把所选产线的 stations 传过去，目标产能与开动率由调用方决定（demo 默认见 Workbench）。
 */
import type { Station, TaktBottleneckResult } from '@assemble/domain';
import { http } from './http.js';

export interface TaktSimulateInput {
  lineId: string;
  stations: Array<Pick<Station, 'id' | 'taktSeconds'>>;
  targetUnitsPerHour: number;
  /** 产线总有效工时占比（OEE 时间开动率），0-1；缺省 1 */
  availability?: number;
}

/** 对某产线跑一次节拍仿真，返回瓶颈/产能/工位负荷结果 */
export async function fetchTaktSimulation(
  input: TaktSimulateInput,
): Promise<TaktBottleneckResult> {
  return http.post<TaktBottleneckResult>('/takt/simulate', {
    lineId: input.lineId,
    stations: input.stations,
    targetUnitsPerHour: input.targetUnitsPerHour,
    availability: input.availability ?? 1,
  });
}
