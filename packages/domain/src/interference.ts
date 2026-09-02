/**
 * 干涉分析领域模型 —— 对应方案 4.3（BVH/Octree + OBB-SAT）
 * 同一套类型同时被前端 SimEngine 实时检测与后端离线批量预检使用。
 */

/** 干涉严重程度分级 */
export type InterferenceSeverity = 'error' | 'warning' | 'info';

export interface InterferenceHit {
  /** 参与干涉的零件对（无向，约定 firstId <= secondId 排序） */
  firstPartId: string;
  secondPartId: string;
  severity: InterferenceSeverity;
  /** 交叠体积估算（立方毫米，仅作排序依据） */
  overlapEstimate: number;
  /** 接触点近似（包围盒交集中心，mm） */
  contactPoint: readonly [number, number, number];
  /** 命中相位：narrow（OBB-SAT 判定）或 broad（仅 BVH 重叠，缺精度时） */
  phase: 'narrow' | 'broad';
}

export interface InterferenceReport {
  reportId: string;
  lineId: string;
  /** 触发来源：交互(前端) 或 离线批量(服务端) */
  source: 'interactive' | 'offline';
  totalPartCount: number;
  pairsChecked: number;
  hitCount: number;
  hits: InterferenceHit[];
  /** 耗时统计 */
  elapsedMs: number;
  /** broad phase 剔除的比例（越高越说明空间索引有效） */
  broadCullRatio: number;
  createdAt: string;
}

export interface OfflineInterferenceJob {
  jobId: string;
  lineId: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  /** 成功时给出报告 id */
  reportId?: string;
  error?: string;
  createdAt: string;
  finishedAt?: string;
}
