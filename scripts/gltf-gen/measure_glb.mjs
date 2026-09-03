// 量测每件 glb 的物理包围盒尺寸（不依赖浏览器/WebGL，用 Babylon 空引擎读几何）
import * as BABYLON from '@babylonjs/core';
import '@babylonjs/loaders/glTF';
import { readdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// 单一事实源：后端 model-svc 资产目录（与 gen-all.sh / app.ts 的 GLB_DIR 对齐）
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const dir = process.env['ASSEMBLE_GLB_DIR'] ?? resolve(root, 'services/model-svc/assets/glb');
const requestedFiles = process.argv.slice(2);
const files = requestedFiles.length > 0
  ? requestedFiles
  : (await readdir(dir))
      .filter((file) => file.endsWith('.glb'))
      .map((file) => file.slice(0, -'.glb'.length))
      .sort();

for (const f of files) {
  const url = resolve(dir, `${f}.glb`);
  const engine = new BABYLON.NullEngine();
  const scene = new BABYLON.Scene(engine);
  const container = await BABYLON.SceneLoader.LoadAssetContainerAsync('', url, scene);
  const meshes = container.meshes.filter((m) => m.getTotalVertices() > 0);
  const min = new BABYLON.Vector3(Infinity, Infinity, Infinity);
  const max = new BABYLON.Vector3(-Infinity, -Infinity, -Infinity);
  for (const m of meshes) {
    const bb = m.getBoundingInfo().boundingBox;
    const mi = bb.minimumWorld;
    const ma = bb.maximumWorld;
    min.x = Math.min(min.x, mi.x);
    min.y = Math.min(min.y, mi.y);
    min.z = Math.min(min.z, mi.z);
    max.x = Math.max(max.x, ma.x);
    max.y = Math.max(max.y, ma.y);
    max.z = Math.max(max.z, ma.z);
  }
  const size = max.subtract(min);
  const cx = (min.x + max.x) / 2;
  const cy = (min.y + max.y) / 2;
  const cz = (min.z + max.z) / 2;
  console.log(
    `${f.padEnd(14)} meshes=${String(meshes.length).padStart(2)} ` +
    `size=[${size.x.toFixed(2)}, ${size.y.toFixed(2)}, ${size.z.toFixed(2)}]m ` +
    `center=[${cx.toFixed(2)}, ${cy.toFixed(2)}, ${cz.toFixed(2)}]`,
  );
  engine.dispose();
}
process.exit(0);
