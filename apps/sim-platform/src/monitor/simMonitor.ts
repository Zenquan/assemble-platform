/**
 * SimMonitor 核心编排 —— M4「监控与可观测性」方向 M3 前端埋点 SDK。
 *
 * 用一条 rAF 循环同时驱动三件事，避免额外定时器：
 *   1. FPS 采样：按采样窗口统计帧数 → `render.fps`；
 *   2. 内存采样：同窗口读 `performance.memory` → `memory.js_heap_used/total`；
 *   3. 周期 flush：达到 `flushIntervalMs` 或样本数达到 `flushSize` 时，把缓冲批量
 *      POST 到同源 gateway `/telemetry`（`{ samples: [{ name, value }] }`）。
 *
 * Web Vitals（LCP/CLS/FID）经 PerformanceObserver 采集，观测到即入队，随下一次
 * flush 一起上报。所有上报 best-effort：失败静默丢弃并记 `stats.lastError`，
 * 绝不影响业务；页面卸载（pagehide）前做最后一次 keepalive flush。
 *
 * 本模块不触碰任何浏览器全局 —— 全部经 `SimMonitorHost` 注入，node 环境可单测。
 */
import type {
  SimMonitor,
  SimMonitorHost,
  SimMonitorOptions,
  SimMonitorStats,
  TelemetrySample,
} from './types';

export const FPS_METRIC = 'render.fps';
export const MEMORY_USED_METRIC = 'memory.js_heap_used';
export const MEMORY_TOTAL_METRIC = 'memory.js_heap_total';
export const LCP_METRIC = 'webvitals.lcp';
export const CLS_METRIC = 'webvitals.cls';
export const FID_METRIC = 'webvitals.fid';

const DEFAULT_ENDPOINT = '/telemetry';
const DEFAULT_FLUSH_INTERVAL_MS = 5000;
const DEFAULT_FLUSH_SIZE = 100;
const DEFAULT_SAMPLE_INTERVAL_MS = 1000;

/** CLS 条目需要读取 value + hadRecentInput（lib.dom 有 LayoutShift，此处用最小结构断言） */
interface LayoutShiftLike extends PerformanceEntry {
  value: number;
  hadRecentInput: boolean;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Web Vitals 采集：LCP（取最后一次）、CLS（忽略 hadRecentInput 的累积）、FID（首输入） */
function startWebVitals(
  host: SimMonitorHost,
  enqueue: (name: string, value: number) => void,
): () => void {
  const PO = host.PerformanceObserver;
  if (!PO) return () => {};
  const disposers: Array<() => void> = [];

  try {
    const lcp = new PO((list) => {
      const entries = list.getEntries();
      const last = entries[entries.length - 1];
      if (last) enqueue(LCP_METRIC, last.startTime);
    });
    lcp.observe({ type: 'largest-contentful-paint', buffered: true });
    disposers.push(() => lcp.disconnect());
  } catch {
    /* 浏览器不支持该 entryType 时静默跳过 */
  }

  let cls = 0;
  try {
    const clsObs = new PO((list) => {
      for (const entry of list.getEntries()) {
        const shift = entry as unknown as LayoutShiftLike;
        if (!shift.hadRecentInput) cls += shift.value;
      }
      enqueue(CLS_METRIC, round2(cls));
    });
    clsObs.observe({ type: 'layout-shift', buffered: true });
    disposers.push(() => clsObs.disconnect());
  } catch {
    /* ignore */
  }

  try {
    const fid = new PO((list) => {
      const first = list.getEntries()[0] as unknown as PerformanceEventTiming | undefined;
      if (first) enqueue(FID_METRIC, round2(first.processingStart - first.startTime));
    });
    fid.observe({ type: 'first-input', buffered: true });
    disposers.push(() => fid.disconnect());
  } catch {
    /* ignore */
  }

  return () => {
    for (const dispose of disposers) dispose();
  };
}

export function createSimMonitor(host: SimMonitorHost, options: SimMonitorOptions = {}): SimMonitor {
  const endpoint = options.endpoint ?? DEFAULT_ENDPOINT;
  const flushIntervalMs = options.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS;
  const flushSize = options.flushSize ?? DEFAULT_FLUSH_SIZE;
  const sampleIntervalMs = options.sampleIntervalMs ?? DEFAULT_SAMPLE_INTERVAL_MS;

  const samples: TelemetrySample[] = [];
  let running = false;
  let rafHandle = 0;
  let frameCount = 0;
  let lastSampleAt = 0;
  let lastFlushAt = 0;
  let flushPromise: Promise<void> | null = null;
  let disposeVitals: () => void = () => {};

  const stats: SimMonitorStats = {
    enqueued: 0,
    flushed: 0,
    dropped: 0,
    batches: 0,
    lastError: null,
  };

  function enqueue(name: string, value: number): void {
    if (!Number.isFinite(value)) return;
    samples.push({ name, value });
    stats.enqueued += 1;
    if (samples.length >= flushSize) void flush();
  }

  function flush(): Promise<void> {
    if (flushPromise) return flushPromise;
    if (samples.length === 0) return Promise.resolve();
    const batch = samples.splice(0, samples.length);
    flushPromise = (async () => {
      try {
        const res = await host.fetchFn(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ samples: batch }),
          keepalive: true,
        });
        if (!res.ok) throw new Error(`telemetry flush failed: HTTP ${res.status}`);
        stats.flushed += batch.length;
        stats.batches += 1;
      } catch (err) {
        stats.dropped += batch.length;
        stats.lastError = err;
      } finally {
        flushPromise = null;
      }
    })();
    return flushPromise;
  }

  function loop(): void {
    if (!running) return;
    const t = host.now();
    frameCount += 1;

    // 采样窗口到期 → 上报 FPS + 内存
    if (t - lastSampleAt >= sampleIntervalMs) {
      const delta = t - lastSampleAt;
      const fps = delta > 0 ? (frameCount * 1000) / delta : 0;
      enqueue(FPS_METRIC, round2(fps));
      frameCount = 0;
      lastSampleAt = t;

      const mem = host.memory?.();
      if (mem) {
        enqueue(MEMORY_USED_METRIC, mem.usedJSHeapSize);
        enqueue(MEMORY_TOTAL_METRIC, mem.totalJSHeapSize);
      }
    }

    // 周期 flush
    if (t - lastFlushAt >= flushIntervalMs) {
      lastFlushAt = t;
      void flush();
    }

    rafHandle = host.raf(loop);
  }

  function onPageHide(): void {
    void flush();
  }

  function start(): void {
    if (running) return;
    running = true;
    frameCount = 0;
    lastSampleAt = host.now();
    lastFlushAt = host.now();
    disposeVitals = startWebVitals(host, enqueue);
    host.onPageHide?.(onPageHide);
    rafHandle = host.raf(loop);
  }

  function stop(): void {
    if (!running) return;
    running = false;
    host.caf(rafHandle);
    disposeVitals();
    disposeVitals = () => {};
  }

  return {
    start,
    stop,
    report: (name, value) => enqueue(name, value),
    flush,
    get stats() {
      return { ...stats };
    },
  };
}
