import {
  MODEL_ASSET_IDS,
  type CompressionStrategy,
  type ModelAssetVersion,
} from '@assemble/domain';
import { err, ok } from '@assemble/http';
import { createReadinessState, registerHealthRoutes } from '@assemble/health';
import {
  createHttpMetrics,
  MetricsRegistry,
  REQUEST_ID_HEADER,
  renderPrometheusText,
} from '@assemble/observability';
import Fastify, { type FastifyInstance } from 'fastify';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createModelRepos, type ModelRepos } from './repositories/index.js';

const CDN_BASE = process.env['ASSEMBLE_CDN_BASE'] ?? 'https://cdn.assemble.example/gltf';

/** 设备 glb 资产目录（后端单一事实源；前端经 /model/assets/:id/glb 下载，不落 public） */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GLB_DIR = process.env['ASSEMBLE_GLB_DIR'] ?? path.resolve(__dirname, '../assets/glb');

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

export function buildApp(deps?: {
  repos?: ModelRepos;
  /** OSS 回源基址：配置后 /model/glb/:file 从对象存储拉取并回源（云端部署）；缺省读本地文件 */
  glbOssBaseUrl?: string;
  fetchImpl?: typeof fetch;
}): FastifyInstance {
  const app = Fastify({ logger: true, requestIdHeader: REQUEST_ID_HEADER });
  const repos = deps?.repos ?? createModelRepos();
  const fetchImpl = deps?.fetchImpl ?? fetch;
  const registry = new MetricsRegistry();
  const httpMetrics = createHttpMetrics(registry);
  const startedAt = new WeakMap<object, number>();

  app.addHook('onRequest', async (req, reply) => {
    startedAt.set(req, httpMetrics.startRequest());
    reply.header(REQUEST_ID_HEADER, req.id);
  });
  app.addHook('onResponse', async (req, reply) => {
    const t0 = startedAt.get(req) ?? httpMetrics.startRequest();
    httpMetrics.record(t0, req.method, req.routeOptions.url ?? req.url ?? '', reply.statusCode);
  });
  // 云端部署：设备 GLB 存放于对象存储（CloudBase 云存储桶 / COS），服务端拉取后同源回给
  // 前端（免浏览器跨域）。未配置时保持本地文件路径（本地开发行为不变）。
  const glbOssBase = deps?.glbOssBaseUrl ?? process.env['ASSEMBLE_GLB_BASE_URL']?.replace(/\/+$/, '');

  // liveness / readiness 双探针（无外部依赖，readiness 恒就绪，优雅停机时转 not_ready）
  const readinessState = createReadinessState();
  registerHealthRoutes(app, { service: 'model-svc' }, readinessState);
  app.decorate('readinessState', readinessState);

  app.get('/metrics', async (_req, reply) => {
    reply.header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    return renderPrometheusText(registry);
  });

  app.get('/model/assets', async () => ok(await repos.assets.list()));

  app.get<{ Params: { assetId: string } }>('/model/assets/:assetId', async (req, reply) => {
    const list = await repos.assets.list();
    const asset = list.find((a) => a.assetId === req.params.assetId);
    if (!asset) {
      return reply.status(404).send(err('NOT_FOUND', `资产 ${req.params.assetId} 不存在`));
    }
    return ok({ ...asset, downloadUrl: `/model/glb/${asset.assetId}.glb` });
  });

  // 设备 glb 二进制直下：前端布景层从后端取真实设备模型，而非 public 静态副本。
  // 独立前缀 /model/glb/:file（file 形如 `conveyor.glb`）避开与 /model/assets/:assetId 的
  // 路径参数冲突；保留 `.glb` 后缀使 Babylon SceneLoader 能据 URL 扩展名识别 glTF 加载器。
  // 返回 application/octet-stream + 附件名。
  app.get<{ Params: { file: string } }>('/model/glb/:file', async (req, reply) => {
    const file = req.params.file;
    // 仅接受 `*.glb`，解析出资产 id 做白名单校验，防路径穿越
    if (!file.endsWith('.glb')) {
      return reply.status(404).send(err('NOT_FOUND', `仅支持 .glb 资产下载`));
    }
    const assetId = file.slice(0, -'.glb'.length);
    if (!(MODEL_ASSET_IDS as readonly string[]).includes(assetId)) {
      return reply.status(404).send(err('NOT_FOUND', `设备资产 ${assetId} 不存在`));
    }
    const headers = (buf: Buffer) => {
      reply
        .header('Content-Type', 'application/octet-stream')
        .header('Content-Length', String(buf.length))
        .header('Content-Disposition', `attachment; filename="${file}"`)
        .header('Cache-Control', 'public, max-age=3600');
    };

    // OSS 回源：云端部署时从对象存储拉取并回给前端（同源、无跨域）；未配置则读本地文件
    if (glbOssBase) {
      try {
        const ossRes = await fetchImpl(`${glbOssBase}/${file}`);
        if (!ossRes.ok) {
          return reply.status(404).send(err('NOT_FOUND', `设备资产文件 ${file} 在对象存储缺失`));
        }
        const buf = Buffer.from(await ossRes.arrayBuffer());
        headers(buf);
        return reply.send(buf);
      } catch {
        return reply.status(502).send(err('BAD_GATEWAY', `对象存储不可达，无法获取 ${file}`));
      }
    }

    const filePath = path.join(GLB_DIR, file);
    try {
      const buf = await fs.readFile(filePath);
      headers(buf);
      return reply.send(buf);
    } catch {
      return reply.status(404).send(err('NOT_FOUND', `设备资产文件 ${file} 缺失`));
    }
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
