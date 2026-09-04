import type { ProductionLine } from '@assemble/domain';
import { err, ok } from '@assemble/http';
import type { FastifyInstance } from 'fastify';
import { buildBomForLine, type AssemblyRepos } from '../repositories/index.js';

export function registerLineRoutes(app: FastifyInstance, repos: AssemblyRepos): void {
  app.get('/lines', async () => {
    const lines = await repos.lines.list();
    return ok(lines);
  });

  app.get<{ Params: { id: string } }>('/lines/:id', async (req, reply) => {
    const line = await repos.lines.get(req.params.id);
    if (!line) {
      return reply.status(404).send(err('NOT_FOUND', `产线 ${req.params.id} 不存在`));
    }
    return ok(line);
  });

  app.get<{ Params: { id: string } }>('/lines/:id/bom', async (req, reply) => {
    const line = await repos.lines.get(req.params.id);
    if (!line) {
      return reply.status(404).send(err('NOT_FOUND', `产线 ${req.params.id} 不存在`));
    }
    return ok(buildBomForLine(line));
  });

  app.post<{ Body: Omit<ProductionLine, 'createdAt' | 'updatedAt'> }>(
    '/lines',
    async (req, reply) => {
      const now = new Date().toISOString();
      const line: ProductionLine = {
        ...req.body,
        id: req.body.id ?? `line-${now}`,
        createdAt: now,
        updatedAt: now,
      };
      if (!line.name || !line.kind || !Array.isArray(line.stations)) {
        return reply.status(400).send(
          err('VALIDATION_FAILED', '产线缺少 name/kind/stations'),
        );
      }
      const saved = await repos.lines.upsert(line);
      return reply.status(201).send(ok(saved));
    },
  );

  app.patch<{ Params: { id: string }; Body: Partial<ProductionLine> }>(
    '/lines/:id',
    async (req, reply) => {
      const cur = await repos.lines.get(req.params.id);
      if (!cur) {
        return reply.status(404).send(err('NOT_FOUND', `产线 ${req.params.id} 不存在`));
      }
      const next: ProductionLine = { ...cur, ...req.body, id: cur.id, updatedAt: new Date().toISOString() };
      const saved = await repos.lines.upsert(next);
      return ok(saved);
    },
  );
}
