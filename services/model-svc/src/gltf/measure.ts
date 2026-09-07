/**
 * 零依赖 GLB 场景树量测：解析 glTF 2.0 GLB 的 JSON chunk，沿节点变换（matrix/TRS）把每个
 * mesh primitive 的 POSITION accessor min/max 角点变换到世界系，累加得到世界 AABB（米）。
 *
 * 由 `scripts/gltf-gen/measure_glb.mjs` 移植为 TS，供 model-svc 上传时对自定义 GLB 实测
 * 包络尺寸 envelope（内置资产权威表 MODEL_ASSET_BOUNDS 仍由脚本线下产出）。
 * 上传量测失败一律 400 拒绝，避免无包络的自定义资产流入产线/干涉链路。
 */
import type { ModelAssetEnvelope, Vec3 } from '@assemble/domain';

export interface GlbMeasureResult {
  /** 世界 AABB 三向尺寸 [x,y,z]（米） */
  size: ModelAssetEnvelope['size'];
  /** 世界 AABB 中心 [x,y,z] */
  center: Vec3;
  /** 参与量测的 mesh 数量（用于排查空模型/异常场景） */
  meshCount: number;
}

/** 'glTF'（LE u32），GLB 魔数 */
const GLB_MAGIC = 0x46546c67;
const GLB_VERSION = 2;
/** 'JSON' chunk 类型 */
const JSON_CHUNK = 0x4e4f534a;

interface GltfNode {
  name?: string;
  matrix?: number[];
  translation?: number[];
  rotation?: number[];
  scale?: number[];
  mesh?: number;
  children?: number[];
  extras?: { motion?: unknown };
}

interface GltfAccessor {
  min?: number[];
  max?: number[];
  type?: string;
}

interface Gltf {
  scene?: number;
  scenes?: { nodes?: number[] }[];
  nodes?: GltfNode[];
  meshes?: { primitives?: { attributes?: { POSITION?: number } }[] }[];
  accessors?: GltfAccessor[];
}

interface WorldBounds {
  min: number[];
  max: number[];
}

function vec3OrThrow(values: number[] | undefined, what: string): Vec3 {
  if (!values || values.length < 3 || values.slice(0, 3).some((value) => !Number.isFinite(value))) {
    throw new Error(`${what} 须为 3 个有限数值`);
  }
  return [values[0] as number, values[1] as number, values[2] as number];
}

function readJsonChunk(buffer: Buffer): Gltf {
  if (buffer.readUInt32LE(0) !== GLB_MAGIC || buffer.readUInt32LE(4) !== GLB_VERSION) {
    throw new Error('不是 glTF 2.0 GLB（magic/version 不符）');
  }

  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const chunkLength = buffer.readUInt32LE(offset);
    const chunkType = buffer.readUInt32LE(offset + 4);
    const end = offset + 8 + chunkLength;
    if (end > buffer.length) {
      throw new Error('GLB chunk 长度越界');
    }
    if (chunkType === JSON_CHUNK) {
      const text = buffer
        .subarray(offset + 8, end)
        .toString('utf8')
        .replace(/[\u0000 ]+$/u, '');
      return JSON.parse(text) as Gltf;
    }
    offset = end;
  }

  throw new Error('缺少 JSON chunk');
}

function multiplyMatrices(left: readonly number[], right: readonly number[]): number[] {
  const result = new Array<number>(16).fill(0);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      let acc = 0;
      for (let index = 0; index < 4; index += 1) {
        acc += (left[index * 4 + row] ?? 0) * (right[column * 4 + index] ?? 0);
      }
      result[column * 4 + row] = acc;
    }
  }
  return result;
}

function matrixFromNode(node: GltfNode): number[] {
  if (node.matrix && node.matrix.length >= 16) {
    return node.matrix;
  }

  const tx = node.translation?.[0] ?? 0;
  const ty = node.translation?.[1] ?? 0;
  const tz = node.translation?.[2] ?? 0;
  const qx = node.rotation?.[0] ?? 0;
  const qy = node.rotation?.[1] ?? 0;
  const qz = node.rotation?.[2] ?? 0;
  const qw = node.rotation?.[3] ?? 1;
  const sx = node.scale?.[0] ?? 1;
  const sy = node.scale?.[1] ?? 1;
  const sz = node.scale?.[2] ?? 1;

  const xx = qx * qx;
  const yy = qy * qy;
  const zz = qz * qz;
  const xy = qx * qy;
  const xz = qx * qz;
  const yz = qy * qz;
  const wx = qw * qx;
  const wy = qw * qy;
  const wz = qw * qz;

  return [
    (1 - 2 * (yy + zz)) * sx,
    2 * (xy + wz) * sx,
    2 * (xz - wy) * sx,
    0,
    2 * (xy - wz) * sy,
    (1 - 2 * (xx + zz)) * sy,
    2 * (yz + wx) * sy,
    0,
    2 * (xz + wy) * sz,
    2 * (yz - wx) * sz,
    (1 - 2 * (xx + yy)) * sz,
    0,
    tx,
    ty,
    tz,
    1,
  ];
}

function transformPoint(matrix: readonly number[], point: readonly number[]): number[] {
  const x = point[0] ?? 0;
  const y = point[1] ?? 0;
  const z = point[2] ?? 0;
  return [
    (matrix[0] ?? 0) * x + (matrix[4] ?? 0) * y + (matrix[8] ?? 0) * z + (matrix[12] ?? 0),
    (matrix[1] ?? 0) * x + (matrix[5] ?? 0) * y + (matrix[9] ?? 0) * z + (matrix[13] ?? 0),
    (matrix[2] ?? 0) * x + (matrix[6] ?? 0) * y + (matrix[10] ?? 0) * z + (matrix[14] ?? 0),
  ];
}

function includeAccessorBounds(
  bounds: WorldBounds,
  accessor: GltfAccessor | undefined,
  worldMatrix: readonly number[],
  assetName: string,
): void {
  if (!accessor || accessor.type !== 'VEC3') {
    throw new Error(`${assetName} 的 POSITION accessor 缺少 VEC3 min/max`);
  }
  const min = vec3OrThrow(accessor.min, `${assetName} POSITION min`);
  const max = vec3OrThrow(accessor.max, `${assetName} POSITION max`);

  for (const x of [min[0], max[0]]) {
    for (const y of [min[1], max[1]]) {
      for (const z of [min[2], max[2]]) {
        const point = transformPoint(worldMatrix, [x, y, z]);
        for (let axis = 0; axis < 3; axis += 1) {
          bounds.min[axis] = Math.min(bounds.min[axis] ?? 0, point[axis] ?? 0);
          bounds.max[axis] = Math.max(bounds.max[axis] ?? 0, point[axis] ?? 0);
        }
      }
    }
  }
}

function measureScene(gltf: Gltf, assetName: string): { bounds: WorldBounds; meshCount: number } {
  const bounds: WorldBounds = {
    min: [Infinity, Infinity, Infinity],
    max: [-Infinity, -Infinity, -Infinity],
  };
  const scene = gltf.scenes?.[gltf.scene ?? 0];
  const rootNodes = scene?.nodes ?? [];
  let meshCount = 0;

  function visit(nodeIndex: number, parentMatrix: readonly number[]): void {
    const node = gltf.nodes?.[nodeIndex];
    if (!node) {
      throw new Error(`${assetName} 引用了不存在的 node ${nodeIndex}`);
    }
    const worldMatrix = multiplyMatrices(parentMatrix, matrixFromNode(node));

    if (node.mesh !== undefined) {
      const mesh = gltf.meshes?.[node.mesh];
      if (!mesh) {
        throw new Error(`${assetName} 引用了不存在的 mesh ${node.mesh}`);
      }
      meshCount += 1;
      for (const primitive of mesh.primitives ?? []) {
        const positionAccessorIndex = primitive.attributes?.POSITION;
        if (positionAccessorIndex === undefined) continue;
        includeAccessorBounds(
          bounds,
          gltf.accessors?.[positionAccessorIndex],
          worldMatrix,
          assetName,
        );
      }
    }

    for (const childIndex of node.children ?? []) visit(childIndex, worldMatrix);
  }

  for (const nodeIndex of rootNodes) visit(nodeIndex, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  if (!Number.isFinite(bounds.min[0])) {
    throw new Error(`${assetName} 不包含可量测的 POSITION`);
  }
  return { bounds, meshCount };
}

/**
 * 量测 GLB 二进制，返回世界 AABB 尺寸/中心。非法 GLB、缺 JSON chunk、节点悬空、
 * 无可量测 POSITION 等一律抛错（上传端转为 400 拒绝）。
 */
export function measureGlb(buffer: Buffer, assetName = 'GLB 资产'): GlbMeasureResult {
  const gltf = readJsonChunk(buffer);
  const { bounds, meshCount } = measureScene(gltf, assetName);
  const size: ModelAssetEnvelope['size'] = [
    (bounds.max[0] ?? 0) - (bounds.min[0] ?? 0),
    (bounds.max[1] ?? 0) - (bounds.min[1] ?? 0),
    (bounds.max[2] ?? 0) - (bounds.min[2] ?? 0),
  ];
  const center: Vec3 = [
    ((bounds.max[0] ?? 0) + (bounds.min[0] ?? 0)) / 2,
    ((bounds.max[1] ?? 0) + (bounds.min[1] ?? 0)) / 2,
    ((bounds.max[2] ?? 0) + (bounds.min[2] ?? 0)) / 2,
  ];
  return { size, center, meshCount };
}
