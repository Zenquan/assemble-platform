import { describe, expect, it } from 'vitest';

import type { TaktConfig, TaktObservation } from '@assemble/domain';
import { createMemoryRepo } from '@assemble/storage';
import { buildApp } from '../src/app.js';
import type { TaktRepos } from '../src/repositories/index.js';

function makeRepos(): TaktRepos {
  const configs = createMemoryRepo<TaktConfig>();
  const observations = createMemoryRepo<TaktObservation>();
  return { configs, observations, ready: Promise.resolve() };
}

function fetchForAssembly(calls: string[]): typeof fetch {
  return async (input) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith('/lines/line-a')) {
      return new Response(JSON.stringify({
        ok: true,
        data: {
          id: 'line-a',
          stations: [
            { id: 'station-a', taktSeconds: 4 },
            { id: 'station-b', taktSeconds: 6.8 },
          ],
        },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify({ ok: false, code: 'NOT_FOUND', message: '未找到' }), { status: 404 });
  };
}

describe('POST /takt/simulate', () => {
  it('只按 lineId 从 assembly-svc 读取工位并由服务端计算目标产能', async () => {
    const calls: string[] = [];
    const app = buildApp({
      assemblyBaseUrl: 'http://assembly.test',
      fetchImpl: fetchForAssembly(calls),
    });

    const response = await app.inject({
      method: 'POST',
      url: '/takt/simulate',
      payload: { lineId: 'line-a' },
    });
    const body = response.json<{
      data: {
        lineId: string;
        targetUnitsPerHour: number;
        availability: number;
        cycleTimeSeconds: number;
        theoreticalThroughputPerHour: number;
      };
    }>();

    expect(response.statusCode).toBe(200);
    expect(calls).toEqual(['http://assembly.test/lines/line-a']);
    expect(body.data).toMatchObject({
      lineId: 'line-a',
      targetUnitsPerHour: 529,
      availability: 1,
      cycleTimeSeconds: 6.8,
      theoreticalThroughputPerHour: 529.4117647058823,
      configSource: 'derived',
    });
    await app.close();
  });

  it('从后端配置和 MES 观测返回目标、实际产量与实际平均节拍', async () => {
    const repos = makeRepos();
    await repos.configs.upsert({
      id: 'config-line-a',
      lineId: 'line-a',
      targetUnitsPerHour: 500,
      availability: 0.92,
      source: 'configuration',
      updatedAt: '2026-09-04T08:00:00.000Z',
    });
    await repos.observations.upsert({
      id: 'observation-line-a',
      lineId: 'line-a',
      windowSeconds: 1800,
      completedUnits: 210,
      actualTaktSeconds: 8.5,
      source: 'mes',
      observedAt: '2026-09-04T08:30:00.000Z',
    });
    const app = buildApp({
      assemblyBaseUrl: 'http://assembly.test',
      fetchImpl: fetchForAssembly([]),
      repos,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/takt/simulate',
      payload: { lineId: 'line-a', availability: 0.1, targetUnitsPerHour: 1 },
    });
    const body = response.json<{
      data: {
        targetUnitsPerHour: number;
        availability: number;
        configSource: string;
        actual: {
          completedUnits: number;
          actualTaktSeconds: number;
          actualThroughputPerHour: number;
          source: string;
        };
      };
    }>();

    expect(response.statusCode).toBe(200);
    expect(body.data).toMatchObject({
      targetUnitsPerHour: 500,
      availability: 0.92,
      configSource: 'configuration',
      actual: {
        completedUnits: 210,
        actualTaktSeconds: 8.5,
        actualThroughputPerHour: 420,
        source: 'mes',
      },
    });
    await app.close();
  });

  it('使用请求中的开动率并返回服务端实际采用值', async () => {
    const app = buildApp({
      assemblyBaseUrl: 'http://assembly.test',
      fetchImpl: fetchForAssembly([]),
    });

    const response = await app.inject({
      method: 'POST',
      url: '/takt/simulate',
      payload: { lineId: 'line-a', availability: 0.8 },
    });
    const body = response.json<{ data: { availability: number; meetsTarget: boolean } }>();

    expect(response.statusCode).toBe(200);
    expect(body.data).toMatchObject({ availability: 0.8, meetsTarget: false });
    await app.close();
  });

  it('缺少 lineId 时拒绝请求', async () => {
    const app = buildApp({ fetchImpl: fetchForAssembly([]) });
    const response = await app.inject({ method: 'POST', url: '/takt/simulate', payload: {} });

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
      url: '/takt/simulate',
      payload: { lineId: 'line-a' },
    });

    expect(response.statusCode).toBe(502);
    expect(response.json()).toMatchObject({ ok: false, code: 'DEPENDENCY_UNAVAILABLE' });
    await app.close();
  });
});
