/**
 * @assemble/observability —— 轻量可观测性指标库（纯 TS，零 Node/fastify 依赖）。
 *
 * 提供 Prometheus 风格的 Counter/Histogram 内存聚合与文本序列化、跨服务链路
 * request-id 工具，以及框架无关的 HTTP 指标记录器。浏览器与后端同源可用，
 * 是 M4「监控与可观测性」方向（见 docs/OBSERVABILITY.md）的共享指标事实源。
 */
export * from './registry.js';
export * from './prometheus.js';
export * from './requestId.js';
export * from './httpMetrics.js';
