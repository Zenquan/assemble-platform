import { describe, expect, it } from 'vitest';

import { signJwt } from '@assemble/security';

import { authorizeRequest, requiredPermission, TOKEN_ISSUER } from '../src/auth.js';

const SECRET = 'test-jwt-secret-32-bytes-0000000000';

function token(roles: string[]): string {
  return signJwt({ sub: 'u1', name: 'T', roles }, SECRET, { issuer: TOKEN_ISSUER });
}

describe('requiredPermission · 路径→权限映射', () => {
  it('读/写按 HTTP 方法区分', () => {
    expect(requiredPermission('/lines', 'GET')).toBe('line:read');
    expect(requiredPermission('/lines/l1/bom', 'GET')).toBe('line:read');
    expect(requiredPermission('/lines', 'POST')).toBe('line:write');
    expect(requiredPermission('/model', 'GET')).toBe('model:read');
    expect(requiredPermission('/model/glb/x.glb', 'PUT')).toBe('model:upload');
    expect(requiredPermission('/takt', 'GET')).toBe('takt:view');
    expect(requiredPermission('/takt', 'POST')).toBe('takt:write');
  });

  it('interference 离线与运行区分', () => {
    expect(requiredPermission('/interference', 'POST')).toBe('interference:run');
    expect(requiredPermission('/interference/offline', 'POST')).toBe('interference:offline');
    expect(requiredPermission('/interference/offline/batch', 'POST')).toBe('interference:offline');
  });

  it('/audit 需 audit:view；/auth 与静态/网关路径免鉴权', () => {
    expect(requiredPermission('/audit', 'GET')).toBe('audit:view');
    expect(requiredPermission('/auth/token', 'POST')).toBeUndefined();
    expect(requiredPermission('/healthz', 'GET')).toBeUndefined();
    expect(requiredPermission('/assets/index.js', 'GET')).toBeUndefined();
    expect(requiredPermission('/', 'GET')).toBeUndefined();
  });
});

describe('authorizeRequest · 验签 + 权限断言', () => {
  it('免鉴权路径直接放行', () => {
    expect(authorizeRequest({ pathname: '/auth/token', method: 'POST', jwtSecret: SECRET })).toEqual({
      ok: true,
      roles: [],
    });
  });

  it('缺 token → 401', () => {
    const r = authorizeRequest({ pathname: '/lines', method: 'GET', jwtSecret: SECRET });
    expect(r).toMatchObject({ ok: false, status: 401, code: 'UNAUTHORIZED' });
  });

  it('非法/篡改 token → 401', () => {
    const r = authorizeRequest({
      pathname: '/lines',
      method: 'GET',
      authorization: 'Bearer not-a-jwt',
      jwtSecret: SECRET,
    });
    expect(r).toMatchObject({ ok: false, status: 401 });

    const tampered = token(['viewer']).slice(0, -4) + 'AAAA';
    const r2 = authorizeRequest({
      pathname: '/lines',
      method: 'GET',
      authorization: `Bearer ${tampered}`,
      jwtSecret: SECRET,
    });
    expect(r2).toMatchObject({ ok: false, status: 401 });
  });

  it('权限充足放行并返回 roles', () => {
    const r = authorizeRequest({
      pathname: '/lines',
      method: 'GET',
      authorization: `Bearer ${token(['viewer'])}`,
      jwtSecret: SECRET,
    });
    expect(r).toEqual({ ok: true, roles: ['viewer'] });
  });

  it('权限不足 → 403', () => {
    const r = authorizeRequest({
      pathname: '/lines',
      method: 'POST',
      authorization: `Bearer ${token(['viewer'])}`,
      jwtSecret: SECRET,
    });
    expect(r).toMatchObject({ ok: false, status: 403, code: 'FORBIDDEN' });
  });

  it('super_admin 可写 / 跨前缀权限断言', () => {
    const r = authorizeRequest({
      pathname: '/lines',
      method: 'POST',
      authorization: `Bearer ${token(['super_admin'])}`,
      jwtSecret: SECRET,
    });
    expect(r).toMatchObject({ ok: true });
  });
});
