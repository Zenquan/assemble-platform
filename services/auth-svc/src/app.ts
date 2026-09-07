import type { AuthPrincipal, PermissionAction, Role } from '@assemble/domain';
import { err, ok } from '@assemble/http';
import { createReadinessState, registerHealthRoutes } from '@assemble/health';
import {
  createHttpMetrics,
  MetricsRegistry,
  REQUEST_ID_HEADER,
  renderPrometheusText,
} from '@assemble/observability';
import {
  extractBearerToken,
  permissionsFor,
  resolveJwtSecret,
  signJwt,
  verifyAuditChain,
  verifyJwt,
} from '@assemble/security';
import Fastify, { type FastifyInstance } from 'fastify';
import { createAuthRepos, type AuthRepos, writeAudit } from './repositories/index.js';

const TOKEN_TTL_SECONDS = 3600; // 短效 Access Token，默认 1h
const TOKEN_ISSUER = 'auth-svc';

interface TokenBody {
  userId: string;
  name: string;
  role: Role;
  scopedLineIds?: string[];
}

export interface BuildAppDeps {
  repos?: AuthRepos;
  /** 覆盖 NODE_ENV（测试注入） */
  nodeEnv?: string;
  /** 覆盖 AUTH_JWT_SECRET（测试注入） */
  jwtSecret?: string;
}

function buildPrincipal(body: TokenBody): AuthPrincipal {
  const now = Date.now();
  return {
    userId: body.userId,
    name: body.name,
    roles: [body.role],
    permissions: permissionsFor(body.role),
    scopedLineIds: body.scopedLineIds,
    tokenType: 'bearer',
    issuedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + TOKEN_TTL_SECONDS * 1000).toISOString(),
  };
}

/** 从 JWT claims 还原 principal（供 /auth/verify 与网关鉴权用） */
function principalFromClaims(claims: Record<string, unknown>): AuthPrincipal | null {
  const sub = claims['sub'];
  const name = claims['name'];
  const roles = claims['roles'];
  const permissions = claims['permissions'];
  if (
    typeof sub !== 'string' ||
    typeof name !== 'string' ||
    !Array.isArray(roles) ||
    !Array.isArray(permissions)
  ) {
    return null;
  }
  const iat = typeof claims['iat'] === 'number' ? claims['iat'] : 0;
  const exp = typeof claims['exp'] === 'number' ? claims['exp'] : 0;
  const scopedLineIds = Array.isArray(claims['scopedLineIds'])
    ? (claims['scopedLineIds'] as string[])
    : undefined;
  return {
    userId: sub,
    name,
    roles: roles as Role[],
    permissions: permissions as PermissionAction[],
    ...(scopedLineIds ? { scopedLineIds } : {}),
    tokenType: 'bearer',
    issuedAt: new Date(iat * 1000).toISOString(),
    expiresAt: new Date(exp * 1000).toISOString(),
  };
}

export function buildApp(deps: BuildAppDeps = {}): FastifyInstance {
  const app = Fastify({ logger: true, requestIdHeader: REQUEST_ID_HEADER });
  const repos = deps.repos ?? createAuthRepos();
  const { secret: jwtSecret, usingDev } = resolveJwtSecret({
    nodeEnv: deps.nodeEnv ?? process.env['NODE_ENV'],
    explicit: deps.jwtSecret ?? process.env['AUTH_JWT_SECRET'],
  });
  if (usingDev) {
    app.log.warn('未配置 AUTH_JWT_SECRET，使用开发默认密钥（仅限本地/测试环境）');
  }
  const registry = new MetricsRegistry();
  const httpMetrics = createHttpMetrics(registry);
  const startedAt = new WeakMap<object, number>();

  app.addHook('onRequest', async (req, reply) => {
    startedAt.set(req, httpMetrics.startRequest());
    reply.header(REQUEST_ID_HEADER, req.id);
  });
  app.addHook('onResponse', async (req, reply) => {
    const t0 = startedAt.get(req) ?? httpMetrics.startRequest();
    httpMetrics.record(t0, req.method, req.routeOptions.url ?? req.url ?? '', reply.statusCode);
  });

  // liveness / readiness 双探针（无外部依赖，readiness 恒就绪，优雅停机时转 not_ready）
  const readinessState = createReadinessState();
  registerHealthRoutes(app, { service: 'auth-svc' }, readinessState);
  app.decorate('readinessState', readinessState);

  app.get('/metrics', async (_req, reply) => {
    reply.header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    return renderPrometheusText(registry);
  });

  app.get('/auth/roles', async () =>
    ok(['super_admin', 'production_engineer', 'simulation_engineer', 'trainer', 'manager', 'viewer']),
  );

  app.get<{ Params: { role: Role } }>('/auth/roles/:role/permissions', async (req, reply) => {
    const role = req.params.role as Role;
    if (!permissionsFor(role)) {
      return reply.status(404).send(err('NOT_FOUND', `角色 ${role} 不存在`));
    }
    return ok(permissionsFor(role));
  });

  // 换取 Access Token：真实 HS256 签发（真实接入 OIDC 后此处做授权码/token 校验）
  app.post<{ Body: TokenBody }>('/auth/token', async (req, reply) => {
    const body = req.body;
    if (!body?.userId || !body?.name || !body?.role) {
      return reply.status(400).send(err('VALIDATION_FAILED', '缺少 userId/name/role'));
    }
    const principal = buildPrincipal(body);
    const accessToken = signJwt(
      {
        sub: body.userId,
        name: body.name,
        roles: [body.role],
        permissions: permissionsFor(body.role),
        ...(body.scopedLineIds ? { scopedLineIds: body.scopedLineIds } : {}),
      },
      jwtSecret,
      { ttlSeconds: TOKEN_TTL_SECONDS, issuer: TOKEN_ISSUER },
    );
    await writeAudit(repos.audit, {
      actorId: body.userId,
      action: 'token.issue',
      resource: 'auth',
      detail: JSON.stringify({ role: body.role }),
      ip: req.ip,
    });
    return ok({
      accessToken,
      tokenType: 'bearer' as const,
      expiresIn: TOKEN_TTL_SECONDS,
      principal,
    });
  });

  // 校验 token 并还原 principal（供网关/外部服务便捷校验）
  app.post<{ Body: { token?: string } }>('/auth/verify', async (req, reply) => {
    const token = extractBearerToken(req.headers.authorization) ?? req.body?.token;
    if (!token) {
      return reply.status(400).send(err('VALIDATION_FAILED', '缺少 token'));
    }
    let claims: Record<string, unknown>;
    try {
      claims = verifyJwt(token, jwtSecret, { issuer: TOKEN_ISSUER });
    } catch {
      return reply.status(401).send(err('UNAUTHORIZED', 'token 无效或已过期'));
    }
    const principal = principalFromClaims(claims);
    if (!principal) {
      return reply.status(400).send(err('VALIDATION_FAILED', 'token 载荷不完整'));
    }
    await writeAudit(repos.audit, {
      actorId: principal.userId,
      action: 'token.verify',
      resource: 'auth',
      detail: JSON.stringify({ roles: principal.roles }),
      ip: req.ip,
    });
    return ok({ principal });
  });

  // 便捷校验：某权限是否在某角色的允许集内（供网关 RBAC 调用；网关亦可本地断言）
  app.post<{ Body: { role: Role; permission: PermissionAction } }>(
    '/auth/authorize',
    async (req, reply) => {
      const b = req.body;
      if (!b?.role || !b?.permission) {
        return reply.status(400).send(err('VALIDATION_FAILED', '缺少 role/permission'));
      }
      const allowed = permissionsFor(b.role).includes(b.permission);
      await writeAudit(repos.audit, {
        actorId: 'system',
        action: 'authorize',
        resource: 'auth',
        detail: JSON.stringify({ role: b.role, permission: b.permission, allowed }),
        ip: req.ip,
      });
      return ok({ allowed });
    },
  );

  // 审计列表：支持按 actorId/action 过滤，并附带全链校验结果
  app.get<{ Querystring: { actorId?: string; action?: string } }>('/audit', async (req, reply) => {
    const all = await repos.audit.list();
    const chainValid = verifyAuditChain(all);
    let entries = all;
    if (req.query.actorId) entries = entries.filter((e) => e.actorId === req.query.actorId);
    if (req.query.action) entries = entries.filter((e) => e.action === req.query.action);
    return ok({ entries, count: entries.length, total: all.length, chainValid });
  });

  app.post<{ Params: { id: string } }>('/audit/:id/check', async (req, reply) => {
    const list = await repos.audit.list();
    const found = list.find((e) => e.id === req.params.id);
    if (!found) return reply.status(404).send(err('NOT_FOUND', '审计记录不存在'));
    return ok(found);
  });

  return app;
}
