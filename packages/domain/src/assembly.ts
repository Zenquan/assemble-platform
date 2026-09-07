import type { Vec3, Quat } from './geometry.js';
import type { ModelAssetId, ModelAssetRef } from './model.js';

/** 产线类型 —— 与简历口径一致（平台复用于三类产线） */
export type ProductionLineKind = 'sorting' | 'fresh-cut' | 'cold-chain';

export interface ProductionLine {
  id: string;
  /** 对外名称，如「三号分拣线」 */
  name: string;
  kind: ProductionLineKind;
  /** 可选整线基座资产；设备自带输送段的工艺线可省略 */
  baseAssetId?: ModelAssetId;
  /** 相邻设备之间使用的固定转运资产；省略表示不自动生成转运段。 */
  transferAssetId?: ModelAssetId;
  /** 相邻设备之间的工艺转运间隙（米）。 */
  transferGapMeters?: number;
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
  /**
   * 工位所对应的设备资产 id，与 model-svc 白名单对齐。
   * 由产线配置填实；缺省视为该工位没有独立可见设备。
   * assembly-svc 依此生成该工位的 BOM 零件，不再由前端按 seq 猜测。
   */
  deviceKind?: ModelAssetRef;
  /**
   * 自定义设备的 GLB 实测三向包络尺寸（米，[x,y,z]），仅当 deviceKind 为 custom- 资产时由
   * 前端按上传量测结果写入并随产线持久化；内置资产忽略该字段（权威表 MODEL_ASSET_BOUNDS）。
   */
  deviceSize?: Vec3;
  /** 设备沿物料流向的实际占用长度（米），用于平台化紧凑排布。 */
  footprintLengthMeters?: number;
  /**
   * 工位物理锚点位置（米，Y up）。后端 BOM 把设备 GLB 落在此坐标上。
   * 缺省时由 seq 按默认工位间距推出。
   */
  position?: Vec3;
  /**
   * 设备朝向（绕 Y 轴旋转，度）。缺省 90。
   */
  facingDeg?: number;
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
  /** 来源 glTF 节点名 / 资源 id（内置或自定义资产） */
  assetId: ModelAssetRef;
  /** 初始/基准姿态；GLB 以包围盒底面中心对齐此位置 */
  localPosition: Vec3;
  localRotation: Quat;
  /**
   * 自定义资产的三向包络尺寸（米），仅当 assetId 为 custom- 时携带；
   * 内置资产缺省，服务端干涉/布局消费时回退权威静态表 MODEL_ASSET_BOUNDS。
   */
  envelopeSize?: Vec3;
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
  /** 所属工位；BOM 树与工艺视图按此字段分组，禁止前端猜测 */
  stationId: string;
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
