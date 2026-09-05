import { describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';

function fetchForAssembly(): typeof fetch {
  return async (input) => {
    const url = String(input);
    if (url.endsWith('/lines/line-a')) {
      return new Response(JSON.stringify({
        ok: true,
        data: { id: 'line-a', kind: 'fresh-cut' },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.endsWith('/lines/line-a/bom')) {
      return new Response(JSON.stringify({
        ok: true,
        data: {
          lineId: 'line-a',
          parts: [{ id: 'part-1' }, { id: 'part-2' }, { id: 'part-3' }],
        },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify({ ok: false, code: 'NOT_FOUND', message: '未找到' }), { status: 404 });
  };
}

describe('POST /interference/offline', () => {
  it('按 lineId 读取 assembly-svc BOM 并使用真实零件数生成报告', async () => {
    const app = buildApp({ assemblyBaseUrl: 'http://assembly.test', fetchImpl: fetchForAssembly() });
    const response = await app.inject({
      method: 'POST',
      url: '/interference/offline',
      payload: { lineId: 'line-a' },
    });
    const body = response.json<{ data: { lineId: string; totalPartCount: number } }>();

    expect(response.statusCode).toBe(200);
    expect(body.data.lineId).toBe('line-a');
    expect(body.data.totalPartCount).toBe(3);
    await app.close();
  });

  it('缺少 lineId 时拒绝请求', async () => {
    const app = buildApp({ fetchImpl: fetchForAssembly() });
    const response = await app.inject({ method: 'POST', url: '/interference/offline', payload: {} });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ ok: false, code: 'VALIDATION_FAILED' });
    await app.close();
  });

  it('assembly-svc 不可用时返回依赖错误', async () => {
    const app = buildApp({
      fetchImpl: async () => { throw new Error('connection refused'); },
    });
    const response = await app.inject({
      method: 'POST',
      url: '/interference/offline',
      payload: { lineId: 'line-a' },
    });

    expect(response.statusCode).toBe(502);
    expect(response.json()).toMatchObject({ ok: false, code: 'DEPENDENCY_UNAVAILABLE' });
    await app.close();
  });
});
