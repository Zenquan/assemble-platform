// scripts/gltf-gen/screenshot.mjs
// Playwright 截取 preview.html 加载各 .glb 的渲染图(可复用同一 server)
import { chromium } from '/Users/zenquan/.workbuddy/binaries/node/workspace/node_modules/playwright/index.mjs';
import path from 'node:path';
import url from 'node:url';
import fs from 'node:fs';

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)));
const PORT = Number(process.env.PORT || 8773);
const BASE = `http://127.0.0.1:${PORT}/preview.html`;
const OUT_DIR = path.join(ROOT, 'assets');

// 可用 chromium headless shell 路径(按已装 revision 选)
const CHROME_CANDIDATES = [
  '/Users/zenquan/Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-mac/headless_shell',
  '/Users/zenquan/Library/Caches/ms-playwright/chromium_headless_shell-1194/chrome-mac/headless_shell',
];

const targets = (process.argv.slice(2).length ? process.argv.slice(2) :
  ['vision-module', 'feeder', 'gantry-arm', 'conveyor', 'box-pack']);

let execPath = null;
for (const p of CHROME_CANDIDATES) { if (fs.existsSync(p)) { execPath = p; break; } }
if (!execPath) { console.error('no chromium binary found in candidates'); process.exit(2); }
console.log('using chromium:', execPath);

const browser = await chromium.launch({
  executablePath: execPath,
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