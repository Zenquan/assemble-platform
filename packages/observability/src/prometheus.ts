/**
 * Prometheus 文本格式（text format 0.0.4）序列化。
 *
 * 输出可被 `curl` 直读，未来接 Prometheus 时无需改动指标采集语义——只需把
 * 各服务 `/metrics` 暴露给 Prometheus scrape。
 */

import type { Labels, MetricsRegistry } from './registry.js';

function escapeLabelValue(v: string): string {
  return v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

/** 合并 labels（extra 覆盖同名键）后排序序列化为 `{k="v",...}`；空则返回空串 */
function formatLabels(labels: Labels, extra?: Labels): string {
  const merged: Record<string, string> = {};
  for (const [k, v] of Object.entries(labels)) merged[k] = v;
  if (extra) {
    for (const [k, v] of Object.entries(extra)) merged[k] = v;
  }
  const keys = Object.keys(merged).sort();
  if (keys.length === 0) return '';
  const parts = keys.map((k) => `${k}="${escapeLabelValue(merged[k] ?? '')}"`);
  return `{${parts.join(',')}}`;
}

function formatNumber(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return String(Number(n.toPrecision(12)));
}

/** 把注册表渲染为 Prometheus 文本格式（末尾带换行） */
export function renderPrometheusText(registry: MetricsRegistry): string {
  const lines: string[] = [];

  for (const c of registry.allCounters()) {
    lines.push(`# HELP ${c.name} ${c.help}`);
    lines.push(`# TYPE ${c.name} counter`);
    for (const s of c.entries()) {
      lines.push(`${c.name}${formatLabels(s.labels)} ${formatNumber(s.value)}`);
    }
  }

  for (const h of registry.allHistograms()) {
    lines.push(`# HELP ${h.name} ${h.help}`);
    lines.push(`# TYPE ${h.name} histogram`);
    for (const s of h.entries()) {
      for (let i = 0; i < h.buckets.length; i++) {
        const upper = h.buckets[i];
        if (upper === undefined) continue;
        lines.push(
          `${h.name}_bucket${formatLabels(s.labels, { le: formatNumber(upper) })} ${
            s.bucketCounts[i] ?? 0
          }`,
        );
      }
      lines.push(`${h.name}_bucket${formatLabels(s.labels, { le: '+Inf' })} ${s.count}`);
      lines.push(`${h.name}_sum${formatLabels(s.labels)} ${formatNumber(s.sum)}`);
      lines.push(`${h.name}_count${formatLabels(s.labels)} ${s.count}`);
    }
  }

  return lines.join('\n') + '\n';
}
