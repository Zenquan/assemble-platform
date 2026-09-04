// scripts/gltf-gen/screenshot.mjs
// Playwright 截取 preview.html 加载各 .glb 的渲染图(可复用同一 server)
import path from 'node:path';
import url from 'node:url';
import fs from 'node:fs';

const playwrightModule = process.env['PLAYWRIGHT_MODULE'] ?? 'playwright';
const { chromium } = await import(playwrightModule);

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)));
const HOST = process.env['GLTF_PREVIEW_HOST'] ?? '127.0.0.1';
const PORT = Number(process.env.PORT || 8773);
const BASE = `http://${HOST}:${PORT}/preview.html`;
const OUT_DIR = path.join(ROOT, 'assets');

const requestedTargets = process.argv.slice(2);
const targets = requestedTargets.length > 0
  ? requestedTargets
  : fs.readdirSync(OUT_DIR)
      .filter((file) => file.endsWith('.glb'))
      .map((file) => path.basename(file, '.glb'))
      .sort();

const execPath = process.env['PLAYWRIGHT_CHROMIUM_EXECUTABLE'];

const browser = await chromium.launch({
  ...(execPath ? { executablePath: execPath } : {}),
  headless: true,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-webgl',
         '--ignore-gpu-blocklist', '--disable-dev-shm-usage'],
});
try {
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 880 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on('console', m => console.log('  [page]', m.type(), m.text()));
  for (const t of targets) {
    const file = `${t}.glb`;
    if (!fs.existsSync(path.join(OUT_DIR, file))) {
      console.log('  skip missing', file);
      continue;
    }
    console.log('shot', t);
    await page.goto(`${BASE}?m=${file}`, { waitUntil: 'networkidle', timeout: 30000 });
    // 等 GLTFLoader 加载 + 动画稳定
    await page.waitForTimeout(1800);
    const out = path.join(OUT_DIR, `${t}_preview.png`);
    await page.screenshot({ path: out, fullPage: false });
    console.log('  ->', out, fs.statSync(out).size, 'bytes');
  }
} finally {
  await browser.close();
}
