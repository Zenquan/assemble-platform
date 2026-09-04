/**
 * takt-svc(7104) 节拍仿真客户端 —— S4 节拍面板数据源。
 *
 * 真实口径：POST /takt/simulate 只提交 lineId，takt-svc 从 assembly-svc 读取工位，
 * 返回 TaktBottleneckResult（瓶颈工位/理论CT/产能/实际开动率/各工位负荷）。
 */
import type { TaktBottleneckResult } from '@assemble/domain';
import { http } from './http.js';

export interface TaktSimulateInput {
  lineId: string;
}

/** 对某产线跑一次节拍仿真，返回瓶颈/产能/工位负荷结果 */
export async function fetchTaktSimulation(
  input: TaktSimulateInput,
): Promise<TaktBottleneckResult> {
  return http.post<TaktBottleneckResult>('/takt/simulate', {
    lineId: input.lineId,
  });
}
