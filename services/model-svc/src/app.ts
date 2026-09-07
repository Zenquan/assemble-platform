import {
  type CompressionStrategy,
  CUSTOM_ASSET_PREFIX,
  isBuiltinAssetId,
  isValidModelAssetId,
  isCustomAssetId,
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
import { createHash } from 'node:crypto';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createModelRepos, type ModelRepos } from './repositories/index.js';
import { measureGlb, type GlbMeasureResult } from './gltf/measure.js';

/** 上传 GLB 大小上限（字节）：100MB，覆盖工业设备中精度模型，压缩管线落地后再收紧。 */
export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

const CDN_BASE = process.env['ASSEMBLE_CDN_BASE'] ?? 'https://cdn.assemble.example/gltf';

/** 设备 glb 资产目录（后端单一事实源；前端经 /model/assets/:id/glb 下载，不落 public） */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_GLB_DIR =
  process.env['ASSEMBLE_GLB_DIR'] ?? path.resolve(__dirname, '../assets/glb');

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
  /** GLB 落盘根目录（测试注入临时目录；缺省走 ASSEMBLE_GLB_DIR 或包内 assets/glb） */
  glbDir?: string;
  /** 上传大小上限（字节），默认 MAX_UPLOAD_BYTES；测试注入小值以覆盖 413 路径 */
  maxUploadBytes?: number;
}): FastifyInstance {
  const app = Fastify({
    logger: true,
    requestIdHeader: REQUEST_ID_HEADER,
    bodyLimit: deps?.maxUploadBytes ?? MAX_UPLOAD_BYTES,
  });
  const repos = deps?.repos ?? createModelRepos();
  const fetchImpl = deps?.fetchImpl ?? fetch;
  const glbDir = deps?.glbDir ?? DEFAULT_GLB_DIR;
  const maxUploadBytes = deps?.maxUploadBytes ?? MAX_UPLOAD_BYTES;
  const registry = new MetricsRegistry();
  const httpMetrics = createHttpMetrics(registry);
  const startedAt = new WeakMap<object, number>();

  // 上传端点接收原始 GLB 二进制：显式注册 octet-stream 解析器（Fastify 默认只认 JSON/文本）
  app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer' }, (_req, body, done) => {
    done(null, body);
  });
  // 超限请求体在内容解析阶段即被 Fastify 以 413 中断，转成统一错误信封；其余错误保持默认行为
  app.setErrorHandler((error: FastifyError, _req, reply) => {
    if (error.statusCode === 413) {
      return reply
        .status(413)
        .send(err('PAYLOAD_TOO_LARGE', `GLB 超过上传大小上限 ${maxUploadBytes} 字节`));
    }
    return reply.send(error);
  });

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
  // 白名单 = 内置资产 ∪ 已注册自定义资产（custom- 前缀，落盘 glbDir/custom/）。
  app.get<{ Params: { file: string } }>('/model/glb/:file', async (req, reply) => {
    const file = req.params.file;
    // 仅接受 `*.glb`，解析出资产 id 做白名单校验，防路径穿越
    if (!file.endsWith('.glb')) {
      return reply.status(404).send(err('NOT_FOUND', `仅支持 .glb 资产下载`));
    }
    const assetId = file.slice(0, -'.glb'.length);
    if (!isValidModelAssetId(assetId)) {
      return reply.status(404).send(err('NOT_FOUND', `设备资产 ${assetId} 不存在`));
    }
    const isBuiltin = isBuiltinAssetId(assetId);
    if (!isBuiltin) {
      // 自定义资产必须已注册（上传时写入仓储），未注册一律 404
      const registered = (await repos.assets.list()).some((a) => a.assetId === assetId);
      if (!registered) {
        return reply.status(404).send(err('NOT_FOUND', `自定义资产 ${assetId} 未注册`));
      }
    }
    const headers = (buf: Buffer) => {
      reply
        .header('Content-Type', 'application/octet-stream')
        .header('Content-Length', String(buf.length))
        .header('Content-Disposition', `attachment; filename="${file}"`)
        .header('Cache-Control', 'public, max-age=3600');
    };

    // 自定义资产始终读本地 custom/ 目录（不经对象存储回源；云上直传 OSS 属后续迭代）
    if (!isBuiltin) {
      const filePath = path.join(glbDir, 'custom', file);
      try {
        const buf = await fs.readFile(filePath);
        headers(buf);
        return reply.send(buf);
      } catch {
        return reply.status(404).send(err('NOT_FOUND', `自定义资产文件 ${file} 缺失，请重新上传`));
      }
    }

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

    const filePath = path.join(glbDir, file);
    try {
      const buf = await fs.readFile(filePath);
      headers(buf);
      return reply.send(buf);
    } catch {
      return reply.status(404).send(err('NOT_FOUND', `设备资产文件 ${file} 缺失`));
    }
  });

  // 自定义 GLB 上传：原始二进制直传（application/octet-stream），服务端校验后落盘并注册版本。
  // 仅接受 custom- 前缀资产 id；内置资产受保护不可覆盖；真实压缩由后续 sim-model-pipe 管线接管。
  app.put<{ Params: { assetId: string }; Querystring: { displayName?: string } }>(
    '/model/glb/:assetId',
    async (req, reply) => {
      const assetId = req.params.assetId;
      const displayName = req.query?.displayName?.trim();
      if (displayName && displayName.length > 40) {
        return reply.status(400).send(err('VALIDATION_FAILED', 'displayName 不能超过 40 字符'));
      }
    if (isBuiltinAssetId(assetId)) {
      return reply.status(409).send(err('CONFLICT', `内置资产 ${assetId} 受保护，不允许覆盖上传`));
    }
    if (!isCustomAssetId(assetId)) {
      return reply.status(400).send(
        err(
          'VALIDATION_FAILED',
          `assetId 须为 ${CUSTOM_ASSET_PREFIX} 前缀的小写字母/数字/连字符（总长 ≤ 64）`,
        ),
      );
    }
    const body = req.body;
    if (!Buffer.isBuffer(body) || body.length === 0) {
      return reply
        .status(400)
        .send(err('VALIDATION_FAILED', '请求体须为非空 GLB 二进制（Content-Type: application/octet-stream）'));
    }
    if (body.length > maxUploadBytes) {
      return reply
        .status(413)
        .send(err('PAYLOAD_TOO_LARGE', `GLB 超过上传大小上限 ${maxUploadBytes} 字节`));
    }
    if (body.subarray(0, 4).toString('ascii') !== 'glTF') {
      return reply.status(400).send(err('VALIDATION_FAILED', '文件缺少 glTF magic 头，仅支持 .glb 二进制'));
    }
    // 实测世界 AABB 包络（米）：assembly/interference/布局消费点都依赖包络尺寸，量测失败
    // 的 GLB（缺 JSON chunk / 节点悬空 / 无可量测 POSITION）一律拒绝，避免无包络资产流入产线链路。
    let measure: GlbMeasureResult;
    try {
      measure = measureGlb(body, assetId);
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause);
      return reply
        .status(400)
        .send(err('VALIDATION_FAILED', `GLB 解析/包络量测失败：${detail}`));
    }

    const customDir = path.join(glbDir, 'custom');
    await fs.mkdir(customDir, { recursive: true });
    await fs.writeFile(path.join(customDir, `${assetId}.glb`), body);

    const now = new Date().toISOString();
    const asset: ModelAssetVersion = {
      id: `sha256-${createHash('sha256').update(body).digest('hex').slice(0, 16)}`,
      assetId,
      ...(displayName ? { displayName } : {}),
      filename: `${assetId}.glb`,
      envelope: { size: measure.size },
      sourceSizeBytes: body.length,
      sizeBytes: body.length,
      compression: 'none',
      lodLevel: 0,
      precisionCritical: false,
      cdnPath: `${assetId}/${assetId}.glb`,
      createdAt: now,
    };
    const saved = await repos.assets.upsert(asset);
    return reply.status(201).send(
      ok({
        asset: saved,
        downloadUrl: `/model/glb/${assetId}.glb`,
        note: '当前按原始体积入库（compression=none），压缩管线接入后自动转压缩版本',
      }),
    );
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
