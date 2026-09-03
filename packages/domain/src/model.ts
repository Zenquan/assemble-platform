/**
 * 模型资产与管线领域模型 —— 对应方案 3.3 ModelSvc / 4.1 模型管线
 */

/** 压缩策略：体积敏感用 draco，动态反复加载用 meshopt */
export type CompressionStrategy = 'draco' | 'meshopt' | 'none';

/** 当前平台内置 GLB 资产清单：domain/model-svc/sim-platform 共享，禁止各端重复维护。 */
export const MODEL_ASSET_IDS = [
  'conveyor',
  'feeder',
  'vision-module',
  'gantry-arm',
  'box-pack',
] as const;

export type ModelAssetId = (typeof MODEL_ASSET_IDS)[number];

export interface ModelAssetVersion {
  /** 内容寻址指纹（hash），作为 CDN/对象存储路径与缓存 key */
  id: string;
  /** 稳定逻辑 id（业务引用不变，底层版本可更新） */
  assetId: string;
  partId?: string;
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
