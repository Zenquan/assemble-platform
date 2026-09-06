/**
 * gateway 可观测性封装 —— M4「监控与可观测性」方向 M2 的核心。
 *
 * gateway 是纯 node:http 实现（非 Fastify），这里把「结构化 JSON 日志 +
 * request-id 透传/生成 + 自身指标 + 上游 /metrics 聚合 + /telemetry 接收」
 * 收敛到一个模块，供 server.ts 接入，避免可观测性胶水散落在代理主循环里。
 *
 * 指标采用内存聚合（重启丢失可接受，指标本就临时），输出 Prometheus 文本，
 * 未来接 Prometheus 时无需改动采集语义（见 docs/OBSERVABILITY.md）。
 */
import {
  createHttpMetrics,
  createRequestId,
  injectServiceLabel,
  MetricsRegistry,
  REQUEST_ID_HEADER,
  renderPrometheusText,
} from '@assemble/observability';
import { request as httpRequest, type IncomingMessage } from 'node:http';

/** gateway 自身指标注册表（模块级单例，进程生命周期内累加） */
export const gatewayRegistry = new MetricsRegistry();
export const gatewayHttpMetrics = createHttpMetrics(gatewayRegistry);

const telemetrySamples = gatewayRegistry.counter(
  'telemetry_samples_total',
  'Total telemetry samples received from the frontend SimMonitor.',
);
// telemetry 值域跨度大（FPS ~ 10²、LCP ~ 10³ms、内存 ~ 10²MB），用一条
// 无量纲宽分桶直方图 + name 标签区分，sum/count 仍可还原各指标均值。
const telemetryValue = gatewayRegistry.histogram(
  'telemetry_value',
  'Telemetry sample value distribution (unitless axis, discriminated by name label).',
  [1, 5, 10, 30, 60, 100, 300, 1000, 3000, 10000],
);

export interface TelemetrySample {
  name: string;
  value: number;
}

/** 记录一批 telemetry 样本，返回成功记录的条数（非法样本静默丢弃） */
export function recordTelemetry(samples: readonly TelemetrySample[]): number {
  let recorded = 0;
  for (const s of samples) {
    if (typeof s?.name !== 'string' || !Number.isFinite(s?.value)) continue;
    telemetrySamples.inc({ name: s.name });
    telemetryValue.observe(s.value, { name: s.name });
    recorded += 1;
  }
  return recorded;
}

/** 采纳上游 request-id，无则生成（node 会把请求头名统一小写化） */
export function getOrCreateRequestId(req: IncomingMessage): string {
  const existing = req.headers[REQUEST_ID_HEADER];
  if (typeof existing === 'string' && existing.length > 0) return existing;
  if (Array.isArray(existing)) {
    const first = existing.find((v) => v.length > 0);
    if (first) return first;
  }
  return createRequestId();
}

export type LogLevel = 'info' | 'warn' | 'error';

/** 结构化 JSON 日志（单行，level/ts/msg + 业务字段，可被日志聚合检索） */
export function logJson(level: LogLevel, msg: string, fields?: Record<string, unknown>): void {
  const line = JSON.stringify({ level, ts: new Date().toISOString(), msg, ...fields });
  if (level === 'error') console.error(line);
  else console.log(line);
}

/** 拉取单个上游的 /metrics 文本（超时/失败 reject，由调用方决定容错策略） */
export function fetchUpstreamMetricsText(port: number, timeoutMs = 2000): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { host: '127.0.0.1', port, path: '/metrics', method: 'GET', timeout: timeoutMs },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          body += chunk;
        });
        res.on('end', () => resolve(body));
      },
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`upstream metrics timeout (port=${port})`));
    });
    req.end();
  });
}

export interface UpstreamMetricsText {
  service: string;
  text: string;
}

/** 聚合多份上游指标文本（每份注入 service 标签后拼接，区分同名指标来源） */
export function aggregateUpstreamMetrics(upstreams: readonly UpstreamMetricsText[]): string {
  return upstreams.map((u) => injectServiceLabel(u.text, u.service).trimEnd()).join('\n');
}

/** 完整 /metrics 输出：gateway 自身指标 + 聚合后的上游指标 */
export function renderGatewayMetrics(upstreams: readonly UpstreamMetricsText[]): string {
  return renderPrometheusText(gatewayRegistry) + aggregateUpstreamMetrics(upstreams);
}

const MAX_BODY_BYTES = 1024 * 1024; // 1MB，telemetry 批量上报上限

/** 读取并解析请求 JSON body（telemetry 端点用），失败/超限返回 null */
export async function readJsonBody(req: IncomingMessage): Promise<unknown | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const done = (v: unknown | null): void => {
      if (settled) return;
      settled = true;
      resolve(v);
    };
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        req.destroy();
        done(null);
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        done(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        done(null);
      }
    });
    req.on('error', () => done(null));
  });
}
