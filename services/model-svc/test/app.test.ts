import { describe, expect, it } from 'vitest';

import type { ModelAssetVersion } from '@assemble/domain';
import { createMemoryRepo } from '@assemble/storage';

import { buildApp } from '../src/app.js';

function app() {
  return buildApp({ repos: { assets: createMemoryRepo<ModelAssetVersion>() } });
}

describe('GET /model/glb/:file', () => {
  it('返回共享白名单中的真实 GLB 二进制', async () => {
    const instance = app();
    const response = await instance.inject({ method: 'GET', url: '/model/glb/conveyor.glb' });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('application/octet-stream');
    expect(response.rawPayload.subarray(0, 4).toString('ascii')).toBe('glTF');

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
