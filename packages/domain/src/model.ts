/**
 * 模型资产与管线领域模型 —— 对应方案 3.3 ModelSvc / 4.1 模型管线
 */

import type { Vec3 } from './geometry.js';

/** 压缩策略：体积敏感用 draco，动态反复加载用 meshopt */
export type CompressionStrategy = 'draco' | 'meshopt' | 'none';

/** 当前平台内置 GLB 资产清单：domain/model-svc/sim-platform 共享，禁止各端重复维护。 */
export const MODEL_ASSET_IDS = [
  'conveyor',
  'transfer-conveyor',
  'feeder',
  'vision-module',
  'gantry-arm',
  'box-pack',
  'infeed-elevator',
  'bubble-washer',
  'inspection-conveyor',
  'vegetable-cutter',
  'vibratory-dewaterer',
  'weigh-packer',
  'metal-detector',
] as const;

export type ModelAssetId = (typeof MODEL_ASSET_IDS)[number];

/** 内置资产中文名（UI 展示用）：与 MODEL_ASSET_IDS 一一对应，业务引用仍走英文 id。 */
export const MODEL_ASSET_LABELS: Record<ModelAssetId, string> = {
  conveyor: '输送机',
  'transfer-conveyor': '转运输送段',
  feeder: '上料器',
  'vision-module': '视觉分拣模块',
  'gantry-arm': '龙门机械臂',
  'box-pack': '装箱机',
  'infeed-elevator': '提升上料机',
  'bubble-washer': '气泡清洗机',
  'inspection-conveyor': '检验输送机',
  'vegetable-cutter': '蔬菜切分机',
  'vibratory-dewaterer': '振动沥水机',
  'weigh-packer': '称重包装机',
  'metal-detector': '金属检测机',
};

/** 用户上传的自定义资产 id 统一前缀：与内置资产天然隔离，禁止覆盖内置命名。 */
export const CUSTOM_ASSET_PREFIX = 'custom-';

/** 自定义资产 id 规则：custom- 前缀 + 小写字母/数字/连字符，总长 ≤ 64。 */
const CUSTOM_ASSET_ID_RE = /^custom-[a-z0-9][a-z0-9-]{0,56}$/;

export function isBuiltinAssetId(assetId: string): boolean {
  return (MODEL_ASSET_IDS as readonly string[]).includes(assetId);
}

export function isCustomAssetId(assetId: string): boolean {
  return CUSTOM_ASSET_ID_RE.test(assetId);
}

/** 资产 id 合法性统一判定：内置白名单 ∪ 合法 custom- 自定义 id（model-svc 下载/上传与 assembly-svc 产线校验共享）。 */
export function isValidModelAssetId(assetId: string): boolean {
  return isBuiltinAssetId(assetId) || isCustomAssetId(assetId);
}

/**
 * 资产实测包络（米）。
 * size 取 GLB 世界 AABB 的 [x, y, z] 尺寸，由 `scripts/gltf-gen/measure_glb.mjs`
 * 对 services/model-svc/assets/glb 实测产出，禁止各端凭视觉猜测。
 * Babylon 装配挂载统一做“x/z 居中、y 底面贴锚点”的归一化，因此世界 OBB 构造
 * 统一由 sim-utils/clearance-core 的纯函数消费，不在服务里复制一份坐标规则。
 */
export interface ModelAssetEnvelope {
  /** 资产本地系世界 AABB 尺寸：尺寸[0]/[1]/[2] 对应 x/y/z（米）。 */
  size: Vec3;
}

/** 内置 GLB 资产包络元数据（与 MODEL_ASSET_IDS 一一对应）。 */
export const MODEL_ASSET_BOUNDS: Record<ModelAssetId, ModelAssetEnvelope> = {
  conveyor: { size: [8.0, 0.73, 0.7] },
  'transfer-conveyor': { size: [0.8, 0.73, 0.7] },
  feeder: { size: [1.21, 0.55, 1.35] },
  'vision-module': { size: [2.4, 2.5, 1.7] },
  'gantry-arm': { size: [1.6, 1.97, 0.6] },
  'box-pack': { size: [1.04, 0.74, 0.98] },
  'infeed-elevator': { size: [3.49, 1.81, 1.44] },
  'bubble-washer': { size: [4.5, 1.55, 1.79] },
  'inspection-conveyor': { size: [3.73, 1.63, 1.58] },
  'vegetable-cutter': { size: [2.49, 1.53, 1.59] },
  'vibratory-dewaterer': { size: [3.02, 1.37, 1.72] },
  'weigh-packer': { size: [2.15, 2.9, 1.83] },
  'metal-detector': { size: [2.32, 1.8, 1.64] },
};

export interface ModelAssetVersion {
  /** 内容寻址指纹（hash），作为 CDN/对象存储路径与缓存 key */
  id: string;
  /** 稳定逻辑 id（业务引用不变，底层版本可更新） */
  assetId: string;
  partId?: string;
  /** 中文/展示名（自定义资产上传时录入；内置资产 UI 用 MODEL_ASSET_LABELS） */
  displayName?: string;
  /** 文件名/源 */
  filename: string;
  /** 压缩后体积（字节） */
  sizeBytes: number;
  /** 压缩前体积（字节） */
  sourceSizeBytes: number;
  compression: CompressionStrategy;
  /** LOD 档位：0 最高精（关键配合面），越高越粗 */
  lodLevel: number;
  /** 是否属于关键配合/基准面零件（需高精度、低压缩） */
  precisionCritical: boolean;
  /** CDN 相对路径 */
  cdnPath: string;
  createdAt: string;
}

export interface CompressionTask {
  taskId: string;
  assetId: string;
  inputPath: string;
  strategy: CompressionStrategy;
  precisionCritical: boolean;
  status: 'queued' | 'processing' | 'succeeded' | 'failed';
  result?: ModelAssetVersion;
  error?: string;
}

/** 模型下载签名（CDN 直链，避免网关代理大文件） */
export interface AssetPresignedUrl {
  assetId: string;
  url: string;
  expiresInSeconds: number;
}
