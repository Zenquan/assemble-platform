/**
 * 框架无关的 HTTP 指标记录器：把「请求计数 + 延迟直方图」从 Fastify/node:http
 * 的具体 hook 中解耦出来，供各后端服务复用，避免重复声明同名指标。
 */

import { MetricsRegistry } from './registry.js';

/** HTTP 延迟分桶（秒），覆盖毫秒级到 10s 的典型服务响应 */
export const DEFAULT_DURATION_BUCKETS: readonly number[] = [
  0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10,
];

export interface HttpMetrics {
  /** 记录请求开始，返回毫秒时间戳 */
  startRequest(): number;
  /** 请求结束时累计 counter + histogram（route 建议用路由模板避免高基数） */
  record(startedAt: number, method: string, route: string, statusCode: number): void;
}

export function createHttpMetrics(registry: MetricsRegistry): HttpMetrics {
  const requests = registry.counter(
    'http_requests_total',
    'Total number of HTTP requests handled.',
  );
  const duration = registry.histogram(
    'http_request_duration_seconds',
    'HTTP request duration in seconds.',
    DEFAULT_DURATION_BUCKETS,
  );

  return {
    startRequest: () => Date.now(),
    record: (startedAt, method, route, statusCode) => {
      const labels = { method, route, status: String(statusCode) };
      requests.inc(labels);
      duration.observe((Date.now() - startedAt) / 1000, labels);
    },
  };
}
