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
 *
 * HA（0.5.x）：转发经 `UpstreamHealthPool` 选健康地址，失败摘流并 failover 重试一次；
 * 周期探活让恢复的上游重新入池。多副本地址配置（UPSTREAM_TARGETS）见 S3。
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
import { UpstreamHealthPool, type UpstreamTarget } from './healthPool.js';
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
  type ServiceRoute,
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
const POOL_REFRESH_MS = Number(process.env['GATEWAY_HEALTH_REFRESH_MS'] ?? 5_000);
/** 转发请求体缓冲上限；超过则不做 failover 重试（直接 413） */
const MAX_FORWARD_BODY_BYTES = 5 * 1024 * 1024;

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
async function isUpstreamReady(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const req = httpRequest(
      { host, port, path: '/healthz', method: 'GET', timeout: 2_000 },
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

/** 等待健康池内全部上游就绪；超时打印未就绪清单并抛错 */
async function waitForUpstreams(pool: UpstreamHealthPool): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  let allReady = false;
  while (!allReady && Date.now() < deadline) {
    await pool.refresh();
    allReady = pool.snapshot().every(({ target }) => target.healthy);
    if (!allReady) await new Promise((resolve) => setTimeout(resolve, READY_POLL_MS));
  }
  if (!allReady) {
    const notReady = pool
      .snapshot()
      .filter(({ target }) => !target.healthy)
      .map(({ service, target }) => `${service}:${target.port}`);
    throw new Error(`上游服务未就绪（${READY_TIMEOUT_MS}ms 超时）: ${notReady.join(', ')}`);
  }
  log('all upstreams ready');
}

/** 聚合健康检查：探活健康池所有目标，输出结构化状态 */
async function aggregateHealth(pool: UpstreamHealthPool): Promise<Record<string, unknown>> {
  await pool.refresh();
  const upstreams = pool.snapshot().map(({ service, target }) => ({
    service,
    host: target.host,
    port: target.port,
    ready: target.healthy,
    ...(target.lastError ? { lastError: target.lastError } : {}),
  }));
  const allReady = upstreams.every((u) => u.ready);
  return {
    status: allReady ? 'ok' : 'degraded',
    service: 'gateway',
    upstreams,
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

/** 缓冲读取请求体（用于 failover 重试重放）；超限/出错返回 null */
function readRequestBody(req: IncomingMessage, limitBytes: number): Promise<Buffer | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let overflow = false;
    req.on('data', (chunk: Buffer) => {
      if (overflow) return;
      size += chunk.length;
      if (size > limitBytes) {
        overflow = true;
        chunks.length = 0;
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(overflow ? null : Buffer.concat(chunks)));
    req.on('error', () => resolve(null));
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(text),
  });
  res.end(text);
}

/** 单次转发到指定目标；返回是否「已接住」（true=响应已开始，不可再重试；false=连接失败可重试） */
function attemptForward(
  target: UpstreamTarget,
  req: IncomingMessage,
  res: ServerResponse,
  url: string,
  headers: Record<string, string | string[] | undefined>,
  body: Buffer | null,
): Promise<boolean> {
  return new Promise((resolve) => {
    const outHeaders = { ...headers, host: `${target.host}:${target.port}` };
    const upstream = httpRequest(
      { host: target.host, port: target.port, path: url, method: req.method, headers: outHeaders },
      (upRes) => {
        res.writeHead(upRes.statusCode ?? 502, upRes.headers);
        upRes.pipe(res);
        resolve(true);
      },
    );
    upstream.on('error', () => {
      if (res.headersSent) {
        res.destroy();
        resolve(true); // 响应已开始，无法重试
      } else {
        resolve(false); // 连接失败，调用方可摘流后重试
      }
    });
    if (body && body.length > 0) upstream.write(body);
    upstream.end();
  });
}

/**
 * 健康池选地址转发 + 失败 failover 重试一次：
 *  - pick 健康目标；无健康目标直接 502；
 *  - 首次连接失败 → markUnhealthy 摘流 → 再 pick 一次（若还有其它健康副本）重试；
 *  - 两次都失败或无备用目标 → 502。
 */
async function forwardToUpstream(
  req: IncomingMessage,
  res: ServerResponse,
  route: ServiceRoute,
  url: string,
  headers: Record<string, string | string[] | undefined>,
  pool: UpstreamHealthPool,
): Promise<void> {
  const body = await readRequestBody(req, MAX_FORWARD_BODY_BYTES);
  if (body === null) {
    sendJson(res, 413, { ok: false, code: 'PAYLOAD_TOO_LARGE', message: '请求体超限' });
    return;
  }

  let target = pool.pick(route.service);
  if (!target) {
    sendJson(res, 502, {
      ok: false,
      code: 'BAD_GATEWAY',
      message: `上游 ${route.service} 无健康副本可用`,
    });
    return;
  }

  let delivered = false;
  for (let attempt = 0; attempt < 2 && !delivered; attempt++) {
    delivered = await attemptForward(target, req, res, url, headers, body);
    if (!delivered) {
      pool.markUnhealthy(route.service, target.host, target.port, 'forward connection failed');
      target = pool.pick(route.service);
      if (!target) break;
    }
  }

  if (!delivered) {
    sendJson(res, 502, {
      ok: false,
      code: 'BAD_GATEWAY',
      message: `上游 ${route.service} 不可用（已 failover 重试）`,
    });
  }
}

/** 反向代理主服务（node:http；健康池选址 + failover；静态托管兜底） */
function startProxyServer(jwtSecret: string, pool: UpstreamHealthPool): void {
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
        aggregateHealth(pool)
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
    // 透传 request-id 给上游，让服务日志与本条链路串起来
    headers[REQUEST_ID_HEADER] = requestId;

    await forwardToUpstream(req, res, matchedRoute, url, headers, pool);
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

  // 上游健康池：默认单副本 127.0.0.1:7101–7105（S3 由 UPSTREAM_TARGETS env 扩展多副本）
  const pool = new UpstreamHealthPool(isUpstreamReady);
  for (const s of UPSTREAM_SERVICES) {
    pool.add(s.service, '127.0.0.1', s.port);
  }

  spawnAll();
  try {
    await waitForUpstreams(pool);
  } catch (err) {
    logJson('error', 'gateway startup failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    process.exit(1);
  }
  startProxyServer(jwtSecret, pool);

  // 周期探活：摘流的上游恢复后自动重新入池（failover 恢复）
  setInterval(() => {
    void pool.refresh();
  }, POOL_REFRESH_MS).unref?.();
}

await main();
