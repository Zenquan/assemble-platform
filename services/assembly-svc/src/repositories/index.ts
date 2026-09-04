import type { AssemblyBom, ProductionLine, Quat, Station, Vec3 } from '@assemble/domain';
import { createRepo, resolveBackend, type Repository } from '@assemble/storage';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_STATION_SPACING_METERS = 3;
const DEFAULT_FACING_DEGREES = 90;
const MIN_ASSEMBLY_DURATION_SECONDS = 0.6;
const MAX_ASSEMBLY_DURATION_SECONDS = 2.5;
const TAKT_TO_ANIMATION_RATIO = 3;
const FRESHCUT_TRANSFER_GAP_METERS = 0.12;
const FRESHCUT_FOOTPRINT_LENGTHS: Record<string, number> = {
  'infeed-elevator': 3.49,
  'bubble-washer': 4.50,
  'inspection-conveyor': 3.73,
  'vegetable-cutter': 2.49,
  'vibratory-dewaterer': 3.02,
  'weigh-packer': 2.15,
  'metal-detector': 2.32,
};
const IDENTITY_ROTATION: Quat = { x: 0, y: 0, z: 0, w: 1 };

/** 装配服务仓储：以产线为主聚合，用降级存储（内存/文件） */
export interface AssemblyRepos {
  lines: Repository<ProductionLine>;
}

/** 种子产线：覆盖三类产线，供本地演示/联调 */
export function buildSeedLines(): ProductionLine[] {
  const now = new Date().toISOString();
  const lines: ProductionLine[] = [
    {
      id: 'line-sorting-01',
      name: '三号分拣线',
      kind: 'sorting',
      baseAssetId: 'conveyor',
      modelVersion: 'sha3-v1.2.0',
      enabled: true,
      createdAt: now,
      updatedAt: now,
      stations: [
        {
          id: 'st-s1', lineId: 'line-sorting-01', seq: 1, name: '上料工位', taktSeconds: 3.2,
          deviceKind: 'feeder', position: [-3, 0, 0], facingDeg: 90,
        },
        {
          id: 'st-s2', lineId: 'line-sorting-01', seq: 2, name: '视觉分拣', taktSeconds: 2.6,
          deviceKind: 'vision-module', position: [0, 0, 0], facingDeg: 90,
        },
        {
          id: 'st-s3', lineId: 'line-sorting-01', seq: 3, name: '装箱工位', taktSeconds: 3.8,
          deviceKind: 'box-pack', position: [3, 0, 0], facingDeg: 90,
        },
      ],
    },
    {
      id: 'line-freshcut-01',
      name: '果蔬净菜加工线',
      kind: 'fresh-cut',
      modelVersion: 'freshcut-v1.0.0',
      enabled: true,
      createdAt: now,
      updatedAt: now,
      stations: [
        {
          id: 'st-f1', lineId: 'line-freshcut-01', seq: 1, name: '提升上料', taktSeconds: 5.2,
          deviceKind: 'infeed-elevator', facingDeg: 0,
        },
        {
          id: 'st-f2', lineId: 'line-freshcut-01', seq: 2, name: '气泡清洗', taktSeconds: 6.8,
          deviceKind: 'bubble-washer', facingDeg: 0,
        },
        {
          id: 'st-f3', lineId: 'line-freshcut-01', seq: 3, name: '人工挑选', taktSeconds: 5.6,
          deviceKind: 'inspection-conveyor', facingDeg: 0,
        },
        {
          id: 'st-f4', lineId: 'line-freshcut-01', seq: 4, name: '连续切配', taktSeconds: 4.4,
          deviceKind: 'vegetable-cutter', facingDeg: 0,
        },
        {
          id: 'st-f5', lineId: 'line-freshcut-01', seq: 5, name: '振动沥水', taktSeconds: 5.0,
          deviceKind: 'vibratory-dewaterer', facingDeg: 0,
        },
        {
          id: 'st-f6', lineId: 'line-freshcut-01', seq: 6, name: '组合称重包装', taktSeconds: 6.2,
          deviceKind: 'weigh-packer', facingDeg: 0,
        },
        {
          id: 'st-f7', lineId: 'line-freshcut-01', seq: 7, name: '金属检测', taktSeconds: 4.8,
          deviceKind: 'metal-detector', facingDeg: 0,
        },
      ],
    },
    {
      id: 'line-cold-01',
      name: '冷链预包装线',
      kind: 'cold-chain',
      baseAssetId: 'conveyor',
      modelVersion: 'sha3-v2.0.0',
      enabled: true,
      createdAt: now,
      updatedAt: now,
      stations: [
        {
          id: 'st-c1', lineId: 'line-cold-01', seq: 1, name: '预冷', taktSeconds: 8.0,
          deviceKind: 'feeder', position: [-3, 0, 0], facingDeg: 90,
        },
        {
          id: 'st-c2', lineId: 'line-cold-01', seq: 2, name: '低温装配', taktSeconds: 7.4,
          deviceKind: 'box-pack', position: [3, 0, 0], facingDeg: 90,
        },
      ],
    },
  ];
  return lines;
}

function positionOf(station: Station, index: number, count: number): Vec3 {
  if (station.position) return station.position;
  const centerIndex = (count - 1) / 2;
  return [(index - centerIndex) * DEFAULT_STATION_SPACING_METERS, 0, 0];
}

function rotationAroundY(degrees = DEFAULT_FACING_DEGREES): Quat {
  const halfRadians = (degrees * Math.PI) / 360;
  return { x: 0, y: Math.sin(halfRadians), z: 0, w: Math.cos(halfRadians) };
}

function durationFromTakt(taktSeconds: number): number {
  return Math.max(
    MIN_ASSEMBLY_DURATION_SECONDS,
    Math.min(MAX_ASSEMBLY_DURATION_SECONDS, taktSeconds / TAKT_TO_ANIMATION_RATIO),
  );
}

function compactFreshcutPositions(stations: readonly Station[]): Map<string, Vec3> {
  const positions = new Map<string, Vec3>();
  let cursor = 0;
  let previousLength = 0;
  for (const [index, station] of stations.entries()) {
    const length = FRESHCUT_FOOTPRINT_LENGTHS[station.deviceKind ?? ''] ?? 3;
    if (index === 0) cursor = -length / 2;
    else cursor += previousLength / 2 + length / 2 + FRESHCUT_TRANSFER_GAP_METERS;
    positions.set(station.id, [cursor, 0, 0]);
    previousLength = length;
  }
  return positions;
}

/**
 * 由流水线工位动态生成后端 BOM。产线一旦增删/调整工位，零件、步骤、工位归属与
 * 资产组合随之变化；前端只消费结果，不再按 line.kind 合成。
 */
export function buildBomForLine(line: ProductionLine): AssemblyBom {
  const stations = [...line.stations].sort((a, b) => a.seq - b.seq);
  const firstStation = stations[0];
  if (!firstStation) {
    return { lineId: line.id, parts: [], constraints: [], steps: [] };
  }

  const compactPositions = line.kind === 'fresh-cut' ? compactFreshcutPositions(stations) : null;
  const positions = stations.map((station, index) =>
    compactPositions?.get(station.id) ?? positionOf(station, index, stations.length),
  );
  const basePosition: Vec3 = [
    positions.reduce((sum, position) => sum + position[0], 0) / positions.length,
    0,
    positions.reduce((sum, position) => sum + position[2], 0) / positions.length,
  ];
  const basePartId = line.baseAssetId ? `${line.id}-${line.baseAssetId}` : undefined;
  const parts: AssemblyBom['parts'] = [];
  const steps: AssemblyBom['steps'] = [];
  if (line.baseAssetId && basePartId) {
    parts.push({
      id: basePartId,
      name: `${line.name}输送基座`,
      assetId: line.baseAssetId,
      localPosition: basePosition,
      localRotation: IDENTITY_ROTATION,
      isMovable: false,
    });
    steps.push({
      seq: 0,
      partId: basePartId,
      stationId: firstStation.id,
      constraintIds: [],
      durationSeconds: MIN_ASSEMBLY_DURATION_SECONDS,
      description: '确认输送基座',
    });
  }

  for (const [index, station] of stations.entries()) {
    if (!station.deviceKind) continue;
    const partId = `${line.id}-${station.id}-${station.deviceKind}`;
    parts.push({
      id: partId,
      name: `${station.name}设备`,
      assetId: station.deviceKind,
      localPosition: positions[index] ?? [0, 0, 0],
      localRotation: rotationAroundY(station.facingDeg),
      isMovable: true,
      ...(basePartId ? { parentId: basePartId } : {}),
    });
    steps.push({
      seq: steps.length,
      partId,
      stationId: station.id,
      constraintIds: [],
      durationSeconds: durationFromTakt(station.taktSeconds),
      description: `安装${station.name}设备`,
    });
  }

  return { lineId: line.id, parts, constraints: [], steps };
}

export function createAssemblyRepos(): AssemblyRepos {
  const backend = resolveBackend();
  const dataDir =
    process.env['ASSEMBLE_DATA_DIR'] ?? path.resolve(__dirname, '../../.assemble-data');
  const lines = createRepo<ProductionLine>(
    { backend, dataDir },
    'production-lines',
  );
  const repos: AssemblyRepos = { lines };

  // 首次运行播种：空时插入种子；已有时按 id 同步种子最新字段（保证 demo 状态可演进）
  void (async () => {
    const existing = await lines.list();
    const byId = new Map(existing.map((l) => [l.id, l]));
    for (const seed of buildSeedLines()) {
      const cur = byId.get(seed.id);
      if (!cur) {
        await lines.upsert(seed);
      } else if (cur.enabled !== seed.enabled || cur.modelVersion !== seed.modelVersion) {
        // modelVersion 变化代表演示产线结构/资产升级；保留原创建时间并同步完整 seed。
        await lines.upsert({ ...seed, createdAt: cur.createdAt, updatedAt: seed.updatedAt });
      }
    }
  })();

  return repos;
}
