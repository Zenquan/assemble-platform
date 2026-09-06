#!/usr/bin/env node
/**
 * 资产复用率度量 —— 固化 M3「资产复用 ≥70%」出口门禁为可执行指标。
 *
 * 口径（对应 docs/VERSIONING.md 0.4.x 出口 + 技术方案上线清单「产线资产库
 * 可复用资产 ≥ 首条线设备资产 70%」）：
 *
 *   复用率 = 首条线设备资产中「被其它产线复用」的资产数 / 首条线设备资产总数
 *
 *  - 首条线：seed 数据第一条产线（kind='sorting' 三号分拣线），是平台「原型线」。
 *  - 「被复用」：该资产出现在任意一条非首条线产线的 BOM 中
 *    （baseAssetId / transferAssetId / 任意 station.deviceKind）。
 *  - 数据源单一：直接调用 assembly-svc 的 buildSeedLines()，不重复维护资产清单。
 *
 * 用法（根目录，需先 build:all 产出 assembly-svc dist）：
 *   node scripts/metric-asset-reuse.mjs
 *
 * 门禁：复用率 ≥ 70%，失败退出码非 0（供 CI 捕获）。
 */
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const SEED_MODULE = join(REPO_ROOT, 'services/assembly-svc/dist/repositories/index.js');
const REPORT_DIR = join(REPO_ROOT, '.metrics');
const REPORT = join(REPORT_DIR, 'asset-reuse.json');

const THRESHOLD = 0.7;

if (!existsSync(SEED_MODULE)) {
  console.error(`❌ 缺少 ${SEED_MODULE}\n   请先执行 pnpm build:all 产出 assembly-svc dist。`);
  process.exit(2);
}

const { buildSeedLines } = await import(SEED_MODULE);
const lines = buildSeedLines();

/** 提取一条产线的设备资产集合（base/transfer + 各工位 deviceKind） */
function assetsOf(line) {
  const s = new Set();
  if (line.baseAssetId) s.add(line.baseAssetId);
  if (line.transferAssetId) s.add(line.transferAssetId);
  for (const st of line.stations) s.add(st.deviceKind);
  return s;
}

const first = lines[0];
const firstAssets = assetsOf(first);

// 其它产线（非首条）的资产并集
const otherAssets = new Set();
for (const line of lines.slice(1)) {
  for (const a of assetsOf(line)) otherAssets.add(a);
}

const reused = [...firstAssets].filter((a) => otherAssets.has(a));
const notReused = [...firstAssets].filter((a) => !otherAssets.has(a));

const reuseRate = firstAssets.size > 0 ? reused.length / firstAssets.size : 0;
const pass = reuseRate >= THRESHOLD;

const report = {
  date: new Date().toISOString(),
  definition:
    '复用率 = 首条线设备资产中被其它产线复用的数量 / 首条线设备资产总数',
  firstLine: { id: first.id, name: first.name, kind: first.kind },
  firstLineAssets: [...firstAssets].sort(),
  reusedAssets: reused.sort(),
  notReusedAssets: notReused.sort(),
  reuseRate: round(reuseRate),
  gate: {
    pass,
    actual: round(reuseRate),
    threshold: THRESHOLD,
    unit: 'ratio (≥0.7 = 70%)',
  },
};

mkdirSync(REPORT_DIR, { recursive: true });
writeFileSync(REPORT, JSON.stringify(report, null, 2) + '\n');

function round(n) {
  return Math.round(n * 1000) / 1000;
}

console.log('\n=== 资产复用率度量 ===\n');
console.log(`首条线：${first.name}（${first.id}）`);
console.log(`首条线设备资产（${firstAssets.size} 个）：${[...firstAssets].sort().join(', ')}`);
console.log(`\n被其它产线复用（${reused.length} 个）：${reused.sort().join(', ')}`);
console.log(`未复用（${notReused.length} 个）：${notReused.length ? notReused.sort().join(', ') : '（无）'}`);
console.log(`\n复用率 = ${reused.length} / ${firstAssets.size} = ${round(reuseRate * 100)}%`);
console.log(`门禁：≥ ${THRESHOLD * 100}% → ${pass ? '✅ 通过' : '❌ 未通过'}`);
console.log(`\n报告已写入：${REPORT}`);

if (!pass) process.exitCode = 1;
