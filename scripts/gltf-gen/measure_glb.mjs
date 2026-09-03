// 纯 Node 量测 GLB 场景树的世界包围盒，支持父子节点的 matrix / TRS 变换。
import { readFile, readdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const GLB_MAGIC = 0x46546c67;
const GLB_VERSION = 2;
const JSON_CHUNK = 0x4e4f534a;
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const dir = process.env['ASSEMBLE_GLB_DIR'] ?? resolve(root, 'services/model-svc/assets/glb');
const requestedFiles = process.argv.slice(2);
const files = requestedFiles.length > 0
  ? requestedFiles
  : (await readdir(dir))
      .filter((file) => file.endsWith('.glb'))
      .map((file) => file.slice(0, -'.glb'.length))
      .sort();

function readJsonChunk(buffer, file) {
  if (buffer.readUInt32LE(0) !== GLB_MAGIC || buffer.readUInt32LE(4) !== GLB_VERSION) {
    throw new Error(`${file} 不是 glTF 2.0 GLB`);
  }

  let offset = 12;
  while (offset < buffer.length) {
    const chunkLength = buffer.readUInt32LE(offset);
    const chunkType = buffer.readUInt32LE(offset + 4);
    const chunk = buffer.subarray(offset + 8, offset + 8 + chunkLength);
    if (chunkType === JSON_CHUNK) {
      return JSON.parse(chunk.toString('utf8').replace(/[\u0000 ]+$/u, ''));
    }
    offset += 8 + chunkLength;
  }

  throw new Error(`${file} 缺少 JSON chunk`);
}

function identityMatrix() {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

function multiplyMatrices(left, right) {
  const result = new Array(16).fill(0);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      for (let index = 0; index < 4; index += 1) {
        result[column * 4 + row] += left[index * 4 + row] * right[column * 4 + index];
      }
    }
  }
  return result;
}

function matrixFromNode(node) {
  if (node.matrix) return node.matrix;

  const [tx, ty, tz] = node.translation ?? [0, 0, 0];
  const [qx, qy, qz, qw] = node.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = node.scale ?? [1, 1, 1];
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

function transformPoint(matrix, point) {
  const [x, y, z] = point;
  return [
    matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12],
    matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13],
    matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14],
  ];
}

function includeAccessorBounds(bounds, accessor, worldMatrix, assetName) {
  if (!accessor?.min || !accessor.max || accessor.type !== 'VEC3') {
    throw new Error(`${assetName} 的 POSITION accessor 缺少 VEC3 min/max`);
  }

  for (const x of [accessor.min[0], accessor.max[0]]) {
    for (const y of [accessor.min[1], accessor.max[1]]) {
      for (const z of [accessor.min[2], accessor.max[2]]) {
        const point = transformPoint(worldMatrix, [x, y, z]);
        for (let axis = 0; axis < 3; axis += 1) {
          bounds.min[axis] = Math.min(bounds.min[axis], point[axis]);
          bounds.max[axis] = Math.max(bounds.max[axis], point[axis]);
        }
      }
    }
  }
}

function measureScene(gltf, assetName) {
  const bounds = {
    min: [Infinity, Infinity, Infinity],
    max: [-Infinity, -Infinity, -Infinity],
  };
  const scene = gltf.scenes?.[gltf.scene ?? 0];
  const rootNodes = scene?.nodes ?? [];
  let meshCount = 0;
  const motionNodes = [];

  function visit(nodeIndex, parentMatrix) {
    const node = gltf.nodes?.[nodeIndex];
    if (!node) throw new Error(`${assetName} 引用了不存在的 node ${nodeIndex}`);
    const worldMatrix = multiplyMatrices(parentMatrix, matrixFromNode(node));
    if (typeof node.extras?.motion === 'string') {
      motionNodes.push(`${node.name ?? `node-${nodeIndex}`}:${node.extras.motion}`);
    }

    if (node.mesh !== undefined) {
      const mesh = gltf.meshes?.[node.mesh];
      if (!mesh) throw new Error(`${assetName} 引用了不存在的 mesh ${node.mesh}`);
      meshCount += 1;
      for (const primitive of mesh.primitives ?? []) {
        const positionAccessor = primitive.attributes?.POSITION;
        if (positionAccessor === undefined) continue;
        includeAccessorBounds(bounds, gltf.accessors?.[positionAccessor], worldMatrix, assetName);
      }
    }

    for (const childIndex of node.children ?? []) visit(childIndex, worldMatrix);
  }

  for (const nodeIndex of rootNodes) visit(nodeIndex, identityMatrix());
  if (!Number.isFinite(bounds.min[0])) throw new Error(`${assetName} 不包含可量测 POSITION`);
  return { bounds, meshCount, motionNodes };
}

for (const assetName of files) {
  const file = resolve(dir, `${assetName}.glb`);
  const gltf = readJsonChunk(await readFile(file), file);
  const { bounds, meshCount, motionNodes } = measureScene(gltf, assetName);
  const size = bounds.max.map((value, axis) => value - bounds.min[axis]);
  const center = bounds.max.map((value, axis) => (value + bounds.min[axis]) / 2);
  console.log(
    `${assetName.padEnd(22)} meshes=${String(meshCount).padStart(2)} ` +
    `size=[${size.map((value) => value.toFixed(2)).join(', ')}]m ` +
    `center=[${center.map((value) => value.toFixed(2)).join(', ')}] ` +
    `motion=[${motionNodes.join(', ')}]`,
  );
}
