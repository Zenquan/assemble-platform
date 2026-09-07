import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

import { MODEL_ASSET_IDS, type ModelAssetVersion } from '@assemble/domain';
import { createMemoryRepo } from '@assemble/storage';

import { buildApp } from '../src/app.js';

function app(deps?: Parameters<typeof buildApp>[0]) {
  return buildApp(deps ?? { repos: { assets: createMemoryRepo<ModelAssetVersion>() } });
}

const GLB_MAGIC = Buffer.from('glTF');
function fakeGlb(payload: string): Buffer {
  return Buffer.concat([GLB_MAGIC, Buffer.from(payload)]);
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

  it('拒绝未注册的自定义资产（custom- 前缀但未上传）', async () => {
    const instance = app();
    const response = await instance.inject({ method: 'GET', url: '/model/glb/custom-press.glb' });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ ok: false, code: 'NOT_FOUND' });

    await instance.close();
  });
});

describe('PUT /model/glb/:assetId（自定义资产上传）', () => {
  async function tempGlbDir(): Promise<string> {
    return mkdtemp(path.join(tmpdir(), 'model-svc-upload-'));
  }

  it('上传合法 GLB → 201，落盘并注册版本，可随即下载', async () => {
    const glbDir = await tempGlbDir();
    const repos = { assets: createMemoryRepo<ModelAssetVersion>() };
    const instance = app({ repos, glbDir });
    const bytes = fakeGlb('custom-press-binary');

    const upload = await instance.inject({
      method: 'PUT',
      url: '/model/glb/custom-press',
      headers: { 'content-type': 'application/octet-stream' },
      payload: bytes,
    });

    expect(upload.statusCode).toBe(201);
    const body = upload.json();
    expect(body).toMatchObject({
      ok: true,
      data: { downloadUrl: '/model/glb/custom-press.glb' },
    });
    expect(body.data.asset).toMatchObject({
      assetId: 'custom-press',
      compression: 'none',
      sourceSizeBytes: bytes.length,
      sizeBytes: bytes.length,
    });

    const saved = await repos.assets.list();
    expect(saved).toHaveLength(1);
    expect(saved[0]?.assetId).toBe('custom-press');

    const onDisk = await readFile(path.join(glbDir, 'custom', 'custom-press.glb'));
    expect(onDisk).toEqual(bytes);

    const download = await instance.inject({ method: 'GET', url: '/model/glb/custom-press.glb' });
    expect(download.statusCode).toBe(200);
    expect(Buffer.from(download.rawPayload)).toEqual(bytes);

    await instance.close();
    await rm(glbDir, { recursive: true, force: true });
  });

  it('拒绝覆盖内置资产（409 CONFLICT）', async () => {
    const instance = app({ glbDir: await tempGlbDir() });

    const response = await instance.inject({
      method: 'PUT',
      url: '/model/glb/conveyor',
      headers: { 'content-type': 'application/octet-stream' },
      payload: fakeGlb('hijack'),
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ ok: false, code: 'CONFLICT' });

    await instance.close();
  });

  it('拒绝非法 assetId 形式（400 VALIDATION_FAILED）', async () => {
    const instance = app({ glbDir: await tempGlbDir() });

    for (const assetId of ['press', 'Custom-press', 'custom-', 'custom-..%2fx']) {
      const response = await instance.inject({
        method: 'PUT',
        url: `/model/glb/${assetId}`,
        headers: { 'content-type': 'application/octet-stream' },
        payload: fakeGlb('x'),
      });
      expect(response.statusCode, assetId).toBe(400);
      expect(response.json()).toMatchObject({ ok: false, code: 'VALIDATION_FAILED' });
    }

    await instance.close();
  });

  it('拒绝缺少 glTF magic 头的内容（400）', async () => {
    const instance = app({ glbDir: await tempGlbDir() });

    const response = await instance.inject({
      method: 'PUT',
      url: '/model/glb/custom-press',
      headers: { 'content-type': 'application/octet-stream' },
      payload: Buffer.from('not-a-glb-file'),
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ ok: false, code: 'VALIDATION_FAILED' });

    await instance.close();
  });

  it('超过大小上限时返回统一信封 413', async () => {
    const instance = app({ glbDir: await tempGlbDir(), maxUploadBytes: 16 });

    const response = await instance.inject({
      method: 'PUT',
      url: '/model/glb/custom-press',
      headers: { 'content-type': 'application/octet-stream' },
      payload: fakeGlb('0123456789012345678901234567890123456789'),
    });

    expect(response.statusCode).toBe(413);
    expect(response.json()).toMatchObject({ ok: false, code: 'PAYLOAD_TOO_LARGE' });

    await instance.close();
  });

  it('重复上传同 id 覆盖文件并新增版本记录（幂等 upsert）', async () => {
    const glbDir = await tempGlbDir();
    const repos = { assets: createMemoryRepo<ModelAssetVersion>() };
    const instance = app({ repos, glbDir });
    const headers = { 'content-type': 'application/octet-stream' };

    await instance.inject({ method: 'PUT', url: '/model/glb/custom-press', headers, payload: fakeGlb('v1') });
    const second = await instance.inject({ method: 'PUT', url: '/model/glb/custom-press', headers, payload: fakeGlb('v2-longer') });

    expect(second.statusCode).toBe(201);
    const saved = await repos.assets.list();
    expect(saved).toHaveLength(2);
    const onDisk = await readFile(path.join(glbDir, 'custom', 'custom-press.glb'));
    expect(onDisk).toEqual(fakeGlb('v2-longer'));

    await instance.close();
    await rm(glbDir, { recursive: true, force: true });
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
