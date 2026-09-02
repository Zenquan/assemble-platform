import type { ProductionLine } from '@assemble/domain';
import { createRepo, resolveBackend, type Repository } from '@assemble/storage';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** 装配服务仓储：以产线为主聚合，用降级存储（内存/文件） */
export interface AssemblyRepos {
  lines: Repository<ProductionLine>;
}

/** 种子产线：覆盖三类产线，供本地演示/联调 */
export function buildSeedLines(): ProductionLine[] {
  const now = new Date().toISOString();
  const lines: ProductionLine[] = [
    {
      id: 'line-sorting-01',
      name: '三号分拣线',
      kind: 'sorting',
      modelVersion: 'sha3-v1.2.0',
      enabled: true,
      createdAt: now,
      updatedAt: now,
      stations: [
        { id: 'st-s1', lineId: 'line-sorting-01', seq: 1, name: '上料工位', taktSeconds: 3.2 },
        { id: 'st-s2', lineId: 'line-sorting-01', seq: 2, name: '视觉分拣', taktSeconds: 2.6 },
        { id: 'st-s3', lineId: 'line-sorting-01', seq: 3, name: '装箱工位', taktSeconds: 3.8 },
      ],
    },
    {
      id: 'line-freshcut-01',
      name: '净菜预处理线',
      kind: 'fresh-cut',
      modelVersion: 'sha3-v0.9.1',
      enabled: true,
      createdAt: now,
      updatedAt: now,
      stations: [
        { id: 'st-f1', lineId: 'line-freshcut-01', seq: 1, name: '清洗', taktSeconds: 5.0 },
        { id: 'st-f2', lineId: 'line-freshcut-01', seq: 2, name: '切配', taktSeconds: 4.2 },
        { id: 'st-f3', lineId: 'line-freshcut-01', seq: 3, name: '称重包装', taktSeconds: 6.1 },
      ],
    },
    {
      id: 'line-cold-01',
      name: '冷链预包装线',
      kind: 'cold-chain',
      modelVersion: 'sha3-v2.0.0',
      enabled: true,
      createdAt: now,
      updatedAt: now,
      stations: [
        { id: 'st-c1', lineId: 'line-cold-01', seq: 1, name: '预冷', taktSeconds: 8.0 },
        { id: 'st-c2', lineId: 'line-cold-01', seq: 2, name: '低温装配', taktSeconds: 7.4 },
      ],
    },
  ];
  return lines;
}

export function createAssemblyRepos(): AssemblyRepos {
  const backend = resolveBackend();
  const dataDir =
    process.env['ASSEMBLE_DATA_DIR'] ?? path.resolve(__dirname, '../../.assemble-data');
  const lines = createRepo<ProductionLine>(
    { backend, dataDir },
    'production-lines',
  );
  const repos: AssemblyRepos = { lines };

  // 首次运行播种：空时插入种子；已有时按 id 同步种子最新字段（保证 demo 状态可演进）
  void (async () => {
    const existing = await lines.list();
    const byId = new Map(existing.map((l) => [l.id, l]));
    for (const seed of buildSeedLines()) {
      const cur = byId.get(seed.id);
      if (!cur) {
        await lines.upsert(seed);
      } else if (cur.enabled !== seed.enabled) {
        // 种子字段（如 enabled）变化时同步到仓储，便于 demo 状态演进无需清盘
        await lines.upsert({ ...cur, enabled: seed.enabled, updatedAt: seed.updatedAt });
      }
    }
  })();

  return repos;
}
