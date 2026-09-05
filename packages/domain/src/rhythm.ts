/**
 * 节拍仿真领域模型 —— 对应方案 3.3 TaktSvc / 4.4
 */

/** 节拍数据来源，区分配置、现场系统观测和无配置时的计算降级。 */
export type TaktDataSource = 'configuration' | 'mes' | 'plc' | 'derived';

/** 产线节拍目标与计划开动率，由后端配置仓储提供。 */
export interface TaktConfig {
  id: string;
  lineId: string;
  /** 每小时目标产出（P/H） */
  targetUnitsPerHour: number;
  /** 产线总有效工时占比（OEE 中时间开动率），0-1 */
  availability: number;
  source: TaktDataSource;
  updatedAt: string;
}

/** 现场系统在一个观测窗口内记录的产线实际产出。 */
export interface TaktObservation {
  id: string;
  lineId: string;
  /** 观测周期（秒） */
  windowSeconds: number;
  /** 完成件数 */
  completedUnits: number;
  /** 实际平均节拍（秒/件） */
  actualTaktSeconds: number;
  source: Exclude<TaktDataSource, 'configuration' | 'derived'>;
  observedAt: string;
}

export interface StationThroughput {
  id: string;
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
  source: Exclude<TaktDataSource, 'configuration' | 'derived'>;
  observedAt: string;
}

export interface TaktSimulationInput {
  lineId: string;
  /** 每小时目标产出（P/H） */
  targetUnitsPerHour?: number;
  /** 产线总有效工时占比（OEE 中时间开动率），0-1 */
  availability?: number;
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
  /** 目标与开动率的来源；无配置时为 derived。 */
  configSource: TaktDataSource;
  /** 最近一次后端观测到的实际产出；没有观测数据时省略。 */
  actual?: {
    windowSeconds: number;
    completedUnits: number;
    actualTaktSeconds: number;
    actualThroughputPerHour: number;
    source: Exclude<TaktDataSource, 'configuration' | 'derived'>;
    observedAt: string;
  };
}
