import { describe, expect, it, vi } from 'vitest';

import { MODEL_ASSET_IDS, type ModelAssetVersion } from '@assemble/domain';
import { createMemoryRepo } from '@assemble/storage';

import { buildApp } from '../src/app.js';

function app(deps?: Parameters<typeof buildApp>[0]) {
  return buildApp(deps ?? { repos: { assets: createMemoryRepo<ModelAssetVersion>() } });
}

describe('GET /model/glb/:file', () => {
  it('返回共享白名单中每个真实 GLB 二进制', async () => {
    const instance = app();
    for (const assetId of MODEL_ASSET_IDS) {
      const response = await instance.inject({
        method: 'GET',
        url: `/model/glb/${assetId}.glb`,
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('application/octet-stream');
      expect(response.rawPayload.subarray(0, 4).toString('ascii')).toBe('glTF');
    }

    await instance.close();
  });

  it('拒绝白名单外资产与非 GLB 文件', async () => {
    const instance = app();
    const unknown = await instance.inject({ method: 'GET', url: '/model/glb/unknown.glb' });
    const wrongExtension = await instance.inject({ method: 'GET', url: '/model/glb/conveyor.obj' });

    expect(unknown.statusCode).toBe(404);
    expect(unknown.json()).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    expect(wrongExtension.statusCode).toBe(404);

    await instance.close();
  });
});

describe('GET /model/glb/:file（OSS 回源）', () => {
  const ossBase = 'https://assets.example/glb';
  const ossBytes = Buffer.from('oss-binary-payload');

  function ossFetch(ok: boolean): typeof fetch {
    return vi.fn(async () =>
      ok
        ? new Response(ossBytes, { status: 200 })
        : new Response(null, { status: 404 }),
    ) as unknown as typeof fetch;
  }

  it('配置 glbOssBaseUrl 后从对象存储拉取并回源（不再读本地文件）', async () => {
    const fetchImpl = ossFetch(true);
    const instance = app({ glbOssBaseUrl: ossBase, fetchImpl });

    const response = await instance.inject({ method: 'GET', url: '/model/glb/conveyor.glb' });

    expect(response.statusCode).toBe(200);
    expect(Buffer.from(response.rawPayload)).toEqual(ossBytes);
    expect(fetchImpl).toHaveBeenCalledWith(`${ossBase}/conveyor.glb`);
    expect(response.headers['content-type']).toContain('application/octet-stream');

    await instance.close();
  });

  it('对象存储缺失该文件时返回 404', async () => {
    const instance = app({ glbOssBaseUrl: ossBase, fetchImpl: ossFetch(false) });

    const response = await instance.inject({ method: 'GET', url: '/model/glb/conveyor.glb' });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ ok: false, code: 'NOT_FOUND' });

    await instance.close();
  });

  it('对象存储不可达时返回 502', async () => {
    const instance = app({
      glbOssBaseUrl: ossBase,
      fetchImpl: vi.fn(async () => {
        throw new Error('network down');
      }) as unknown as typeof fetch,
    });

    const response = await instance.inject({ method: 'GET', url: '/model/glb/conveyor.glb' });

    expect(response.statusCode).toBe(502);
    expect(response.json()).toMatchObject({ ok: false, code: 'BAD_GATEWAY' });

    await instance.close();
  });
});
