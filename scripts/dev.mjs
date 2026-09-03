#!/usr/bin/env node
/**
 * 一键起 dev 环境（精简：assembly-svc + interference-svc + takt-svc + vite 前端）。
 *
 * 背景：sim-platform 的 vite dev 代理把 `/lines` → 7101、`/interference` → 7102、`/takt` → 7104，
 * 若后端未起，浏览器会报 `[vite] http proxy error: ECONNREFUSED 127.0.0.1:7101`。
 * 本脚本一次性拉起这些后端与前端，按端口占用情况跳过已在跑的进程，退出时统一清理。
 *
 * 特性：
 *  - 自包含 Node 编排，不依赖 pnpm / concurrently（本机 corepack 环境无全局 pnpm）。
 *  - 前置端口探测：7101/7102/5173 若已被监听则直接复用，不重复 spawn。
 *  - 就绪轮询：两个后端探 /healthz、前端探首页，全部就绪才提示访问。
 *  - Ctrl+C（SIGINT）或任一子进程异常退出时，统一 kill 其余子进程。
 *
 * 用法（仓库根）：
 *   node scripts/dev.mjs            精简模式：assembly + interference + takt + vite
 *   node scripts/dev.mjs --all      全量模式：5 个后端 + vite（auth/model 一并起）
 *   # 或经 npm/pnpm run dev（见根 package.json scripts.dev，dev:all 走 --all）
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const NODE = process.execPath;
const children = new Set();
const tag = (name, line) => process.stdout.write(`[${name}] ${line}\n`);

/* 判断某端口是否已被占用。
 * 探测原理：在本机对该端口 listen —— bind 成功(触发 listening) = 端口空闲；
 * 抛 EADDRINUSE(error) = 已被占用。 */
function isPortOpen(host, port, timeoutMs = 800) {
  return new Promise((resolve) => {
    const sock = createServer();
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        sock.close(() => resolve(false));
      }
    }, timeoutMs);
    sock.once('error', () => {
      // listen 抛错（如 EADDRINUSE）→ 端口已被占用
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve(true);
      }
    });
    sock.listen({ host, port }, () => {
      // bind 成功 → 端口空闲可用
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        sock.close(() => resolve(false));
      }
    });
  });
}

/* HTTP 就绪探活 */
async function httpOk(url, timeoutMs = 400) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const r = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    return r.ok;
  } catch {
    return false;
  }
}

/* spawn 一个子进程，stdout/stderr 加 [tag] 前缀 */
function up(name, cmd, args, cwd) {
  const p = spawn(cmd, args, {
    cwd,
    env: { ...process.env, NODE_OPTIONS: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.add(p);
  const fwd = (stream) =>
    (stream || '').split('\n').filter(Boolean).forEach((l) => tag(name, l));
  p.stdout?.on('data', (d) => fwd(d.toString()));
  p.stderr?.on('data', (d) => fwd(d.toString()));
  p.on('exit', (code) => {
    children.delete(p);
    tag(name, `已退出 code=${code}`);
  });
  p.on('error', (e) => {
    tag(name, `spawn 失败: ${e.message}`);
    children.delete(p);
    killAll(1);
  });
  return p;
}

/* 统一清理子进程 */
function killAll(exitCode = 0) {
  for (const c of children) {
    try {
      c.kill('SIGKILL');
    } catch {
      /* ignore */
    }
  }
  process.exit(exitCode);
}

/* 轮询等待一组 URL 全部就绪 */
async function waitAll(urls, name, ms = 30000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    let ok = 0;
    for (const [, u] of urls) {
      if (await httpOk(u)) ok += 1;
    }
    if (ok === urls.length) {
      tag(name, `就绪 (${urls.map(([, u]) => u).join(', ')})`);
      return true;
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  tag(name, `等待超时 (${ms}ms)`);
  return false;
}

/* 全部 5 个 HTTP 后端（端口以 services/<svc>/src/server.ts 为准）：
 *   assembly:7101  interference:7102  model:7103  takt:7104  auth:7105
 * 精简模式起 CORE 三个（vite 代理 /lines->7101、/interference->7102、/takt->7104 只连它们）；
 * --all 模式全起 5 个（auth/model 前端暂不直连，供后端自治/联调用）。 */
const ALL_SERVICES = [
  { name: 'assembly-svc', dir: join(ROOT, 'services/assembly-svc'), port: 7101, health: 'http://127.0.0.1:7101/healthz' },
  { name: 'interference-svc', dir: join(ROOT, 'services/interference-svc'), port: 7102, health: 'http://127.0.0.1:7102/healthz' },
  { name: 'model-svc', dir: join(ROOT, 'services/model-svc'), port: 7103, health: 'http://127.0.0.1:7103/healthz' },
  { name: 'takt-svc', dir: join(ROOT, 'services/takt-svc'), port: 7104, health: 'http://127.0.0.1:7104/healthz' },
  { name: 'auth-svc', dir: join(ROOT, 'services/auth-svc'), port: 7105, health: 'http://127.0.0.1:7105/healthz' },
];
const CORE = new Set(['assembly-svc', 'interference-svc', 'takt-svc']);
const SERVICES = process.argv.includes('--all')
  ? ALL_SERVICES
  : ALL_SERVICES.filter((s) => CORE.has(s.name));
const VITE = { name: 'vite', dir: join(ROOT, 'apps/sim-platform'), port: 5173, health: 'http://127.0.0.1:5173/' };
const MODE = process.argv.includes('--all') ? '全量(5 服务)' : '精简(assembly+interference+takt)';

async function main() {
  // 1) 后端服务：产物需已 build（dist/server.js），端口空闲才起
  const svcUp = [];
  for (const svc of SERVICES) {
    const distFile = join(svc.dir, 'dist/server.js');
    if (!existsSync(distFile)) {
      tag(svc.name, `产物缺失: ${distFile} —— 请先在 ${svc.dir} 执行构建（pnpm --filter ${svc.name} build）`);
      process.exitCode = 1;
      continue;
    }
    if (await isPortOpen('127.0.0.1', svc.port)) {
      tag(svc.name, `端口 ${svc.port} 已被占用，跳过启动（直接复用）`);
    } else {
      up(svc.name, NODE, ['dist/server.js'], svc.dir);
      tag(svc.name, `启动中… (node dist/server.js @${svc.port})`);
    }
    svcUp.push(svc);
  }

  // 2) 前端 vite：端口空闲才起
  const viteBin = join(ROOT, 'node_modules/.bin/vite');
  if (!existsSync(viteBin)) {
    tag(VITE.name, `vite 缺失: ${viteBin} —— 请先安装依赖（pnpm install）`);
    process.exitCode = 1;
  } else if (await isPortOpen('127.0.0.1', VITE.port)) {
    tag(VITE.name, `端口 ${VITE.port} 已被占用，跳过启动（直接复用）`);
  } else {
    up(VITE.name, NODE, [viteBin], VITE.dir);
    tag(VITE.name, `启动中… (vite dev @${VITE.port})`);
  }

  // 3) 就绪轮询：对实际拉起的后端探 /healthz，再对前端探首页
  const healths = svcUp.map((s) => [s.name, s.health]);
  healths.push([VITE.name, VITE.health]);
  const ready = await waitAll(healths, 'probe', 30000);

  if (ready) {
    tag('main', '');
    tag('main', '══════════════════════════════════════════════');
    tag('main', `  产线 3D 装配仿真 · dev 环境已就绪（${MODE}）`);
    tag('main', '');
    tag('main', '  前端          http://localhost:5173');
    for (const s of SERVICES) {
      tag('main', `  ${s.name.padEnd(16)} http://127.0.0.1:${s.port}`);
    }
    tag('main', '');
    tag('main', '  浏览器打开上述前端地址即可（Ctrl+C 停止并清理子进程）');
    tag('main', '══════════════════════════════════════════════');
  } else {
    tag('main', '部分服务未就绪，请查看上方 [服务名] 前缀日志定位原因。');
    if (process.exitCode !== 1) process.exitCode = 1;
  }
}

process.on('SIGINT', () => {
  tag('main', '收到 Ctrl+C，正在清理子进程…');
  killAll(0);
});
process.on('SIGTERM', () => {
  tag('main', '收到 SIGTERM，正在清理子进程…');
  killAll(0);
});

main().catch((e) => {
  tag('main', `启动失败: ${e.message}`);
  killAll(1);
});
