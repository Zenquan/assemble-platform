import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  getAuthToken,
  http,
  restoreAuthToken,
  setAuthToken,
  setUnauthorizedHandler,
} from './http';

function mockFetch(status: number, body: unknown): ReturnType<typeof vi.fn> {
  const fn = vi.fn(async (_url: string, _init?: RequestInit) => {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
  setAuthToken(undefined);
  setUnauthorizedHandler(null);
});

function mockStorage(initial: Record<string, string> = {}): Map<string, string> {
  const store = new Map(Object.entries(initial));
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
  return store;
}

describe('http 凭证注入与 401 处理', () => {
  it('setAuthToken 后自动附带 Authorization: Bearer', async () => {
    setAuthToken('tok-123');
    const fn = mockFetch(200, { ok: true, data: { hello: 'world' } });

    await http.get<{ hello: string }>('/lines');
    const init = fn.mock.calls[0]?.[1] as RequestInit | undefined;
    expect((init?.headers as Record<string, string>)['Authorization']).toBe('Bearer tok-123');
  });

  it('未设置令牌时不带 Authorization 头', async () => {
    const fn = mockFetch(200, { ok: true, data: null });
    await http.get('/lines');
    const init = fn.mock.calls[0]?.[1] as RequestInit | undefined;
    expect((init?.headers as Record<string, string>)['Authorization']).toBeUndefined();
  });

  it('401 清除本地令牌并抛统一 UNAUTHORIZED', async () => {
    setAuthToken('tok-123');
    mockFetch(401, { ok: false, code: 'UNAUTHORIZED', message: 'token 无效' });

    await expect(http.get('/lines')).rejects.toMatchObject({ code: 'UNAUTHORIZED', status: 401 });
    expect(getAuthToken()).toBeUndefined();
  });

  it('非 401 失败不清除令牌', async () => {
    setAuthToken('tok-123');
    mockFetch(403, { ok: false, code: 'FORBIDDEN', message: '缺少权限' });

    await expect(http.post('/lines', {})).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
    expect(getAuthToken()).toBe('tok-123');
  });
});

describe('令牌持久化与 401 统一回调', () => {
  it('setAuthToken 写入 localStorage；传 undefined 清除', () => {
    const store = mockStorage();
    setAuthToken('tok-write');
    expect(store.get('sim.auth.token')).toBe('tok-write');

    setAuthToken(undefined);
    expect(store.has('sim.auth.token')).toBe(false);
  });

  it('restoreAuthToken 从 localStorage 恢复令牌', () => {
    mockStorage({ 'sim.auth.token': 'tok-persist' });
    expect(restoreAuthToken()).toBe('tok-persist');
    expect(getAuthToken()).toBe('tok-persist');
  });

  it('401 触发注册的未授权回调（供路由层跳登录）', async () => {
    setAuthToken('tok-123');
    mockFetch(401, { ok: false, code: 'UNAUTHORIZED', message: 'token 无效' });
    const cb = vi.fn();
    setUnauthorizedHandler(cb);

    await expect(http.get('/lines')).rejects.toMatchObject({ code: 'UNAUTHORIZED', status: 401 });
    expect(cb).toHaveBeenCalledTimes(1);
    expect(getAuthToken()).toBeUndefined();
  });
});
