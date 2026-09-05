import { err, ok } from '@assemble/http';
import Fastify, { type FastifyInstance } from 'fastify';
import { runOfflineCheck } from './offlineCheck.js';

export interface InterferenceCheckBody {
  lineId: string;
}

interface Envelope<T> {
  ok: boolean;
  data?: T;
  code?: string;
  message?: string;
}

interface AssemblyLine {
  id: string;
  kind: string;
}

interface AssemblyBom {
  lineId: string;
  parts: Array<{ id: string }>;
}

export interface InterferenceAppDeps {
  assemblyBaseUrl?: string;
  fetchImpl?: typeof fetch;
}

async function fetchAssemblyData(
  lineId: string,
  baseUrl: string,
  fetchImpl: typeof fetch,
): Promise<{ line: AssemblyLine; bom: AssemblyBom }> {
  const encodedId = encodeURIComponent(lineId);
  const [lineResponse, bomResponse] = await Promise.all([
    fetchImpl(`${baseUrl}/lines/${encodedId}`),
    fetchImpl(`${baseUrl}/lines/${encodedId}/bom`),
  ]);
  const lineEnvelope = await lineResponse.json() as Envelope<AssemblyLine>;
  const bomEnvelope = await bomResponse.json() as Envelope<AssemblyBom>;
  if (!lineResponse.ok || !lineEnvelope.ok) {
    throw new Error(lineEnvelope.message ?? `assembly-svc 返回产线失败 (${lineResponse.status})`);
  }
  if (!bomResponse.ok || !bomEnvelope.ok) {
    throw new Error(bomEnvelope.message ?? `assembly-svc 返回 BOM 失败 (${bomResponse.status})`);
  }
  if (!lineEnvelope.data || !bomEnvelope.data || bomEnvelope.data.lineId !== lineId) {
    throw new Error('assembly-svc 返回的产线与 BOM 不匹配');
  }
  return { line: lineEnvelope.data, bom: bomEnvelope.data };
}

export function buildApp(deps: InterferenceAppDeps = {}): FastifyInstance {
  const app = Fastify({ logger: true });
  const assemblyBaseUrl = deps.assemblyBaseUrl ?? process.env['ASSEMBLY_SVC_URL'] ?? 'http://127.0.0.1:7101';
  const fetchImpl = deps.fetchImpl ?? fetch;

  app.get('/healthz', async () => ({
    status: 'ok',
    service: 'interference-svc',
    time: new Date().toISOString(),
  }));

  // 离线整线批量预检入口
  app.post<{ Body: InterferenceCheckBody }>(
    '/interference/offline',
    async (req, reply) => {
      const lineId = req.body?.lineId;
      if (!lineId) {
        return reply.status(400).send(err('VALIDATION_FAILED', '缺少 lineId'));
      }
      try {
        const { line, bom } = await fetchAssemblyData(lineId, assemblyBaseUrl, fetchImpl);
        const { report } = runOfflineCheck({
          lineId,
          lineKind: line.kind,
          partCount: bom.parts.length,
        });
        return ok(report);
      } catch (error) {
        const message = error instanceof Error ? error.message : '无法读取 assembly-svc 产线 BOM';
        return reply.status(502).send(err('DEPENDENCY_UNAVAILABLE', message));
      }
    },
  );

  // 交互式单件检测的离线形态（演示同算法前端实时检测的判定来源）
  app.get('/interference/algorithm', async () => ({
    ok: true,
    data: {
      broadPhase: 'BVH',
      narrowPhase: 'OBB-SAT (15 axes)',
      note: '同一套 @assemble/clearance-core 被前端 SimEngine 实时检测复用',
    },
  }));

  return app;
}
