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
      enabled: false,
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

  // 首次运行播种
  void (async () => {
    const existing = await lines.list();
    if (existing.length === 0) {
      for (const line of buildSeedLines()) {
        await lines.upsert(line);
      }
    }
  })();

  return repos;
}
