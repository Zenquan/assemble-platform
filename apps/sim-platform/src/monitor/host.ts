/**
 * 浏览器宿主绑定 —— 把真实 window/performance/PerformanceObserver/fetch 适配成
 * `SimMonitorHost` 窄接口。核心编排逻辑（simMonitor.ts）不直接触碰任何浏览器全局，
 * 只在 host 处做能力探测与优雅降级（SSR / 老浏览器安全）。
 */
import type { SimMonitorHost } from './types';

/** Chrome 非标准 `performance.memory`（TS lib.dom 未声明，自建最小结构） */
interface ChromeMemoryInfo {
  usedJSHeapSize: number;
  totalJSHeapSize: number;
}

export function createBrowserHost(): SimMonitorHost {
  const win = typeof window !== 'undefined' ? window : undefined;
  const perf = typeof performance !== 'undefined' ? performance : undefined;

  return {
    raf(cb) {
      if (win?.requestAnimationFrame) return win.requestAnimationFrame(cb);
      // 无 rAF（SSR/罕见环境）回退 setTimeout 近似 16ms
      return setTimeout(() => cb(perf?.now() ?? Date.now()), 16) as unknown as number;
    },
    caf(handle) {
      if (win?.cancelAnimationFrame) win.cancelAnimationFrame(handle);
      else clearTimeout(handle as unknown as number);
    },
    now() {
      return perf?.now() ?? Date.now();
    },
    fetchFn(input, init) {
      return fetch(input, init);
    },
    PerformanceObserver:
      typeof PerformanceObserver !== 'undefined' ? PerformanceObserver : undefined,
    memory() {
      const mem = (perf as (Performance & { memory?: ChromeMemoryInfo }) | undefined)?.memory;
      if (!mem || !Number.isFinite(mem.usedJSHeapSize)) return null;
      return { usedJSHeapSize: mem.usedJSHeapSize, totalJSHeapSize: mem.totalJSHeapSize };
    },
    onPageHide(cb) {
      win?.addEventListener('pagehide', () => cb());
    },
  };
}
