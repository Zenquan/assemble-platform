import { err, ok } from '@assemble/http';
import Fastify, { type FastifyInstance } from 'fastify';
import { computeTakt, type TaktSimRequest } from './taktCore.js';

export function buildApp(): FastifyInstance {
  const app = Fastify({ logger: true });

  app.get('/healthz', async () => ({
    status: 'ok',
    service: 'takt-svc',
    time: new Date().toISOString(),
  }));

  app.post<{ Body: Partial<TaktSimRequest> }>('/takt/simulate', async (req, reply) => {
    const b = req.body;
    if (!b?.stations?.length || !b.lineId || !b.targetUnitsPerHour) {
      return reply.status(400).send(err('VALIDATION_FAILED', '缺少 lineId/stations/targetUnitsPerHour'));
    }
    const res = computeTakt({
      lineId: b.lineId,
      stations: b.stations,
      targetUnitsPerHour: b.targetUnitsPerHour,
      availability: b.availability ?? 1,
    });
    return ok(res);
  });

  return app;
}
