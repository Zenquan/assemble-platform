/**
 * gateway 本地鉴权 —— M4「安全、鉴权、审计与加密」方向 S3 的核心。
 *
 * gateway 是纯 node:http 实现（非 Fastify），这里把「路径→权限映射 + 本地 verifyJwt
 * + 401/403 决策」收敛到一个模块，供 server.ts 在反向代理前调用。鉴权采用无状态短效
 * HS256 JWT：与 auth-svc 共享 `AUTH_JWT_SECRET`（同 env），本地验签即可，不必每请求回源
 * auth-svc（见 docs/SECURITY.md §1/§4）。
 */
import type { PermissionAction, Role } from '@assemble/domain';
import { extractBearerToken, hasPermission, verifyJwt } from '@assemble/security';

export const TOKEN_ISSUER = 'auth-svc';

export interface AuthAllowed {
  ok: true;
  roles: Role[];
}

export interface AuthDenied {
  ok: false;
  status: 401 | 403;
  code: 'UNAUTHORIZED' | 'FORBIDDEN';
  message: string;
}

export type AuthResult = AuthAllowed | AuthDenied;

const READ_METHODS = new Set(['GET', 'HEAD']);

/**
 * 路径→权限映射。返回 undefined 表示免鉴权（`/auth/*` 身份引导流）。
 * 网关自有路径（/healthz /metrics /telemetry）与静态资源不经过本函数——
 * 它们在 server.ts 中先于路由匹配被拦截。
 */
export function requiredPermission(pathname: string, method: string): PermissionAction | undefined {
  const m = method.toUpperCase();
  if (pathname === '/interference' || pathname.startsWith('/interference/')) {
    if (pathname === '/interference/offline' || pathname.startsWith('/interference/offline/')) {
      return 'interference:offline';
    }
    return 'interference:run';
  }
  if (pathname === '/lines' || pathname.startsWith('/lines/')) {
    return READ_METHODS.has(m) ? 'line:read' : 'line:write';
  }
  if (pathname === '/model' || pathname.startsWith('/model/')) {
    return READ_METHODS.has(m) ? 'model:read' : 'model:upload';
  }
  if (pathname === '/takt' || pathname.startsWith('/takt/')) {
    return READ_METHODS.has(m) ? 'takt:view' : 'takt:write';
  }
  if (pathname === '/audit' || pathname.startsWith('/audit/')) {
    return 'audit:view';
  }
  // /auth/* 属身份引导（登录/验签/角色查询），匿名可访问
  return undefined;
}

/** 对一次受保护请求做鉴权：免鉴权路径直接放行，否则验签 + 权限断言。 */
export function authorizeRequest(opts: {
  pathname: string;
  method: string;
  authorization?: string;
  jwtSecret: string;
}): AuthResult {
  const perm = requiredPermission(opts.pathname, opts.method);
  if (perm === undefined) return { ok: true, roles: [] };

  const token = extractBearerToken(opts.authorization);
  if (!token) {
    return { ok: false, status: 401, code: 'UNAUTHORIZED', message: '缺少 Bearer token' };
  }

  let claims: Record<string, unknown>;
  try {
    claims = verifyJwt(token, opts.jwtSecret, { issuer: TOKEN_ISSUER });
  } catch {
    return { ok: false, status: 401, code: 'UNAUTHORIZED', message: 'token 无效或已过期' };
  }

  const roles = Array.isArray(claims['roles']) ? (claims['roles'] as Role[]) : [];
  if (roles.length === 0) {
    return { ok: false, status: 401, code: 'UNAUTHORIZED', message: 'token 载荷缺少角色' };
  }

  if (!hasPermission(roles, perm)) {
    return { ok: false, status: 403, code: 'FORBIDDEN', message: `缺少权限 ${perm}` };
  }
  return { ok: true, roles };
}
