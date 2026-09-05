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

/** 聚合入口自己应答、不转发上游的路径（云托管健康探测打在 3000 端口） */
export const GATEWAY_OWN_PATHS: readonly string[] = ['/healthz'];

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
