import { ok } from '@assemble/http';
import Fastify, { type FastifyInstance } from 'fastify';
import { runOfflineCheck } from './offlineCheck.js';

export interface InterferenceCheckBody {
  lineKind: string;
  partCount?: number;
}

export function buildApp(): FastifyInstance {
  const app = Fastify({ logger: true });

  app.get('/healthz', async () => ({
    status: 'ok',
    service: 'interference-svc',
    time: new Date().toISOString(),
  }));

  // 离线整线批量预检入口
  app.post<{ Body: InterferenceCheckBody }>(
    '/interference/offline',
    async (req, reply) => {
      const lineKind = req.body?.lineKind;
      if (!lineKind) {
        return reply.status(400).send({
          ok: false,
          code: 'VALIDATION_FAILED',
          message: '缺少 lineKind',
        });
      }
      const partCount = Math.max(2, Math.min(req.body?.partCount ?? 200, 5000));
      const { report } = runOfflineCheck({ lineKind, partCount });
      return ok(report);
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
