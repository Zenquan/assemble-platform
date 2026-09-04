/**
 * 节拍仿真领域模型 —— 对应方案 3.3 TaktSvc / 4.4
 */

export interface StationThroughput {
  stationId: string;
  lineId: string;
  /** 观测周期（秒） */
  windowSeconds: number;
  /** 完成件数 */
  completedUnits: number;
  /** 实际平均节拍（秒/件） */
  actualTaktSeconds: number;
  /** 理论节拍 */
  theoreticalTaktSeconds: number;
  /** 利用率 = 理论/实际（<=1，越高越忙） */
  utilization: number;
}

export interface TaktSimulationInput {
  lineId: string;
  /** 每小时目标产出（P/H） */
  targetUnitsPerHour: number;
  /** 产线总有效工时占比（OEE 中时间开动率），0-1 */
  availability: number;
}

export interface TaktBottleneckResult {
  lineId: string;
  targetUnitsPerHour: number;
  /** 节拍服务实际采用的时间开动率（0.01-1） */
  availability: number;
  /** 产线理论单件 CT（瓶颈工位节拍 = 最大工位 CT） */
  cycleTimeSeconds: number;
  /** 理论小时产能 = 3600 / cycleTimeSeconds * availability */
  theoreticalThroughputPerHour: number;
  /** 是否达产：理论产能 >= 目标 */
  meetsTarget: boolean;
  bottleneckStationId: string;
  bottleneckTaktSeconds: number;
  /** 各工位负荷率（实际需求节拍下的占用），>1 即超负荷 */
  stationLoads: Array<{ stationId: string; load: number }>;
}
