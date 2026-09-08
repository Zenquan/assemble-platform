import {
  isCustomAssetId,
  MODEL_ASSET_IDS,
  MODEL_ASSET_LABELS,
  type ModelAssetVersion,
} from '@assemble/domain';
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

export interface DeleteAssetResult {
  assetId: string;
  removedVersions: number;
}

/** 删除自定义资产：服务端移除磁盘文件并撤销全部注册版本记录；内置资产受保护不可删。
 *  前端应在调用前先查产线引用（见 ModelAssetsView），被引用的资产删除会被 UI 拦截。 */
export async function deleteModelAsset(assetId: string): Promise<DeleteAssetResult> {
  return http.del<DeleteAssetResult>(`${MODEL_API_PREFIX}/glb/${encodeURIComponent(assetId)}`);
}

/** 上传自定义 GLB：原始二进制 PUT，服务端校验 magic/大小/assetId 规则后落盘注册。
 *  displayName 为可选中文/展示名，经 query 透传（URL 编码）。 */
export async function uploadModelAsset(
  assetId: string,
  file: Blob,
  displayName?: string,
): Promise<UploadAssetResult> {
  if (!isCustomAssetId(assetId)) {
    throw new Error('资产 id 须为 custom- 前缀的小写字母/数字/连字符（总长 ≤ 64）');
  }
  const name = displayName?.trim();
  const query = name ? `?displayName=${encodeURIComponent(name)}` : '';
  return http.putBinary<UploadAssetResult>(
    `${MODEL_API_PREFIX}/glb/${encodeURIComponent(assetId)}${query}`,
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

/** 展示名工具：资产的中文名（自定义取 displayName；内置取 MODEL_ASSET_LABELS），缺省回退 assetId。 */
export function assetDisplayName(asset: Pick<ModelAssetVersion, 'assetId' | 'displayName'>): string {
  if (asset.displayName?.trim()) return asset.displayName.trim();
  const builtin = MODEL_ASSET_LABELS[asset.assetId as keyof typeof MODEL_ASSET_LABELS];
  return builtin ?? asset.assetId;
}

/** 展示名工具：内置资产中文名（供下拉/列表为内置 id 提供标签），缺省回退 id。 */
export function builtinAssetLabel(assetId: string): string {
  return MODEL_ASSET_LABELS[assetId as keyof typeof MODEL_ASSET_LABELS] ?? assetId;
}

export const builtinAssetIdSet: ReadonlySet<string> = new Set(MODEL_ASSET_IDS);

// ── 上传时的英文名 → 中文名建议（本地工业词库，无需联网；覆盖不中的可手填）──
const NAME_PHRASES: ReadonlyArray<readonly [string, string]> = [
  ['cnc milling machine', '数控铣床'],
  ['cnc machining center', '加工中心'],
  ['cnc machine', '数控机床'],
  ['cnc mill', '数控铣床'],
  ['cnc lathe', '数控车床'],
  ['robot arm', '机械臂'],
  ['robotic arm', '机械臂'],
  ['conveyor belt', '输送带'],
  ['vision system', '视觉检测系统'],
  ['metal detector', '金属检测机'],
  ['weigh packer', '称重包装机'],
  ['bubble washer', '气泡清洗机'],
  ['sorting machine', '分拣机'],
  ['transfer conveyor', '转运输送段'],
];

const NAME_WORDS: Record<string, string> = {
  cnc: '数控',
  robot: '机器人',
  arm: '机械臂',
  gripper: '夹爪',
  machine: '机床',
  mill: '铣床',
  milling: '铣削',
  lathe: '车床',
  press: '冲压机',
  punch: '冲床',
  conveyor: '输送机',
  feeder: '上料器',
  loader: '上料机',
  unloader: '卸料机',
  washer: '清洗机',
  dryer: '烘干机',
  oven: '烘箱',
  cutter: '切割机',
  slicer: '切片机',
  packer: '包装机',
  weigher: '称重机',
  scale: '称重',
  detector: '检测机',
  scanner: '扫描仪',
  vision: '视觉',
  camera: '相机',
  elevator: '提升机',
  lift: '升降机',
  transfer: '转运',
  module: '模块',
  cell: '单元',
  table: '工作台',
  tank: '料箱',
  buffer: '缓存',
  agv: 'AGV',
  sorting: '分拣',
  sorter: '分拣机',
  metal: '金属',
  bubble: '气泡',
  station: '工位',
  line: '产线',
};

/** 由英文文件名给中文名建议：整句词库优先，逐词映射兜底；含中文原样返回；无命中返回空串。 */
export function suggestChineseName(filename: string): string {
  const cleaned = filename.replace(/\.glb$/i, '').trim();
  if (!cleaned) return '';
  // 文件名已含中文 → 直接作为展示名
  if (/[\u4e00-\u9fa5]/.test(cleaned)) return cleaned;

  const normalized = cleaned.toLowerCase();
  for (const [phrase, label] of NAME_PHRASES) {
    if (normalized.includes(phrase)) return label;
  }

  const tokens = normalized.split(/[^a-z0-9]+/).filter(Boolean);
  const mapped = tokens
    .map((token) => NAME_WORDS[token] ?? '')
    .filter(Boolean)
    .join('');
  return mapped.length > 0 ? mapped.slice(0, 40) : '';
}
