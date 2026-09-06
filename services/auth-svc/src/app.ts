import type { AuthPrincipal, PermissionAction, Role } from '@assemble/domain';
import { err, ok } from '@assemble/http';
import {
  createHttpMetrics,
  MetricsRegistry,
  REQUEST_ID_HEADER,
  renderPrometheusText,
} from '@assemble/observability';
import Fastify, { type FastifyInstance } from 'fastify';
import { permissionsFor } from './rbac.js';
import { createAuthRepos, type AuthRepos, writeAudit } from './repositories/index.js';

interface TokenBody {
  userId: string;
  name: string;
  role: Role;
  scopedLineIds?: string[];
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
    expiresAt: new Date(now + 3600_000).toISOString(),
  };
}

export function buildApp(deps?: { repos?: AuthRepos }): FastifyInstance {
  const app = Fastify({ logger: true, requestIdHeader: REQUEST_ID_HEADER });
  const repos = deps?.repos ?? createAuthRepos();
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

  app.get('/healthz', async () => ({
    status: 'ok',
    service: 'auth-svc',
    time: new Date().toISOString(),
  }));

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

  // 演示：换取一个 principal（真实接入 OIDC 后此处做授权码/token 校验）
  app.post<{ Body: TokenBody }>('/auth/token', async (req, reply) => {
    const body = req.body;
    if (!body?.userId || !body?.role) {
      return reply.status(400).send(err('VALIDATION_FAILED', '缺少 userId/role'));
    }
    const principal = buildPrincipal(body);
    await writeAudit(repos.audit, {
      actorId: body.userId,
      action: 'token.issue',
      resource: 'auth',
      detail: JSON.stringify({ role: body.role }),
    });
    return ok(principal);
  });

  app.post<{ Params: { id: string } }>('/audit/:id/check', async (req, reply) => {
    const list = await repos.audit.list();
    const found = list.find((e) => e.id === req.params.id);
    if (!found) return reply.status(404).send(err('NOT_FOUND', '审计记录不存在'));
    return ok(found);
  });

  // 便捷校验：某权限是否在某角色的允许集内（供网关 RBAC 调用）
  app.post<{ Body: { role: Role; permission: PermissionAction } }>(
    '/auth/authorize',
    async (req, reply) => {
      const b = req.body;
      if (!b?.role || !b?.permission) {
        return reply.status(400).send(err('VALIDATION_FAILED', '缺少 role/permission'));
      }
      const allowed = permissionsFor(b.role).includes(b.permission);
      return ok({ allowed });
    },
  );

  return app;
}
