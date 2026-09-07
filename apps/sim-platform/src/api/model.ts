import { isCustomAssetId, type ModelAssetVersion } from '@assemble/domain';
import { http } from './http.js';

/** model-svc 同源 API 前缀；由 Vite/生产网关负责目标服务路由。 */
const MODEL_API_PREFIX = '/model';

/** 返回 Babylon 可直接加载的 GLB 后端地址，保留扩展名供 loader 识别格式。
 *  assetId 接受内置白名单 id 或已上传的 custom- 前缀自定义 id。 */
export function modelGlbUrl(assetId: string, modelVersion?: string): string {
  const baseUrl = `${MODEL_API_PREFIX}/glb/${encodeURIComponent(assetId)}.glb`;
  return modelVersion ? `${baseUrl}?v=${encodeURIComponent(modelVersion)}` : baseUrl;
}

/** 拉取模型资产库（内置 + 已注册自定义资产版本记录）。 */
export async function fetchModelAssets(): Promise<ModelAssetVersion[]> {
  return http.get<ModelAssetVersion[]>(`${MODEL_API_PREFIX}/assets`);
}

export interface UploadAssetResult {
  asset: ModelAssetVersion;
  downloadUrl: string;
  note?: string;
}

/** 上传自定义 GLB：原始二进制 PUT，服务端校验 magic/大小/assetId 规则后落盘注册。 */
export async function uploadModelAsset(assetId: string, file: Blob): Promise<UploadAssetResult> {
  if (!isCustomAssetId(assetId)) {
    throw new Error('资产 id 须为 custom- 前缀的小写字母/数字/连字符（总长 ≤ 64）');
  }
  return http.putBinary<UploadAssetResult>(
    `${MODEL_API_PREFIX}/glb/${encodeURIComponent(assetId)}`,
    file,
  );
}

/** 由文件名推导合法 custom- 资产 id：小写、非法字符转连字符、自动补 custom- 前缀。 */
export function deriveCustomAssetId(filename: string): string {
  const base = filename
    .replace(/\.glb$/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 57)
    .replace(/-+$/g, '');
  if (!base) return '';
  return base.startsWith('custom-') ? base : `custom-${base}`;
}
