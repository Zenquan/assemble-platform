/**
 * gateway 聚合入口 —— 单容器部署形态的进程编排 + 反向代理。
 *
 * 一个容器一个进程：
 *   1. spawn 各后端服务子进程（127.0.0.1:7101–7105），保持服务边界与独立 dist 产物；
 *   2. 等待各服务 /healthz 就绪；
 *   3. 监听 PORT（云托管要求 80），按 routing.ts 前缀表把同源请求转发到对应上游，
 *      把 /healthz 聚合为网关健康探针，并为未命中 API 的 GET/HEAD 托管
 *      sim-platform 静态产物（单容器形态下前端与 API 同源）。
 *
 * 服务间仍经 HTTP 通信（interference/takt 通过默认 ASSEMBLY_SVC_URL=127.0.0.1:7101 访问
 * assembly-svc），不 import 彼此源码。
 */
import { spawn, type ChildProcess } from 'node:child_process';
import {
  createServer,
  request as httpRequest,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { REQUEST_ID_HEADER } from '@assemble/observability';
import { resolveJwtSecret } from '@assemble/security';
import {
  fetchUpstreamMetricsText,
  gatewayHttpMetrics,
  getOrCreateRequestId,
  logJson,
  recordTelemetry,
  readJsonBody,
  renderGatewayMetrics,
  type TelemetrySample,
  type UpstreamMetricsText,
} from './observability.js';
import {
  GATEWAY_OWN_PATHS,
  matchRoute,
  UPSTREAM_SERVICES,
} from './routing.js';
import { authorizeRequest } from './auth.js';
import { tryServeStaticFile } from './static.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env['PORT'] ?? 80);
const HOST = process.env['HOST'] ?? '0.0.0.0';
const STATIC_DIR =
  process.env['SIM_WEB_ROOT'] ?? path.resolve(__dirname, '../../../apps/sim-platform/dist');
const READY_TIMEOUT_MS = Number(process.env['GATEWAY_READY_TIMEOUT_MS'] ?? 30_000);
const READY_POLL_MS = Number(process.env['GATEWAY_READY_POLL_MS'] ?? 300);

const log = (msg: string): void => logJson('info', msg);

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

/** 聚合 /metrics：gateway 自身指标 + 上拉各上游 /metrics 注入 service 标签合并 */
async function handleMetrics(res: ServerResponse): Promise<void> {
  const upstreams: UpstreamMetricsText[] = [];
  for (const s of UPSTREAM_SERVICES) {
    try {
      upstreams.push({ service: s.service, text: await fetchUpstreamMetricsText(s.port) });
    } catch (err) {
      // 单个上游拉取失败不阻断整体，日志记录后跳过（degraded 聚合）
      logJson('warn', 'upstream metrics fetch failed', {
        service: s.service,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  const body = renderGatewayMetrics(upstreams);
  res.writeHead(200, {
    'Content-Type': 'text/plain; version=0.0.4; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

/** 接收前端 SimMonitor 上报的 telemetry 样本，内存聚合后返回 ok */
async function handleTelemetry(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'POST') {
    const body = JSON.stringify({
      ok: false,
      code: 'METHOD_NOT_ALLOWED',
      message: 'telemetry 仅接受 POST',
    });
    res.writeHead(405, {
      'Content-Type': 'application/json',
      Allow: 'POST',
      'Content-Length': Buffer.byteLength(body),
    });
    res.end(body);
    return;
  }
  const payload = await readJsonBody(req);
  const rawSamples =
    payload !== null && typeof payload === 'object' && Array.isArray((payload as { samples?: unknown }).samples)
      ? ((payload as { samples: TelemetrySample[] }).samples)
      : [];
  const received = recordTelemetry(rawSamples);
  const resp = JSON.stringify({ ok: true, data: { received } });
  res.writeHead(200, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(resp),
  });
  res.end(resp);
}

/** 反向代理主服务（node:http，流式 pipe，不缓存响应体） */
function startProxyServer(jwtSecret: string): void {
  const server = createServer(async (req, res) => {
    const url = req.url ?? '/';
    // 仅取 pathname 参与路由；query string 原样透传给上游
    const pathname = url.split('?')[0] ?? '/';
    const startedAt = gatewayHttpMetrics.startRequest();
    const requestId = getOrCreateRequestId(req);
    // gateway 自身所有响应都回显 request-id，供前端/下游串链路
    res.setHeader(REQUEST_ID_HEADER, requestId);

    const matchedRoute = matchRoute(pathname);
    // route 标签收敛：上游前缀 / gateway 自有路径 / 其它（静态与 404 归并，避免高基数）
    const routeLabel =
      matchedRoute?.prefix ?? (GATEWAY_OWN_PATHS.includes(pathname) ? pathname : 'other');

    res.on('finish', () => {
      gatewayHttpMetrics.record(startedAt, req.method ?? 'GET', routeLabel, res.statusCode);
      logJson('info', 'access', {
        method: req.method ?? 'GET',
        path: pathname,
        status: res.statusCode,
        durationMs: Date.now() - startedAt,
        requestId,
        upstream: matchedRoute?.service ?? 'gateway',
      });
    });

    if (GATEWAY_OWN_PATHS.includes(pathname)) {
      if (pathname === '/metrics') {
        await handleMetrics(res);
      } else if (pathname === '/telemetry') {
        await handleTelemetry(req, res);
      } else {
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
      }
      return;
    }

    if (!matchedRoute) {
      // 未匹配 API 的 GET/HEAD 尝试静态托管（sim-platform Vite 产物）
      if (await tryServeStaticFile(req, res, pathname, STATIC_DIR)) return;
      const body = JSON.stringify({ ok: false, code: 'NOT_FOUND', message: `网关无匹配路由: ${pathname}` });
      res.writeHead(404, {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      });
      res.end(body);
      return;
    }

    // 本地鉴权：/auth/* 免鉴权，其余前缀按路径→权限映射验签 + 断言（401/403）
    const auth = authorizeRequest({
      pathname,
      method: req.method ?? 'GET',
      authorization: req.headers.authorization,
      jwtSecret,
    });
    if (!auth.ok) {
      const body = JSON.stringify({ ok: false, code: auth.code, message: auth.message });
      res.writeHead(auth.status, {
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
    headers['host'] = `127.0.0.1:${matchedRoute.port}`;
    // 透传 request-id 给上游，让服务日志与本条链路串起来
    headers[REQUEST_ID_HEADER] = requestId;

    const upstream = httpRequest(
      { host: '127.0.0.1', port: matchedRoute.port, path: url, method: req.method, headers },
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
        message: `上游 ${matchedRoute.service} 不可用: ${err.message}`,
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
  // 本地鉴权密钥：生产必须显式 AUTH_JWT_SECRET（与 auth-svc 同源），缺失即 fail-fast
  const { secret: jwtSecret, usingDev } = resolveJwtSecret({
    nodeEnv: process.env['NODE_ENV'],
    explicit: process.env['AUTH_JWT_SECRET'],
  });
  if (usingDev) logJson('warn', '未配置 AUTH_JWT_SECRET，使用开发默认密钥（仅限本地/测试环境）');

  spawnAll();
  try {
    await waitForUpstreams([...UPSTREAM_SERVICES]);
  } catch (err) {
    logJson('error', 'gateway startup failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    process.exit(1);
  }
  startProxyServer(jwtSecret);
}

await main();
