/**
 * interference-svc(7102) 离线预检接口客户端 —— 入口产线卡的「干涉预检快照」数据源。
 *
 * 真实口径（sim-platform-design.md §1）：干涉数 = report.hitCount、耗时 = report.elapsedMs、
 * 剔除率 = report.broadCullRatio，全部来自 @assemble/clearance-core，非前端伪造。
 */
import type { InterferenceReport } from '@assemble/domain';
import { http } from './http.js';

/** 对某产线跑一次离线整线预检；干涉服务内部读取真实 assembly-svc BOM。 */
export async function runOfflinePrecheck(lineId: string): Promise<InterferenceReport> {
  return http.post<InterferenceReport>('/interference/offline', {
    lineId,
  });
}
