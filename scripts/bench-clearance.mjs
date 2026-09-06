#!/usr/bin/env node
/**
 * @assemble/clearance-core 性能基准 —— 独立于单测，产出可对比的 JSON 报告。
 *
 * 用法（根目录）：
 *   node scripts/bench-clearance.mjs            # 跑基准 + 门禁 + 写报告
 *   node scripts/bench-clearance.mjs --quiet    # 只写报告，不打印对比表
 *
 * 门禁（与 docs/TESTING.md 红线一致）：
 *   runFull.200 件 median < 200ms —— 失败退出码非 0，供 CI 捕获。
 *
 * 报告落盘：.bench/clearance-core.json（含 delta，与上次对比）。
 */
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const DIST = join(REPO_ROOT, 'packages/clearance-core/dist/index.js');
const REPORT_DIR = join(REPO_ROOT, '.bench');
const REPORT = join(REPORT_DIR, 'clearance-core.json');
const QUIET = process.argv.includes('--quiet');

const mod = await import(DIST);
const { ClearanceDetector, Bvh, obbIntersect, obbFromCenterHalfExtents } = mod;

/* ------------------------------------------------------------------ */
/* 工具函数                                                            */
/* ------------------------------------------------------------------ */

/** 排序后取分位数（0.5=median，0.95=p95） */
function quantile(sorted, q) {
  const i = Math.min(sorted.length - 1, Math.floor(q * sorted.length));
  return sorted[i];
}

function stats(samples) {
  const s = [...samples].sort((a, b) => a - b);
  return {
    samples: samples.length,
    medianMs: round(quantile(s, 0.5)),
    p95Ms: round(quantile(s, 0.95)),
    minMs: round(s[0]),
    maxMs: round(s[s.length - 1]),
  };
}

function round(n) {
  // 微基准保留 ns 精度，宏基准保留 3 位小数 ms
  return Number.isFinite(n) ? Math.round(n * 1000) / 1000 : n;
}

/** 跑 rounds 轮 fn，返回每轮耗时 ms 数组 */
function bench(fn, rounds) {
  const out = [];
  for (let i = 0; i < rounds; i++) {
    const t0 = performance.now();
    fn();
    out.push(performance.now() - t0);
  }
  return out;
}

/** 微基准：批量循环 iterations 次，返回单次 ns/op */
function microBench(fn, iterations) {
  const t0 = performance.now();
  for (let i = 0; i < iterations; i++) fn();
  const elapsed = performance.now() - t0;
  return (elapsed / iterations) * 1e6; // ns
}

/* ------------------------------------------------------------------ */
/* 场景数据生成                                                        */
/* ------------------------------------------------------------------ */

/** 生成 n 件零件：分段密集布局（段内间距 1.5、段间 12），体现 BVH 剔除价值 */
function genParts(n) {
  const parts = [];
  for (let i = 0; i < n; i++) {
    const seg = Math.floor(i / 10);
    const inSeg = i % 10;
    parts.push({
      partId: `p${i}`,
      obb: obbFromCenterHalfExtents(
        [seg * 12 + inSeg * 1.5, inSeg * 1.5, 0],
        [1, 1, 1],
      ),
    });
  }
  return parts;
}

/** 生成 n 件零件对应的 AABB（供 Bvh.build / broad 阶段基准） */
function genBoxes(parts) {
  return parts.map((p) => {
    const c = p.obb.center;
    const h = p.obb.halfExtents;
    return {
      partId: p.partId,
      box: {
        min: [c[0] - h[0], c[1] - h[1], c[2] - h[2]],
        max: [c[0] + h[0], c[1] + h[1], c[2] + h[2]],
      },
    };
  });
}

/* ------------------------------------------------------------------ */
/* 基准场景                                                            */
/* ------------------------------------------------------------------ */

const P200 = genParts(200);
const P500 = genParts(500);
const B200 = genBoxes(P200);
const B500 = genBoxes(P500);

const boxA = obbFromCenterHalfExtents([0, 0, 0], [1, 1, 1]);
const boxHit = obbFromCenterHalfExtents([1.5, 0, 0], [1, 1, 1]); // 相交
const boxMiss = obbFromCenterHalfExtents([50, 0, 0], [1, 1, 1]); // 分离

const metrics = {};

// 1. OBB-SAT narrow phase 微基准（ns/op）
metrics['obbIntersect.hit'] = { nsPerOp: round(microBench(() => obbIntersect(boxA, boxHit), 200000)) };
metrics['obbIntersect.miss'] = { nsPerOp: round(microBench(() => obbIntersect(boxA, boxMiss), 200000)) };

// 2. BVH 构建（broad phase 索引构造）
metrics['bvhBuild.200'] = stats(bench(() => Bvh.build(B200), 30));
metrics['bvhBuild.500'] = stats(bench(() => Bvh.build(B500), 30));

// 3. 全量自交 runFull（主门禁）
const d200 = () => new ClearanceDetector().loadAll(P200).runFull();
const d500 = () => new ClearanceDetector().loadAll(P500).runFull();
metrics['runFull.200'] = stats(bench(d200, 30));
metrics['runFull.500'] = stats(bench(d500, 10));

// 4. BVH selfIntersect broad 剔除（排除 narrow 判定的纯粗筛耗时）
metrics['broadSelfIntersect.500'] = stats(bench(() => Bvh.build(B500).selfIntersect(), 10));

// 5. 交互式实时检测路径（单件 vs 已装入 200 件）
{
  const det = new ClearanceDetector().loadAll(P200);
  const moving = { partId: 'moving', obb: obbFromCenterHalfExtents([0, 0, 0], [1, 1, 1]) };
  metrics['queryInteractive.200'] = stats(bench(() => det.queryInteractive(moving), 100));
}

/* ------------------------------------------------------------------ */
/* 门禁 + 报告 + 对比                                                  */
/* ------------------------------------------------------------------ */

const gates = {
  'runFull.200.median < 200ms': {
    pass: metrics['runFull.200'].medianMs < 200,
    actual: metrics['runFull.200'].medianMs,
    threshold: 200,
  },
};

// 上次报告对比
let prev = null;
try {
  prev = JSON.parse(readFileSync(REPORT, 'utf8'));
} catch {
  /* 首次运行无历史 */
}

const report = {
  date: new Date().toISOString(),
  node: process.version,
  platform: `${process.platform} ${process.arch}`,
  metrics,
  gates,
  delta: prev ? computeDelta(metrics, prev.metrics) : null,
};

mkdirSync(REPORT_DIR, { recursive: true });
writeFileSync(REPORT, JSON.stringify(report, null, 2) + '\n');

function computeDelta(cur, old) {
  const out = {};
  for (const [k, v] of Object.entries(cur)) {
    if (old[k]?.medianMs) {
      const d = ((v.medianMs - old[k].medianMs) / old[k].medianMs) * 100;
      out[k] = `${d >= 0 ? '+' : ''}${d.toFixed(1)}%`;
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* 输出                                                                */
/* ------------------------------------------------------------------ */

if (!QUIET) {
  console.log('\n=== @assemble/clearance-core 性能基准 ===\n');
  console.log(`node ${process.version} | ${process.platform} ${process.arch} | ${report.date}\n`);

  console.log('─ 微基准（ns/op）─');
  for (const k of ['obbIntersect.hit', 'obbIntersect.miss']) {
    console.log(`  ${k.padEnd(22)} ${metrics[k].nsPerOp} ns`);
  }

  console.log('\n─ 宏基准（median / p95 ms）─');
  const macroKeys = [
    'bvhBuild.200', 'bvhBuild.500',
    'runFull.200', 'runFull.500',
    'broadSelfIntersect.500', 'queryInteractive.200',
  ];
  for (const k of macroKeys) {
    const m = metrics[k];
    const delta = report.delta?.[k] ? `  (${report.delta[k]})` : '';
    console.log(
      `  ${k.padEnd(24)} med=${String(m.medianMs).padStart(9)}  p95=${String(m.p95Ms).padStart(9)}${delta}`,
    );
  }

  console.log('\n─ 门禁 ─');
  let failed = false;
  for (const [k, g] of Object.entries(gates)) {
    const mark = g.pass ? '✅' : '❌';
    console.log(`  ${mark} ${k}：actual=${g.actual}ms threshold=${g.threshold}ms`);
    if (!g.pass) failed = true;
  }

  console.log(`\n报告已写入：${REPORT}`);
  console.log(failed ? '\n❌ 门禁未通过' : '\n✅ 全部门禁通过');
  if (failed) process.exitCode = 1;
}
