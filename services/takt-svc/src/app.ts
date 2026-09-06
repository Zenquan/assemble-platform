import { err, ok } from '@assemble/http';
import {
  createHttpMetrics,
  MetricsRegistry,
  REQUEST_ID_HEADER,
  renderPrometheusText,
} from '@assemble/observability';
import Fastify, { type FastifyInstance } from 'fastify';
import { createTaktRepos, type TaktRepos } from './repositories/index.js';
import { computeTakt } from './taktCore.js';

interface Envelope<T> {
  ok: boolean;
  data?: T;
  message?: string;
}

interface AssemblyLine {
  id: string;
  stations: Array<{ id: string; taktSeconds: number }>;
}

export interface TaktAppDeps {
  assemblyBaseUrl?: string;
  fetchImpl?: typeof fetch;
  repos?: TaktRepos;
}

async function fetchAssemblyLine(
  lineId: string,
  baseUrl: string,
  fetchImpl: typeof fetch,
  requestId?: string,
): Promise<AssemblyLine> {
  const headers = requestId ? { [REQUEST_ID_HEADER]: requestId } : undefined;
  const response = await fetchImpl(`${baseUrl}/lines/${encodeURIComponent(lineId)}`, { headers });
  const envelope = await response.json() as Envelope<AssemblyLine>;
  if (!response.ok || !envelope.ok || !envelope.data) {
    throw new Error(envelope.message ?? `assembly-svc 返回产线失败 (${response.status})`);
  }
  if (envelope.data.id !== lineId || !Array.isArray(envelope.data.stations)) {
    throw new Error('assembly-svc 返回的产线数据无效');
  }
  return envelope.data;
}

export function buildApp(deps: TaktAppDeps = {}): FastifyInstance {
  const app = Fastify({ logger: true, requestIdHeader: REQUEST_ID_HEADER });
  const assemblyBaseUrl = deps.assemblyBaseUrl ?? process.env['ASSEMBLY_SVC_URL'] ?? 'http://127.0.0.1:7101';
  const fetchImpl = deps.fetchImpl ?? fetch;
  const repos = deps.repos ?? createTaktRepos();
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

  app.get('/healthz', async () => ({
    status: 'ok',
    service: 'takt-svc',
    time: new Date().toISOString(),
  }));

  app.get('/metrics', async (_req, reply) => {
    reply.header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    return renderPrometheusText(registry);
  });

  app.post<{
    Body: { lineId?: string; targetUnitsPerHour?: number; availability?: number };
  }>('/takt/simulate', async (req, reply) => {
    const lineId = req.body?.lineId;
    if (!lineId) return reply.status(400).send(err('VALIDATION_FAILED', '缺少 lineId'));
    try {
      const line = await fetchAssemblyLine(lineId, assemblyBaseUrl, fetchImpl, req.id);
      await repos.ready;
      const config = (await repos.configs.list()).find((item) => item.lineId === lineId);
      const observations = (await repos.observations.list()).filter(
        (observation) => observation.lineId === lineId,
      );
      return ok(computeTakt({
        lineId,
        stations: line.stations,
        targetUnitsPerHour: config?.targetUnitsPerHour ?? req.body?.targetUnitsPerHour,
        availability: config?.availability ?? req.body?.availability,
        configSource: config?.source,
        observations,
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : '无法读取 assembly-svc 产线';
      return reply.status(502).send(err('DEPENDENCY_UNAVAILABLE', message));
    }
  });

  return app;
}
