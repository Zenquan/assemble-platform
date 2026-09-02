import type { ModelAssetVersion, CompressionStrategy } from '@assemble/domain';
import { err, ok } from '@assemble/http';
import Fastify, { type FastifyInstance } from 'fastify';
import { createModelRepos, type ModelRepos } from './repositories/index.js';

const CDN_BASE = process.env['ASSEMBLE_CDN_BASE'] ?? 'https://cdn.assemble.example/gltf';

interface PresignBody {
  assetId: string;
  /** 稳定文件名/版本 */
  version?: string;
}

interface CompressBody {
  sourceAssetId: string;
  /** 源 glTF 路径（本地/对象存储） */
  inputPath: string;
  strategy?: CompressionStrategy;
  precisionCritical?: boolean;
  sourceSizeBytes?: number;
}

export function buildApp(deps?: { repos?: ModelRepos }): FastifyInstance {
  const app = Fastify({ logger: true });
  const repos = deps?.repos ?? createModelRepos();

  app.get('/healthz', async () => ({
    status: 'ok',
    service: 'model-svc',
    time: new Date().toISOString(),
  }));

  app.get('/model/assets', async () => ok(await repos.assets.list()));

  app.get<{ Params: { assetId: string } }>('/model/assets/:assetId', async (req, reply) => {
    const list = await repos.assets.list();
    const asset = list.find((a) => a.assetId === req.params.assetId);
    if (!asset) {
      return reply.status(404).send(err('NOT_FOUND', `资产 ${req.params.assetId} 不存在`));
    }
    return ok(asset);
  });

  // 模型下载 CDN 签名直链：重型 glTF 不走网关代理（架构红线）
  app.post<{ Body: PresignBody }>('/model/assets/presign', async (req, reply) => {
    const assetId = req.body?.assetId;
    if (!assetId) return reply.status(400).send(err('VALIDATION_FAILED', '缺少 assetId'));
    const version = req.body?.version ?? 'v1';
    const url = `${CDN_BASE}/${assetId}/${version}.glb`;
    return ok({ assetId, url, expiresInSeconds: 3600 });
  });

  // 模拟 Draco/Meshopt 压缩任务：录入一条压缩后的资产版本
  app.post<{ Body: CompressBody }>('/model/compress', async (req, reply) => {
    const b = req.body;
    if (!b?.sourceAssetId || !b?.inputPath) {
      return reply.status(400).send(err('VALIDATION_FAILED', '缺少 sourceAssetId/inputPath'));
    }
    const strategy = b.strategy ?? 'draco';
    const precisionCritical = b.precisionCritical ?? false;
    const now = new Date().toISOString();
    const assetId = b.sourceAssetId;
    const contentHash = `sha3-${Math.floor(Math.random() * 1e9).toString(16)}`;
    const sourceSize = b.sourceSizeBytes ?? 12_000_000;
    const asset: ModelAssetVersion = {
      id: contentHash,
      assetId,
      filename: `${assetId}.glb`,
      sourceSizeBytes: sourceSize,
      // 演示压缩率（真实由 Draco/Meshopt 引擎计算）
      sizeBytes: strategy === 'none' ? sourceSize : Math.round(sourceSize * (precisionCritical ? 0.35 : 0.2)),
      compression: strategy,
      lodLevel: 0,
      precisionCritical,
      cdnPath: `${assetId}/${contentHash}.glb`,
      createdAt: now,
    };
    const saved = await repos.assets.upsert(asset);
    return reply.status(201).send(
      ok({
        asset: saved,
        note: '真实压缩由 sim-model-pipe 调用 Draco/Meshopt 完成，此处为版本录入演示',
      }),
    );
  });

  return app;
}
