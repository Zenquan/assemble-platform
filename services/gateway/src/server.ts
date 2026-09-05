/**
 * gateway 聚合入口 —— 单容器部署形态的进程编排 + 反向代理。
 *
 * 一个容器一个进程：
 *   1. spawn 各后端服务子进程（127.0.0.1:7101–7105），保持服务边界与独立 dist 产物；
 *   2. 等待各服务 /healthz 就绪；
 *   3. 监听 PORT（云托管要求 3000），按 routing.ts 前缀表把同源请求转发到对应上游，
 *      并把 /healthz 聚合为网关健康探针。
 *
 * 服务间仍经 HTTP 通信（interference/takt 通过默认 ASSEMBLY_SVC_URL=127.0.0.1:7101 访问
 * assembly-svc），不 import 彼此源码。
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer, request as httpRequest } from 'node:http';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  GATEWAY_OWN_PATHS,
  matchRoute,
  UPSTREAM_SERVICES,
} from './routing.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env['PORT'] ?? 3000);
const HOST = process.env['HOST'] ?? '0.0.0.0';
const READY_TIMEOUT_MS = Number(process.env['GATEWAY_READY_TIMEOUT_MS'] ?? 30_000);
const READY_POLL_MS = Number(process.env['GATEWAY_READY_POLL_MS'] ?? 300);

const log = (msg: string): void => console.log(`[gateway] ${msg}`);

/** 启动一个上游服务子进程（继承 stdout/stderr；端口/监听地址由 env 覆盖） */
function spawnUpstream(service: (typeof UPSTREAM_SERVICES)[number]): ChildProcess {
  const serverJs = path.resolve(__dirname, service.serverJsRelative);
  const child = spawn(process.execPath, [serverJs], {
    env: { ...process.env, PORT: String(service.port), HOST: '127.0.0.1' },
    stdio: 'inherit',
  });
  log(`spawned ${service.service} (pid=${child.pid ?? '?'}, port=${service.port})`);
  child.on('exit', (code, signal) => {
    // 任一上游退出即整体退出，交由云托管容器重启策略恢复
    log(`${service.service} exited (code=${code}, signal=${signal ?? 'none'})`);
    process.exit(1);
  });
  return child;
}

/** 探测单个上游 /healthz（就绪返回 true） */
async function isUpstreamReady(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const req = httpRequest(
      { host: '127.0.0.1', port, path: '/healthz', method: 'GET', timeout: 2_000 },
      (res) => {
        res.resume();
        resolve(res.statusCode === 200);
      },
    );
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
    req.end();
  });
}

/** 等待全部上游就绪；超时打印未就绪清单并抛错 */
async function waitForUpstreams(services: readonly (typeof UPSTREAM_SERVICES)[number][]): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  const pending = new Set(services.map((s) => s.port));
  while (pending.size > 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, READY_POLL_MS));
    for (const port of [...pending]) {
      if (await isUpstreamReady(port)) {
        pending.delete(port);
        const svc = services.find((s) => s.port === port);
        log(`${svc?.service ?? port} ready`);
      }
    }
  }
  if (pending.size > 0) {
    const notReady = services.filter((s) => pending.has(s.port)).map((s) => `${s.service}:${s.port}`);
    throw new Error(`上游服务未就绪（${READY_TIMEOUT_MS}ms 超时）: ${notReady.join(', ')}`);
  }
}

/** 聚合健康检查：各上游 /healthz 状态 + 自身状态 */
async function aggregateHealth(): Promise<Record<string, unknown>> {
  const results = await Promise.all(
    UPSTREAM_SERVICES.map(async (s) => ({
      service: s.service,
      ready: await isUpstreamReady(s.port),
    })),
  );
  const allReady = results.every((r) => r.ready);
  return {
    status: allReady ? 'ok' : 'degraded',
    service: 'gateway',
    upstreams: results,
    time: new Date().toISOString(),
  };
}

const spawnAll = (): ChildProcess[] => UPSTREAM_SERVICES.map(spawnUpstream);

/** 反向代理主服务（node:http，流式 pipe，不缓存响应体） */
function startProxyServer(): void {
  const server = createServer((req, res) => {
    const url = req.url ?? '/';
    // 仅取 pathname 参与路由；query string 原样透传给上游
    const pathname = url.split('?')[0] ?? '/';

    if (GATEWAY_OWN_PATHS.includes(pathname)) {
      aggregateHealth()
        .then((health) => {
          const body = JSON.stringify(health);
          res.writeHead(health.status === 'ok' ? 200 : 503, {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
          });
          res.end(body);
        })
        .catch(() => {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'error', service: 'gateway' }));
        });
      return;
    }

    const route = matchRoute(pathname);
    if (!route) {
      const body = JSON.stringify({ ok: false, code: 'NOT_FOUND', message: `网关无匹配路由: ${pathname}` });
      res.writeHead(404, {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      });
      res.end(body);
      return;
    }

    // 剥离 hop-by-hop 头，避免污染上游连接语义；其余头部透传
    const headers = { ...req.headers };
    for (const hop of ['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade']) {
      delete headers[hop];
    }
    headers['host'] = `127.0.0.1:${route.port}`;

    const upstream = httpRequest(
      { host: '127.0.0.1', port: route.port, path: url, method: req.method, headers },
      (upRes) => {
        res.writeHead(upRes.statusCode ?? 502, upRes.headers);
        upRes.pipe(res);
      },
    );
    upstream.on('error', (err) => {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      const body = JSON.stringify({
        ok: false,
        code: 'BAD_GATEWAY',
        message: `上游 ${route.service} 不可用: ${err.message}`,
      });
      res.writeHead(502, {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      });
      res.end(body);
    });
    req.pipe(upstream);
  });

  server.listen(PORT, HOST, () => {
    log(`gateway listening on http://${HOST}:${PORT}`);
  });
}

async function main(): Promise<void> {
  spawnAll();
  try {
    await waitForUpstreams([...UPSTREAM_SERVICES]);
  } catch (err) {
    console.error(`[gateway] ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
  startProxyServer();
}

await main();
