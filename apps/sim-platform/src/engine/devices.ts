/**
 * @assemble/sim-platform · 工位设备布景层布局
 *
 * 设计原则（0.4.x 资产管线 · 不侵入 domain）：
 *  - 设备**只做布景层**：不参与装配/干涉/贴合判定。
 *  - 布局坐标按 line.kind + stations 推导（不在 Station 上加 position 字段），
 *    保持 domain/AssemblyBom 不被设备渲染细节污染。
 *  - 所有坐标单位为米，Y up（与工程一致）。
 *
 * 用法（WorkbenchView）：引擎 init 后 fire-and-forget 调
 *   eng.scene.loadDevices(layoutForLine(line))
 * 不阻塞 init 返回。
 */
import type { ProductionLine, Vec3 } from '@assemble/domain';

export interface DevicePlacement {
  /** 设备 id（与 .glb 文件名一致，如 'feeder' / 'vision-module'） */
  deviceId: string;
  /** 可加载的资产 URL（相对工程静态资源；vite public serve） */
  assetUrl: string;
  /** 设备底面/装配锚点位置（米） */
  position: Vec3;
  /** 绕 Y 轴旋转角度（度），用于让设备"面对产线方向" */
  rotationYDeg?: number;
  /** 等比缩放，默认 1 */
  scale?: number;
}

/** 设备 id 列表（与 scripts/gltf-gen/gen_device.py BUILDERS 一致） */
export const DEVICE_IDS = [
  'conveyor',
  'feeder',
  'vision-module',
  'gantry-arm',
  'box-pack',
] as const;
export type DeviceId = (typeof DEVICE_IDS)[number];

/**
 * 设备资产下载 URL —— 指向后端 model-svc 的 glb 直下接口。
 * 架构约定（0.4.x 资产管线）：glb 单一事实源在后端（services/model-svc/assets/glb），
 * 前端布景层经 `/model/glb/:deviceId.glb` 拉取，不再落 public 静态副本。
 * 保留 `.glb` 后缀：Babylon SceneLoader 据 URL 扩展名识别 glTF 加载器插件。
 * 生产由网关同源汇聚；本地 dev 由 vite proxy 转 7103。
 */
export function buildDeviceUrl(deviceId: string): string {
  return `/model/glb/${deviceId}.glb`;
}

/**
 * 按产线 kind + 工位推算设备布景。
 * - sort/fresh-cut/cold-chain：均按"上料→中段视觉/处理→末端装箱"三工位模板
 *   摆放（feeder / vision-module / gantry-arm + box-pack），加贯穿 conveyor。
 * - stations 数量与 3 不一致时按"按 seq 等距"自适应缩放。
 *
 * Y 坐标约定：设备 glb 的原点在几何中心附近（非底面），故用每个设备的
 * `_centerY`（几何中心相对其底面的高度）把设备底面抬到 y=0（地面）。
 * 数据源：scripts/gltf-gen/measure_glb_pure.mjs 量出的 accessor 包围盒中心。
 */
const CENTER_Y: Record<string, number> = {
  conveyor: 0.37,
  feeder: 0.27,
  'vision-module': 1.25,
  'gantry-arm': 0.99,
  'box-pack': 0.37,
};

export function layoutForLine(line: ProductionLine): DevicePlacement[] {
  const stations = [...line.stations].sort((a, b) => a.seq - b.seq);
  const n = Math.max(stations.length, 3);
  // X 方向等距工位（设备之间约 3m）；中段（seq=2）取中心 0；末端偏 +X
  const xs: number[] = Array.from({ length: n }, (_, i) => (i - Math.floor(n / 2)) * 3.0);

  const placements: DevicePlacement[] = [];

  // 贯穿 conveyor 沿 X 方向（自适应站位数 + 3m 缓冲）
  const convLen = (n + 1) * 3.0; // 米
  placements.push({
    deviceId: 'conveyor',
    assetUrl: buildDeviceUrl('conveyor'),
    position: [0, -CENTER_Y.conveyor, 0],
    rotationYDeg: 0,
    scale: convLen / 8.0, // 原生 conveyor 长 8m，按需缩放到 convLen
  });

  // 按 seq 把工位设备放到对应 X
  // seq=1 → feeder；seq=2 → vision-module；中间或 seq=3+ → gantry-arm + box-pack
  for (let i = 0; i < n; i++) {
    const x: number = xs[i] ?? 0;
    const seq: number = stations[i]?.seq ?? i + 1;
    if (i === 0 || seq === 1) {
      // 工位 1 · 上料：feeder（Y 偏移到 conveyor 一侧）
      placements.push({
        deviceId: 'feeder',
        assetUrl: buildDeviceUrl('feeder'),
        position: [x, -CENTER_Y.feeder, 0],
        rotationYDeg: 90, // 滑槽朝 +X（产品流动方向）
      });
    } else if (i === n - 1 || seq >= 3) {
      // 末端 · 装箱：gantry-arm + box-pack
      placements.push({
        deviceId: 'gantry-arm',
        assetUrl: buildDeviceUrl('gantry-arm'),
        position: [x, -CENTER_Y['gantry-arm'], 0],
        rotationYDeg: 90,
      });
      placements.push({
        deviceId: 'box-pack',
        assetUrl: buildDeviceUrl('box-pack'),
        position: [x + 1.2, -CENTER_Y['box-pack'], 0],
        rotationYDeg: 90,
      });
    } else {
      // 中段 · 视觉检测：vision-module（Y 上方突出）
      placements.push({
        deviceId: 'vision-module',
        assetUrl: buildDeviceUrl('vision-module'),
        position: [x, -CENTER_Y['vision-module'], 0],
        rotationYDeg: 90,
      });
    }
  }
  return placements;
}