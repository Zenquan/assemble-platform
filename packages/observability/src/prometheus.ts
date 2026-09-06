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

/** Prometheus 文本格式的 sample 行：`name{labels} value` 或 `name value` */
const SAMPLE_LINE_RE = /^([a-zA-Z_:][a-zA-Z0-9_:]*)(?:\{([^}]*)\})?\s+(.+)$/;

/**
 * 给一份 Prometheus 文本格式注入 `service` 标签，用于 gateway 聚合多个上游
 * 时区分同名指标（如各服务的 `http_requests_total`）的来源。
 *
 * `# HELP` / `# TYPE` 注释行与空行原样保留；无法解析的 sample 行原样保留
 * （防御，不吞指标）。上游文本由本包 `renderPrometheusText` 产出，label 已
 * 排序，注入 `service` 后仍满足 Prometheus 的抓取语义。
 */
export function injectServiceLabel(promText: string, service: string): string {
  const svc = escapeLabelValue(service);
  const out: string[] = [];
  for (const line of promText.split('\n')) {
    if (line.startsWith('#') || line.trim() === '') {
      out.push(line);
      continue;
    }
    const m = SAMPLE_LINE_RE.exec(line);
    if (!m) {
      out.push(line);
      continue;
    }
    const name = m[1]!;
    const rawLabels = m[2];
    const value = m[3]!;
    if (rawLabels === undefined) {
      out.push(`${name}{service="${svc}"} ${value}`);
    } else {
      out.push(`${name}{service="${svc}",${rawLabels}} ${value}`);
    }
  }
  return out.join('\n');
}
