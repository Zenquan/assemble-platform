import type { ModelAssetId } from '@assemble/domain';

/** model-svc 同源 API 前缀；由 Vite/生产网关负责目标服务路由。 */
const MODEL_API_PREFIX = '/model';

/** 返回 Babylon 可直接加载的 GLB 后端地址，保留扩展名供 loader 识别格式。 */
export function modelGlbUrl(assetId: ModelAssetId, modelVersion?: string): string {
  const baseUrl = `${MODEL_API_PREFIX}/glb/${encodeURIComponent(assetId)}.glb`;
  return modelVersion ? `${baseUrl}?v=${encodeURIComponent(modelVersion)}` : baseUrl;
}
