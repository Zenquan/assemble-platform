import { ClearanceDetector, obbFromBomPart } from '@assemble/clearance-core';
import {
  MODEL_ASSET_BOUNDS,
  type AssemblyBom,
  type AssemblyPart,
  type ModelAssetEnvelope,
  type OBB,
  type ProductionLine,
  type Station,
  type Vec3,
} from '@assemble/domain';

/** 自动避让建议：写回 line.stations 的显式 position 后保存即可复检。 */
export interface StationLayoutSuggestion {
  stationId: string;
  position: Vec3;
  note: string;
}

export interface LayoutSuggestionResult {
  suggestions: StationLayoutSuggestion[];
  /** 计算时该产线的真实离线命中数（0 = 无需处理） */
  hitCount: number;
}

interface PartGeom {
  partId: string;
  isMovable: boolean;
  stationId?: string;
  position: Vec3;
  obb: OBB;
  name: string;
}

const CLEARANCE_METERS = 0.05;

/** 解析 part 包络尺寸：自定义资产取 BOM 携带的 envelopeSize，内置回退权威静态表。 */
function resolveEnvelopeSize(
  part: Pick<AssemblyPart, 'assetId' | 'envelopeSize'>,
): Vec3 {
  if (part.envelopeSize) return part.envelopeSize;
  const envelope = (MODEL_ASSET_BOUNDS as Partial<Record<string, ModelAssetEnvelope>>)[
    part.assetId
  ];
  if (!envelope) throw new Error(`资产 ${part.assetId} 缺少实测包络元数据`);
  return envelope.size;
}

function stationByDevicePartId(line: ProductionLine, bom: AssemblyBom): Map<string, Station> {
  const map = new Map<string, Station>();
  const partIds = new Set(bom.parts.map((part) => part.id));
  for (const station of line.stations) {
    if (!station.deviceKind) continue;
    const id = `${line.id}-${station.id}-${station.deviceKind}`;
    if (partIds.has(id)) map.set(id, station);
  }
  return map;
}

function buildGeom(
  part: Pick<
    AssemblyPart,
    'id' | 'name' | 'isMovable' | 'assetId' | 'localPosition' | 'localRotation' | 'envelopeSize'
  >,
  stationId?: string,
): PartGeom {
  const size = resolveEnvelopeSize(part);
  return {
    partId: part.id,
    isMovable: part.isMovable,
    stationId,
    position: part.localPosition as Vec3,
    obb: obbFromBomPart(part, size),
    name: part.name,
  };
}

function obbCenterY(obb: OBB): number {
  return obb.center[1] ?? 0;
}

function verticalSeparation(adjustable: PartGeom, other: PartGeom): number | null {
  // 把可调设备抬到对方的顶面之上；只用于两盒 X/Z 与当前空间确有重叠的情形。
  const otherTop = obbCenterY(other.obb) + (other.obb.halfExtents[1] ?? 0);
  return otherTop + CLEARANCE_METERS;
}

function horizontalCenter(adjustable: PartGeom, other: PartGeom, axis: 0 | 2): number {
  const adj = adjustable.obb.center[axis] ?? 0;
  const oth = other.obb.center[axis] ?? 0;
  const adjHalf = adjustable.obb.halfExtents[axis] ?? 0;
  const othHalf = other.obb.halfExtents[axis] ?? 0;
  const dir = adj >= oth ? 1 : -1;
  return oth + dir * (adjHalf + othHalf + CLEARANCE_METERS);
}

/** 对单个命中对给出“只动可调设备”的建议 position（原始锚点语义）。 */
function separate(adjustable: PartGeom, other: PartGeom): { position: Vec3; axis: 'x' | 'y' | 'z' } {
  const a = adjustable.obb;
  const b = other.obb;
  const overlaps: Array<[number, number]> = [];
  for (const axis of [0, 1, 2] as const) {
    const aHalf = a.halfExtents[axis] ?? 0;
    const bHalf = b.halfExtents[axis] ?? 0;
    const dist = Math.abs((b.center[axis] ?? 0) - (a.center[axis] ?? 0));
    overlaps.push([axis, aHalf + bHalf - dist]);
  }
  const min = overlaps.sort((l, r) => l[1] - r[1])[0];
  const axisIndex = min?.[0] ?? 1;
  const base = [...adjustable.position] as [number, number, number];

  if (axisIndex === 1) {
    const y = verticalSeparation(adjustable, other);
    base[1] = y ?? (base[1] ?? 0);
    return { position: base, axis: 'y' };
  }
  if (axisIndex === 0 || axisIndex === 2) {
    const next = horizontalCenter(adjustable, other, axisIndex);
    base[axisIndex] = next;
    return { position: base, axis: axisIndex === 0 ? 'x' : 'z' };
  }
  base[1] += CLEARANCE_METERS;
  return { position: base, axis: 'y' };
}

/**
 * 基于当前 BOM 与真实 GLB 包络做全量预检，为每个涉及“工位设备”的命中
 * 计算最小避让位移，返回可直接回填 `station.position` 的建议。
 */
export function suggestStationLayout(line: ProductionLine, bom: AssemblyBom): LayoutSuggestionResult {
  const stationByPart = stationByDevicePartId(line, bom);
  const parts: PartGeom[] = bom.parts.map((part) => {
    const station = stationByPart.get(part.id);
    return buildGeom(part, station?.id);
  });

  const detector = new ClearanceDetector();
  detector.loadAll(parts.map((part) => ({ partId: part.partId, obb: part.obb })));
  const res = detector.runFull();
  if (res.hits.length === 0) return { suggestions: [], hitCount: 0 };

  const byId = new Map(parts.map((part) => [part.partId, part]));
  const appliedByStation = new Map<string, { position: Vec3; note: string }>();

  for (const hit of res.hits) {
    const first = byId.get(hit.firstPartId);
    const second = byId.get(hit.secondPartId);
    if (!first || !second) continue;
    const adjustable = [first, second].find((part) => part.isMovable && part.stationId);
    const other = adjustable === first ? second : first;
    if (!adjustable?.stationId || !other || !adjustable.isMovable) continue;

    const currentApplied = appliedByStation.get(adjustable.stationId);
    const currentPart: PartGeom = currentApplied
      ? {
          ...adjustable,
          position: currentApplied.position,
          obb: obbFromBomPart(
            {
              localPosition: currentApplied.position,
              localRotation: { x: 0, y: 0, z: 0, w: 1 },
            },
            [
              (adjustable.obb.halfExtents[0] ?? 0) * 2,
              (adjustable.obb.halfExtents[1] ?? 0) * 2,
              (adjustable.obb.halfExtents[2] ?? 0) * 2,
            ],
          ),
        }
      : adjustable;
    const result = separate(currentPart, other);
    const label = result.axis === 'y'
      ? `抬升到 Y=${result.position[1]?.toFixed(3)} 避让 ${other.name}`
      : result.axis === 'x'
        ? `沿 X 平移避让 ${other.name}`
        : `沿 Z 平移避让 ${other.name}`;
    appliedByStation.set(adjustable.stationId, { position: result.position, note: label });
  }

  const suggestions = [...appliedByStation.entries()].map(([stationId, value]) => ({
    stationId,
    position: value.position,
    note: value.note,
  }));
  return { suggestions, hitCount: res.hits.length };
}
