/**
 * gateway 路径前缀路由表 —— 单容器聚合部署的路由事实源。
 *
 * 前端同源调用（vite 代理与本模块口径一致）：
 *   /lines*         → assembly-svc    (7101)
 *   /interference*  → interference-svc (7102)
 *   /model*         → model-svc        (7103)
 *   /takt*          → takt-svc         (7104)
 *   /auth* /audit*  → auth-svc         (7105)
 *
 * 匹配规则：精确等于前缀、或前缀后紧跟 `/`（`/lines`、`/lines/l1` 命中；
 * `/linesx` 不命中），避免误吞其他前缀。
 */

export interface ServiceRoute {
  /** 请求路径前缀 */
  prefix: string;
  /** 上游服务名（日志/诊断用） */
  service: string;
  /** 上游监听端口（容器内 loopback） */
  port: number;
}

export const SERVICE_ROUTES: readonly ServiceRoute[] = [
  { prefix: '/lines', service: 'assembly-svc', port: 7101 },
  { prefix: '/interference', service: 'interference-svc', port: 7102 },
  { prefix: '/model', service: 'model-svc', port: 7103 },
  { prefix: '/takt', service: 'takt-svc', port: 7104 },
  { prefix: '/auth', service: 'auth-svc', port: 7105 },
  { prefix: '/audit', service: 'auth-svc', port: 7105 },
];

/** 聚合入口自己应答、不转发上游的路径（云托管健康探测打在 80 端口） */
export const GATEWAY_OWN_PATHS: readonly string[] = ['/healthz', '/metrics', '/telemetry'];

/** 按路径前缀匹配上游服务；未命中返回 undefined */
export function matchRoute(pathname: string): ServiceRoute | undefined {
  for (const route of SERVICE_ROUTES) {
    if (pathname === route.prefix || pathname.startsWith(`${route.prefix}/`)) {
      return route;
    }
  }
  return undefined;
}

/** 云托管容器部署需要拉起、并等待就绪的上游服务清单（与路由表端口一一对应） */
export interface UpstreamService {
  service: string;
  port: number;
  /** 该服务 dist/server.js 相对 gateway dist 目录的路径 */
  serverJsRelative: string;
}

export const UPSTREAM_SERVICES: readonly UpstreamService[] = [
  { service: 'assembly-svc', port: 7101, serverJsRelative: '../../assembly-svc/dist/server.js' },
  { service: 'interference-svc', port: 7102, serverJsRelative: '../../interference-svc/dist/server.js' },
  { service: 'model-svc', port: 7103, serverJsRelative: '../../model-svc/dist/server.js' },
  { service: 'takt-svc', port: 7104, serverJsRelative: '../../takt-svc/dist/server.js' },
  { service: 'auth-svc', port: 7105, serverJsRelative: '../../auth-svc/dist/server.js' },
];

/** 上游目标配置（`UPSTREAM_TARGETS` env 解析产物） */
export interface UpstreamTargetConfig {
  service: string;
  host: string;
  port: number;
}

/**
 * 解析 `UPSTREAM_TARGETS` env：逗号分隔的 `service=host:port` 条目；
 * 同一 service 出现多次即多副本（多目标，供健康池 failover 选址）。
 * 未配置或空串返回空数组（调用方回退默认单副本 127.0.0.1:7101–7105）。
 *
 * 例：`assembly-svc=127.0.0.1:7101,assembly-svc=127.0.0.1:7111,model-svc=127.0.0.1:7103`
 * 非法条目（缺 `=`、非法端口）静默跳过。
 */
export function parseUpstreamTargets(raw: string | undefined): UpstreamTargetConfig[] {
  if (!raw || raw.trim() === '') return [];
  const result: UpstreamTargetConfig[] = [];
  for (const entry of raw.split(',')) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const service = trimmed.slice(0, eq).trim();
    const addr = trimmed.slice(eq + 1).trim();
    const colon = addr.lastIndexOf(':');
    if (colon <= 0) continue;
    const host = addr.slice(0, colon).trim();
    const port = Number(addr.slice(colon + 1).trim());
    if (!service || !host || !Number.isInteger(port) || port <= 0 || port > 65535) continue;
    result.push({ service, host, port });
  }
  return result;
}

/** 上游目标解析产物 + 是否由 gateway 负责 spawn 本地子进程 */
export interface ResolvedUpstreams {
  /** 上游目标清单（含副本） */
  targets: UpstreamTargetConfig[];
  /** true = 未显式配置外部上游，gateway spawn 本地子进程（单容器形态） */
  spawnLocal: boolean;
}

/**
 * 解析上游目标：显式配置 `UPSTREAM_TARGETS`（多副本/外部地址）时原样使用；
 * 否则回退默认单副本 `127.0.0.1:7101–7105`（gateway spawn 本地子进程）。
 */
export function resolveUpstreams(raw: string | undefined): ResolvedUpstreams {
  const configured = parseUpstreamTargets(raw);
  if (configured.length > 0) {
    return { targets: configured, spawnLocal: false };
  }
  return {
    targets: UPSTREAM_SERVICES.map((s) => ({
      service: s.service,
      host: '127.0.0.1',
      port: s.port,
    })),
    spawnLocal: true,
  };
}
