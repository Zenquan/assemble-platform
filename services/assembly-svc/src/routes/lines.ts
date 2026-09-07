import { isBuiltinAssetId, isCustomAssetId, type ProductionLine } from '@assemble/domain';
import { err, ok } from '@assemble/http';
import type { FastifyInstance } from 'fastify';
import { buildBomForLine, type AssemblyRepos } from '../repositories/index.js';
import { suggestStationLayout } from '../layoutSuggestion.js';

function validateLine(line: ProductionLine): string | null {
  if (!line.name || !line.kind || !Array.isArray(line.stations)) {
    return '产线缺少 name/kind/stations';
  }
  if (line.baseAssetId && !isBuiltinAssetId(line.baseAssetId)) {
    return `产线基座资产 ${line.baseAssetId} 不存在`;
  }
  if (line.transferAssetId && !isBuiltinAssetId(line.transferAssetId)) {
    return `转运资产 ${line.transferAssetId} 不存在`;
  }
  const stationIds = new Set<string>();
  for (const station of line.stations) {
    if (!station.id || station.lineId !== line.id || stationIds.has(station.id)) {
      return `工位 ${station.id || '未命名'} 的 id/lineId 重复或不匹配`;
    }
    if (!Number.isInteger(station.seq) || station.seq < 1 || !Number.isFinite(station.taktSeconds) || station.taktSeconds <= 0) {
      return `工位 ${station.id} 的 seq/taktSeconds 无效`;
    }
    if (station.deviceKind) {
      if (isBuiltinAssetId(station.deviceKind)) {
        // 内置资产走权威静态表 MODEL_ASSET_BOUNDS；携带的 deviceSize 一律忽略
      } else if (isCustomAssetId(station.deviceKind)) {
        // 自定义资产必须携带上传量测的 deviceSize（米，三向有限正数），供 BOM/干涉/布局消费
        const size = station.deviceSize;
        if (!size || size.length !== 3 || size.some((value) => !Number.isFinite(value) || value <= 0)) {
          return `自定义设备 ${station.deviceKind} 必须携带 3 个有限正数的 deviceSize（米，来自上传量测）`;
        }
      } else {
        return `工位 ${station.id} 的设备资产 ${station.deviceKind} 不存在或非合法自定义资产`;
      }
    }
    if (station.footprintLengthMeters !== undefined && (!Number.isFinite(station.footprintLengthMeters) || station.footprintLengthMeters <= 0)) {
      return `工位 ${station.id} 的 footprintLengthMeters 无效`;
    }
    if (
      station.position !== undefined &&
      (station.position.length !== 3 ||
        station.position.some((value) => !Number.isFinite(value)))
    ) {
      return `工位 ${station.id} 的 position 必须是三个有限数`;
    }
    if (station.facingDeg !== undefined && !Number.isFinite(station.facingDeg)) {
      return `工位 ${station.id} 的 facingDeg 无效`;
    }
    stationIds.add(station.id);
  }
  if (line.transferGapMeters !== undefined && (!Number.isFinite(line.transferGapMeters) || line.transferGapMeters < 0)) {
    return 'transferGapMeters 不能为负数';
  }
  return null;
}

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

  // 自动避让建议：真实预检命中 → 返回可回填工位 position 的布局建议
  app.get<{ Params: { id: string } }>('/lines/:id/layout-suggestions', async (req, reply) => {
    const line = await repos.lines.get(req.params.id);
    if (!line) {
      return reply.status(404).send(err('NOT_FOUND', `产线 ${req.params.id} 不存在`));
    }
    return ok(suggestStationLayout(line, buildBomForLine(line)));
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
      const validationError = validateLine(line);
      if (validationError) {
        return reply.status(400).send(
          err('VALIDATION_FAILED', validationError),
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
      const validationError = validateLine(next);
      if (validationError) {
        return reply.status(400).send(err('VALIDATION_FAILED', validationError));
      }
      const saved = await repos.lines.upsert(next);
      return ok(saved);
    },
  );
}
