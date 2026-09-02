import type { Vec3, Quat } from './geometry.js';

/** 产线类型 —— 与简历口径一致（平台复用于三类产线） */
export type ProductionLineKind = 'sorting' | 'fresh-cut' | 'cold-chain';

export interface ProductionLine {
  id: string;
  /** 对外名称，如「三号分拣线」 */
  name: string;
  kind: ProductionLineKind;
  /** 该产线下的工位（节拍仿真的最小单元） */
  stations: Station[];
  /** 是否启用；停用线不可在平台打开仿真 */
  enabled: boolean;
  /** 资产版本指纹（内容寻址），模型更新不污染旧版本 */
  modelVersion: string;
  createdAt: string;
  updatedAt: string;
}

export interface Station {
  id: string;
  lineId: string;
  /** 工位序号（沿传送方向） */
  seq: number;
  name: string;
  /** 理论节拍（秒/件），用于瓶颈分析 */
  taktSeconds: number;
  /** 是否瓶颈（由节拍服务计算后回写） */
  isBottleneck?: boolean;
}

/** 约束类型 —— 与方案 4.2 对齐 */
export type ConstraintType =
  /** 对齐（面贴面/中心对齐） */
  | 'coincident'
  | 'coplanar'
  /** 同轴 */
  | 'concentric'
  /** 距离 */
  | 'distance';

export interface Constraint {
  id: string;
  type: ConstraintType;
  /** 被约束零件 */
  partId: string;
  /** 被约束零件的锚点（局部坐标） */
  anchor: Vec3;
  /** 配合目标零件 */
  targetPartId: string;
  /** 配合目标锚点（局部坐标） */
  targetAnchor: Vec3;
  /** distance 类型的偏移量 */
  offset?: number;
}

export interface AssemblyPart {
  id: string;
  name: string;
  /** 来源 glTF 节点名 / 资源 id */
  assetId: string;
  /** 初始/基准姿态 */
  localPosition: Vec3;
  localRotation: Quat;
  /** 是否为可动装配件 */
  isMovable: boolean;
  /** 父级零件 id（构建父子层级树） */
  parentId?: string;
}

/** 单个装配步骤（自动装配 / 回放的最小单元） */
export interface AssemblyStep {
  /** 步骤序号 */
  seq: number;
  partId: string;
  /** 该步骤应用到的约束 */
  constraintIds: string[];
  /** 本步骤基准耗时（秒），用于自动装配动画时长 */
  durationSeconds: number;
  /** 步骤说明（可用于回放/培训字幕） */
  description?: string;
}

/** 装配模式 */
export type AssemblyMode = 'auto' | 'manual' | 'replay';

/** 装配仿真会话运行态快照（轻、可序列化 → REST/Pinia） */
export interface AssemblySessionState {
  sessionId: string;
  lineId: string;
  mode: AssemblyMode;
  /** 已装配完成的零件集合 */
  assembledPartIds: string[];
  /** 当前所处步骤序号（0 起点） */
  currentStepSeq: number;
  /** 当前选中零件 */
  selectedPartId?: string;
  /** 相机视角占位（视角录制/切换） */
  cameraViewId?: string;
  updatedAt: string;
}

/** BOM：把约束+步骤+装配体统一定义 */
export interface AssemblyBom {
  lineId: string;
  parts: AssemblyPart[];
  constraints: Constraint[];
  steps: AssemblyStep[];
}
