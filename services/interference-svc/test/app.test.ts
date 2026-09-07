import { describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';

function fetchForAssembly(): typeof fetch {
  return async (input) => {
    const url = String(input);
    if (url.endsWith('/lines/line-a')) {
      return new Response(JSON.stringify({
        ok: true,
        data: { id: 'line-a' },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.endsWith('/lines/line-a/bom')) {
      return new Response(JSON.stringify({
        ok: true,
        data: {
          lineId: 'line-a',
          parts: [
            {
              id: 'part-1',
              assetId: 'conveyor',
              localPosition: [0, 0, 0],
              localRotation: { x: 0, y: 0, z: 0, w: 1 },
            },
            {
              id: 'part-2',
              assetId: 'conveyor',
              localPosition: [0.5, 0, 0],
              localRotation: { x: 0, y: 0, z: 0, w: 1 },
            },
            {
              id: 'part-3',
              assetId: 'box-pack',
              localPosition: [50, 0, 0],
              localRotation: { x: 0, y: 0, z: 0, w: 1 },
            },
          ],
        },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.endsWith('/healthz')) {
      return new Response(JSON.stringify({ status: 'ok' }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify({ ok: false, code: 'NOT_FOUND', message: '未找到' }), { status: 404 });
  };
}

describe('POST /interference/offline', () => {
  it('按 lineId 读取真实 BOM，用实测包络检出命中且命中零件对可回溯', async () => {
    const app = buildApp({ assemblyBaseUrl: 'http://assembly.test', fetchImpl: fetchForAssembly() });
    const response = await app.inject({
      method: 'POST',
      url: '/interference/offline',
      payload: { lineId: 'line-a' },
    });
    const body = response.json<{
      data: {
        lineId: string;
        totalPartCount: number;
        hitCount: number;
        hits: Array<{ firstPartId: string; secondPartId: string }>;
      };
    }>();

    expect(response.statusCode).toBe(200);
    expect(body.data.lineId).toBe('line-a');
    expect(body.data.totalPartCount).toBe(3);
    expect(body.data.hitCount).toBe(1);
    expect(body.data.hits[0]?.firstPartId).toBe('part-1');
    expect(body.data.hits[0]?.secondPartId).toBe('part-2');
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

describe('HA：readiness 依赖探针', () => {
  it('assembly-svc 不可达时 /readyz 返回 503 not_ready', async () => {
    const app = buildApp({
      fetchImpl: async () => { throw new Error('connection refused'); },
    });
    const res = await app.inject({ method: 'GET', url: '/readyz' });

    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ status: 'not_ready', service: 'interference-svc', ready: false, depsReady: false });
    await app.close();
  });

  it('assembly-svc 可达时 /readyz 返回 200 ready', async () => {
    const app = buildApp({ assemblyBaseUrl: 'http://assembly.test', fetchImpl: fetchForAssembly() });
    const res = await app.inject({ method: 'GET', url: '/readyz' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ready', ready: true, depsReady: true });
    await app.close();
  });
});
