import { ClearanceDetector } from '@assemble/clearance-core';
import type { InterferenceReport } from '@assemble/domain';
import { ok } from '@assemble/http';
import { synthesizePartsForLine } from './geometryCatalog.js';

export interface OfflineCheckResult {
  report: InterferenceReport;
}

/**
 * 运行一次「离线整线批量干涉预检」：
 * 载入给定产线全量零件的 OBB，BVH self-collision + OBB-SAT 全量对撞，产出报告。
 * 对应方案 3.3「服务端离线批量」（数千零件组合校验不压垮浏览器）。
 */
export function runOfflineCheck(params: {
  lineKind: string;
  partCount: number;
}): OfflineCheckResult {
  const parts = synthesizePartsForLine(params.lineKind, params.partCount);
  const detector = new ClearanceDetector();
  detector.loadAll(parts.map((p) => ({ partId: p.partId, obb: p.obb })));
  const res = detector.runFull();
  const report: InterferenceReport = {
    reportId: `off-${Date.now()}`,
    lineId: params.lineKind,
    source: 'offline',
    totalPartCount: res.totalPartCount,
    pairsChecked: res.pairsChecked,
    hitCount: res.hits.length,
    hits: res.hits,
    elapsedMs: res.elapsedMs,
    broadCullRatio: res.broadCullRatio,
    createdAt: new Date().toISOString(),
  };
  return { report };
}
