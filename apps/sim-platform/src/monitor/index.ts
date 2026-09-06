/**
 * SimMonitor 出口 —— 单例初始化 + 类型/常量再导出。
 *
 * 业务侧只需在应用入口调一次 `initSimMonitor()`，之后埋点全自动运行：
 * Web Vitals + FPS + 内存采样，节流批量上报到同源 gateway `/telemetry`。
 */
import { createBrowserHost } from './host';
import { createSimMonitor } from './simMonitor';
import type { SimMonitor, SimMonitorOptions } from './types';

export * from './types';
export * from './simMonitor';

let singleton: SimMonitor | null = null;

/**
 * 初始化并启动全局 SimMonitor（幂等，多次调用返回同一实例）。
 * 上报端点优先取 options.endpoint，其次 `VITE_TELEMETRY_ENDPOINT`，默认同源 `/telemetry`。
 */
export function initSimMonitor(options: SimMonitorOptions = {}): SimMonitor {
  if (singleton) return singleton;
  const endpoint =
    options.endpoint ??
    (import.meta.env?.['VITE_TELEMETRY_ENDPOINT'] as string | undefined) ??
    '/telemetry';
  singleton = createSimMonitor(createBrowserHost(), { ...options, endpoint });
  singleton.start();
  return singleton;
}
