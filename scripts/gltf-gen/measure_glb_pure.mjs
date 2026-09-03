// 纯 node 解析 GLB 的 accessor.min/max，算出每件设备的物理包围盒（不依赖渲染引擎）
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const files = ['conveyor', 'feeder', 'vision-module', 'gantry-arm', 'box-pack'];
// 单一事实源：后端 model-svc 资产目录（与 gen-all.sh / app.ts 的 GLB_DIR 对齐）
const dir = path.join(path.dirname(url.fileURLToPath(import.meta.url)), '../../services/model-svc/assets/glb/');

function readGlb(file) {
  const buf = fs.readFileSync(file);
  // GLB header: magic(4) version(4) length(4)
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error('not glb');
  let off = 12;
  let json = null;
  let bin = null;
  while (off < buf.length) {
    const chunkLen = buf.readUInt32LE(off);
    const chunkType = buf.readUInt32LE(off + 4);
    const data = buf.subarray(off + 8, off + 8 + chunkLen);
    if (chunkType === 0x4e4f534a) json = JSON.parse(data.toString('utf8')); // JSON
    else if (chunkType === 0x004e4942) bin = data; // BIN
    off += 8 + chunkLen;
  }
  return { json, bin };
}

for (const f of files) {
  const { json } = readGlb(`${dir}${f}.glb`);
  let min = [Infinity, Infinity, Infinity];
  let max = [-Infinity, -Infinity, -Infinity];
  let meshCount = 0;
  for (const accessor of json.accessors || []) {
    if (accessor.min && accessor.max) {
      meshCount++;
      for (let i = 0; i < 3; i++) {
        min[i] = Math.min(min[i], accessor.min[i]);
        max[i] = Math.max(max[i], accessor.max[i]);
      }
    }
  }
  const size = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  const center = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
  console.log(
    `${f.padEnd(14)} accessors=${String(meshCount).padStart(2)} ` +
    `size=[${size.map((x) => x.toFixed(2)).join(', ')}]m ` +
    `center=[${center.map((x) => x.toFixed(2)).join(', ')}]`,
  );
}
