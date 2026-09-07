import { describe, expect, it } from 'vitest';

import type { AuditLogEntry } from '@assemble/domain';
import { signJwt, verifyJwt } from '@assemble/security';
import { createMemoryRepo } from '@assemble/storage';

import { buildApp } from '../src/app.js';

const JWT_SECRET = 'test-jwt-secret-32-bytes-0000000000';

async function appWith() {
  const audit = createMemoryRepo<AuditLogEntry>();
  return buildApp({ repos: { audit }, jwtSecret: JWT_SECRET, nodeEnv: 'development' });
}

describe('auth-svc：真实 JWT 签发 + 审计加固', () => {
  it('POST /auth/token 返回真实可验签的 JWT，principal 权限来自 RBAC 矩阵', async () => {
    const app = await appWith();
    const res = await app.inject({
      method: 'POST',
      url: '/auth/token',
      payload: { userId: 'u1', name: '张三', role: 'viewer' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{
      ok: true;
      data: {
        accessToken: string;
        tokenType: string;
        expiresIn: number;
        principal: { userId: string; roles: string[]; permissions: string[] };
      };
    }>();
    expect(body.ok).toBe(true);
    expect(body.data.tokenType).toBe('bearer');
    expect(body.data.expiresIn).toBe(3600);
    expect(body.data.principal.userId).toBe('u1');
    expect(body.data.principal.roles).toEqual(['viewer']);
    expect(body.data.principal.permissions).toEqual(['line:read']);

    // 真实验签：能还原 claims
    const claims = verifyJwt(body.data.accessToken, JWT_SECRET, { issuer: 'auth-svc' });
    expect(claims['sub']).toBe('u1');
    expect(claims['roles']).toEqual(['viewer']);
    await app.close();
  });

  it('POST /auth/verify 从 Authorization 头校验并还原 principal', async () => {
    const app = await appWith();
    const token = signJwt(
      { sub: 'u2', name: '李四', roles: ['super_admin'], permissions: ['user:manage', 'audit:view'] },
      JWT_SECRET,
      { issuer: 'auth-svc' },
    );

    const res = await app.inject({
      method: 'POST',
      url: '/auth/verify',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ ok: true; data: { principal: { userId: string; roles: string[] } } }>();
    expect(body.data.principal.userId).toBe('u2');
    expect(body.data.principal.roles).toEqual(['super_admin']);
    await app.close();
  });

  it('缺少字段 → 400；无效 token → 401', async () => {
    const app = await appWith();
    const missing = await app.inject({
      method: 'POST',
      url: '/auth/token',
      payload: { userId: 'u1' },
    });
    expect(missing.statusCode).toBe(400);
    expect(missing.json()).toMatchObject({ ok: false, code: 'VALIDATION_FAILED' });

    const bad = await app.inject({ method: 'POST', url: '/auth/verify', payload: { token: 'not-a-jwt' } });
    expect(bad.statusCode).toBe(401);
    expect(bad.json()).toMatchObject({ ok: false, code: 'UNAUTHORIZED' });
    await app.close();
  });

  it('签发后审计链完整可校验；/audit 支持 actorId 过滤', async () => {
    const app = await appWith();
    await app.inject({ method: 'POST', url: '/auth/token', payload: { userId: 'u1', name: 'A', role: 'viewer' } });
    await app.inject({ method: 'POST', url: '/auth/token', payload: { userId: 'u2', name: 'B', role: 'manager' } });

    const res = await app.inject({ method: 'GET', url: '/audit' });
    expect(res.statusCode).toBe(200);
    const body = res.json<{
      ok: true;
      data: { total: number; count: number; chainValid: boolean; entries: AuditLogEntry[] };
    }>();
    expect(body.data.total).toBe(2);
    expect(body.data.chainValid).toBe(true);
    expect(body.data.entries[0]?.prevHash).toBe('GENESIS');
    expect(body.data.entries[0]?.hash).toBeDefined();
    expect(body.data.entries[1]?.prevHash).toBe(body.data.entries[0]?.hash);

    const filtered = await app.inject({ method: 'GET', url: '/audit?actorId=u1' });
    expect(filtered.json<{ ok: true; data: { count: number } }>().data.count).toBe(1);
    await app.close();
  });

  it('POST /auth/authorize 返回权限断言', async () => {
    const app = await appWith();
    const allowed = await app.inject({
      method: 'POST',
      url: '/auth/authorize',
      payload: { role: 'viewer', permission: 'line:read' },
    });
    expect(allowed.json<{ ok: true; data: { allowed: boolean } }>().data.allowed).toBe(true);

    const denied = await app.inject({
      method: 'POST',
      url: '/auth/authorize',
      payload: { role: 'viewer', permission: 'line:write' },
    });
    expect(denied.json<{ ok: true; data: { allowed: boolean } }>().data.allowed).toBe(false);
    await app.close();
  });
});
