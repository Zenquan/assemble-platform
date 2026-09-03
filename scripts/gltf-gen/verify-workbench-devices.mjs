// scripts/gltf-gen/verify-workbench-devices.mjs
// 起 vite dev server + 用 playwright 拦截 fetchLine 注入 fixture + 等设备加载 + 截图
import { chromium } from '/Users/zenquan/.workbuddy/binaries/node/workspace/node_modules/playwright/index.mjs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import url from 'node:url';
import fs from 'node:fs';

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '../..');
const SIMPLATFORM = path.join(ROOT, 'apps/sim-platform');
const MODEL_SVC = path.join(ROOT, 'services/model-svc');
const VITE_BIN = path.join(ROOT, 'node_modules/.bin/vite');
const OUT_PNG = path.join(ROOT, 'scripts/gltf-gen/assets/workbench-devices.png');
const LINE_ID = 'line-sorting-01';
const MODEL_PORT = 7103;

const CHROME_CANDIDATES = [
  '/Users/zenquan/Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-mac/headless_shell',
  '/Users/zenquan/Library/Caches/ms-playwright/chromium_headless_shell-1194/chrome-mac/headless_shell',
];

const fixtureLine = {
  id: LINE_ID,
  name: '一号分拣线（fixture）',
  kind: 'sorting',
  stations: [
    { id: 's1', lineId: LINE_ID, seq: 1, name: '上料', taktSeconds: 2.4 },
    { id: 's2', lineId: LINE_ID, seq: 2, name: '视觉分拣', taktSeconds: 1.6 },
    { id: 's3', lineId: LINE_ID, seq: 3, name: '装箱', taktSeconds: 2.0 },
],
  enabled: true,
  modelVersion: 'fixture',
  createdAt: '2026-09-03T00:00:00Z',
  updatedAt: '2026-09-03T00:00:00Z',
};

// 找 chrome
let execPath = null;
for (const p of CHROME_CANDIDATES) if (fs.existsSync(p)) { execPath = p; break; }
if (!execPath) { console.error('no chromium'); process.exit(2); }

// 起 vite dev server
console.log('[verify] starting vite dev...');
const vite = spawn(VITE_BIN, ['--port', '5180', '--host', '127.0.0.1'], {
  cwd: SIMPLATFORM, env: { ...process.env, NODE_OPTIONS: '' }, stdio: ['ignore', 'pipe', 'pipe'],
});

// 起 model-svc（7103）：vite 代理 /model -> 7103，设备 glb 从后端接口下发
console.log('[verify] starting model-svc on 7103...');
const modelSvc = spawn(process.execPath, ['dist/server.js'], {
  cwd: MODEL_SVC, env: { ...process.env, NODE_OPTIONS: '' }, stdio: ['ignore', 'pipe', 'pipe'],
});
modelSvc.stdout.on('data', (b) => process.stdout.write('[model] ' + b.toString()));
modelSvc.stderr.on('data', (b) => process.stderr.write('[model!] ' + b.toString()));
modelSvc.on('exit', (code) => { if (code !== 0 && code !== null) console.log('[model] exited', code); });

await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('vite start timeout 30s')), 30000);
  vite.stdout.on('data', (b) => {
    const s = b.toString();
    process.stdout.write('[vite] ' + s);
    if (s.includes('Local:') || s.includes('127.0.0.1:5180')) {
      clearTimeout(timer); resolve();
    }
  });
  vite.stderr.on('data', (b) => process.stderr.write('[vite!] ' + b.toString()));
  vite.on('exit', (code) => { if (code !== 0 && code !== null) { clearTimeout(timer); reject(new Error('vite exited ' + code)); } });
});

// 等 model-svc 就绪（探 /healthz）
await new Promise((resolve) => {
  const t0 = Date.now();
  const poll = async () => {
    try {
      const r = await fetch(`http://127.0.0.1:${MODEL_PORT}/healthz`);
      if (r.ok) return resolve();
    } catch { /* not ready */ }
    if (Date.now() - t0 > 15000) return resolve(); // 超时也继续（下游会报 load failed）
    setTimeout(poll, 300);
  };
  poll();
});

console.log('[verify] opening browser, mocking /lines/:id...');
const browser = await chromium.launch({
  executablePath: execPath,
  headless: true,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-webgl',
         '--ignore-gpu-blocklist', '--disable-dev-shm-usage'],
});
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 760 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  // 拦截 lines API 返回 fixture
  await page.route('**/api/lines/**', (route) => {
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fixtureLine) });
  });
  await page.route('**/api/lines', (route) => {
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([fixtureLine]) });
  });
  page.on('console', (m) => console.log('  [page]', m.type(), m.text()));
  page.on('pageerror', (e) => console.log('  [page error]', e.message));

  await page.goto(`http://127.0.0.1:5180/#/workbench/${LINE_ID}`, { waitUntil: 'networkidle', timeout: 30000 });
  // 等设备加载：device-loaded-count 文案从 "0/N" 变为 "N/N"
  // layoutForLine 对 3 工位产线返 5 件（1 conveyor + 1 feeder + 1 vision-module + 1 gantry-arm + 1 box-pack）
  console.log('[verify] waiting for devices to load...');
  try {
    await page.waitForFunction(
      () => {
        const el = document.querySelector('[data-test="device-loaded-count"]');
        if (!el) return false;
        const txt = (el.textContent || '').trim();
        const m = txt.match(/^(\d+)\/(\d+)$/);
        if (!m) return false;
        return Number(m[1]) > 0 && m[1] === m[2]; // 全加载完
      },
      { timeout: 15000 },
    );
    const badge = await page.$eval('[data-test="device-loaded-count"]', (el) => el.textContent);
    console.log('  [badge]', badge.trim());
  } catch (e) {
    const badge = await page.$eval('[data-test="device-loaded-count"]', (el) => el.textContent).catch(() => 'NO BADGE');
    console.log('  [timeout] badge=', badge.trim(), '| err=', e.message);
  }
  // 调试：读取引擎内 devices-root 子节点位置/缩放，确认是否进场景 + 在视野内
  const dbg = await page.evaluate(() => {
    const sim = window.__sim;
    if (!sim?.scene?._devicesRoot) return { hasRoot: false };
    const root = sim.scene._devicesRoot;
    // 0.4.x 诊断：把所有零件盒子暂时隐藏（不删），让设备独占视野
    // 注意：scene.meshes 是 Map，须用 values() 遍历（旧 for..of 遍历不到，导致盒子没隐藏）
    const partMeshes = sim.scene.meshes ? Array.from(sim.scene.meshes.values()) : [];
    const partHidden = [];
    for (const m of partMeshes) {
      if (m.name?.startsWith('part-')) {
        partHidden.push(m.name);
        m.setEnabled(false);
      }
    }
    // 相机固定俯视装配体中心（避免 _frameWithDevices 把设备拉得太远或仰角过大）
    const cam = sim.scene.scene?.activeCamera;
    if (cam) {
      cam.alpha = -Math.PI / 2;
      cam.beta = Math.PI / 3.2;
      cam.radius = 18;
      cam.target && cam.target.set(0, 1, 0);
    }
    // 隐藏巨大的 floor（56x56 蓝色平板，避免遮挡设备）
    const allMeshes = sim.scene.scene ? sim.scene.scene.meshes : [];
    const floorsHidden = [];
    if (allMeshes && typeof allMeshes.forEach === 'function') {
      allMeshes.forEach((m) => {
        if (m.name === 'floor') { m.setEnabled(false); floorsHidden.push(m.name); }
      });
    }
    // 强制把每个设备根节点 scale 5 倍（绕开可能的微小尺寸/取景问题）+ 关闭雾化
    if (root) {
      root.scaling.set(5, 5, 5);
      root.computeWorldMatrix(true);
    }
    // 在 evaluate 里用 BABYLON 全局（如果 vite 已注入）
    const hasBabylon = typeof window.BABYLON !== 'undefined' || typeof BABYLON !== 'undefined';
    const children = (root.getChildren?.() || []).map((n) => ({
      name: n.name,
      pos: n.position ? { x: +n.position.x.toFixed(2), y: +n.position.y.toFixed(2), z: +n.position.z.toFixed(2) } : null,
      scl: n.scaling ? { x: +n.scaling.x.toFixed(2), y: +n.scaling.y.toFixed(2), z: +n.scaling.z.toFixed(2) } : null,
      rot: n.rotation ? { x: +n.rotation.x.toFixed(3), y: +n.rotation.y.toFixed(3), z: +n.rotation.z.toFixed(3) } : null,
      absolutePos: n.getAbsolutePosition ? { x: +n.getAbsolutePosition().x.toFixed(2), y: +n.getAbsolutePosition().y.toFixed(2), z: +n.getAbsolutePosition().z.toFixed(2) } : null,
      directChildren: n.getChildren().length,
      childMeshes: n.getChildMeshes().length,
      meshSummary: (() => {
        const ms = n.getChildMeshes();
        const withVerts = ms.filter((m) => m.getTotalVertices?.() > 0);
        let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
        for (const m of withVerts) {
          const bb = m.getBoundingInfo().boundingBox;
          const a = bb.minimumWorld, b = bb.maximumWorld;
          if (a.x < minX) minX = a.x; if (a.y < minY) minY = a.y; if (a.z < minZ) minZ = a.z;
          if (b.x > maxX) maxX = b.x; if (b.y > maxY) maxY = b.y; if (b.z > maxZ) maxZ = b.z;
        }
        return {
          meshCount: ms.length,
          withVerts: withVerts.length,
          bbox: withVerts.length > 0 ? {
            min: [minX.toFixed(2), minY.toFixed(2), minZ.toFixed(2)],
            max: [maxX.toFixed(2), maxY.toFixed(2), maxZ.toFixed(2)],
          } : null,
          firstMesh: ms[0] ? {
            name: ms[0].name,
            totalVerts: ms[0].getTotalVertices?.(),
            matName: ms[0].material?.name ?? null,
            matType: ms[0].material?.getClassName?.() ?? null,
            diffuse: ms[0].material?.diffuseColor ? [ms[0].material.diffuseColor.r.toFixed(2), ms[0].material.diffuseColor.g.toFixed(2), ms[0].material.diffuseColor.b.toFixed(2)] : null,
            albedo: ms[0].material?.albedoColor ? [ms[0].material.albedoColor.r.toFixed(2), ms[0].material.albedoColor.g.toFixed(2), ms[0].material.albedoColor.b.toFixed(2)] : null,
            enabled: ms[0].isEnabled(),
            visible: ms[0].isVisible,
            absPos: ms[0].getAbsolutePosition ? { x: +ms[0].getAbsolutePosition().x.toFixed(2), y: +ms[0].getAbsolutePosition().y.toFixed(2), z: +ms[0].getAbsolutePosition().z.toFixed(2) } : null,
            absScale: ms[0].scaling ? [+ms[0].scaling.x.toFixed(2), +ms[0].scaling.y.toFixed(2), +ms[0].scaling.z.toFixed(2)] : null,
            absRadius: ms[0].getBoundingInfo ? +ms[0].getBoundingInfo().boundingSphere.radiusWorld.toFixed(2) : null,
          } : null,
          sampleMesh: withVerts[0] ? {
            name: withVerts[0].name,
            totalVerts: withVerts[0].getTotalVertices?.(),
            matName: withVerts[0].material?.name ?? null,
            matType: withVerts[0].material?.getClassName?.() ?? null,
            diffuse: withVerts[0].material?.diffuseColor ? [withVerts[0].material.diffuseColor.r.toFixed(2), withVerts[0].material.diffuseColor.g.toFixed(2), withVerts[0].material.diffuseColor.b.toFixed(2)] : null,
            albedo: withVerts[0].material?.albedoColor ? [withVerts[0].material.albedoColor.r.toFixed(2), withVerts[0].material.albedoColor.g.toFixed(2), withVerts[0].material.albedoColor.b.toFixed(2)] : null,
          } : null,
        };
      })(),
    }));
    const camInfo = cam ? {
      type: cam.getClassName(),
      pos: { x:+cam.position.x.toFixed(2), y:+cam.position.y.toFixed(2), z:+cam.position.z.toFixed(2) },
      target: cam.target ? { x:+cam.target.x.toFixed(2), y:+cam.target.y.toFixed(2), z:+cam.target.z.toFixed(2) } : null,
      radius: cam.radius ? +cam.radius.toFixed(2) : null,
    } : null;
    return { hasRoot: true, partHidden: partHidden.length, rootPos: { x:+root.position.x.toFixed(2), y:+root.position.y.toFixed(2), z:+root.position.z.toFixed(2) }, children, camInfo };
  });
  console.log('  [debug]', JSON.stringify(dbg, null, 2));
  // 隐藏零件截图（只显示设备）
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(path.dirname(OUT_PNG), 'workbench-devices-only.png'), fullPage: false });
  // 渲染稳定 + 等 1.5s
  await page.waitForTimeout(1500);
  await page.screenshot({ path: OUT_PNG, fullPage: false });
  console.log('  ->', OUT_PNG, fs.statSync(OUT_PNG).size, 'bytes');
} finally {
  await browser.close();
  vite.kill();
  modelSvc.kill();
}