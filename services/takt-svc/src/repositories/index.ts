import type { TaktConfig, TaktDataSource, TaktObservation } from '@assemble/domain';
import { createRepo, resolveBackend, type Repository } from '@assemble/storage';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface TaktRepos {
  configs: Repository<TaktConfig>;
  observations: Repository<TaktObservation>;
  ready: Promise<void>;
}

function createConfig(
  lineId: string,
  targetUnitsPerHour: number,
  availability: number,
  updatedAt: string,
): TaktConfig {
  return {
    id: `takt-config-${lineId}`,
    lineId,
    targetUnitsPerHour,
    availability,
    source: 'configuration',
    updatedAt,
  };
}

function createObservation(
  lineId: string,
  completedUnits: number,
  actualTaktSeconds: number,
  observedAt: string,
): TaktObservation {
  return {
    id: `takt-observation-${lineId}`,
    lineId,
    windowSeconds: 3600,
    completedUnits,
    actualTaktSeconds,
    source: 'mes',
    observedAt,
  };
}

/** 后端本地演示数据：配置和观测均走仓储，不在路由中推导或硬编码。 */
export function buildSeedTaktData(now = new Date().toISOString()): {
  configs: TaktConfig[];
  observations: TaktObservation[];
} {
  return {
    configs: [
      createConfig('line-sorting-01', 800, 0.9, now),
      createConfig('line-freshcut-01', 480, 0.95, now),
      createConfig('line-cold-01', 360, 0.9, now),
    ],
    observations: [
      createObservation('line-sorting-01', 850, 3600 / 850, now),
      createObservation('line-freshcut-01', 430, 3600 / 430, now),
      createObservation('line-cold-01', 345, 3600 / 345, now),
    ],
  };
}

async function seedIfMissing<T extends { id: string }>(
  repo: Repository<T>,
  items: readonly T[],
): Promise<void> {
  const existing = new Set((await repo.list()).map((item) => item.id));
  for (const item of items) {
    if (!existing.has(item.id)) await repo.upsert(item);
  }
}

export function createTaktRepos(): TaktRepos {
  const backend = resolveBackend();
  const dataDir =
    process.env['ASSEMBLE_DATA_DIR'] ?? path.resolve(__dirname, '../../.assemble-data');
  const configs = createRepo<TaktConfig>({ backend, dataDir }, 'takt-configs');
  const observations = createRepo<TaktObservation>(
    { backend, dataDir },
    'takt-observations',
  );
  const seed = buildSeedTaktData();
  const ready = Promise.all([
    seedIfMissing(configs, seed.configs),
    seedIfMissing(observations, seed.observations),
  ]).then(() => undefined);
  return { configs, observations, ready };
}

export const DEFAULT_TAKT_SOURCE: TaktDataSource = 'derived';
