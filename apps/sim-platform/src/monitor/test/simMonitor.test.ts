/**
 * SimMonitor 核心编排单测（node 环境，注入假 rAF / PerformanceObserver / fetch）。
 *
 * 覆盖：FPS 采样、内存采样、Web Vitals（LCP/CLS/FID）、flushSize 立即刷新、
 * flushIntervalMs 周期刷新、失败静默丢弃并记 lastError、stop 取消 rAF + 断开
 * observer、pagehide 最后一次 flush。全部经注入宿主驱动，无浏览器全局依赖。
 */
import { describe, expect, it } from 'vitest';

import {
  CLS_METRIC,
  createSimMonitor,
  FID_METRIC,
  FPS_METRIC,
  LCP_METRIC,
  MEMORY_TOTAL_METRIC,
  MEMORY_USED_METRIC,
} from '@/monitor/simMonitor';
import type { SimMonitorHost, TelemetrySample } from '@/monitor/types';

const USED_HEAP = 128 * 1024 * 1024;
const TOTAL_HEAP = 256 * 1024 * 1024;

interface FakeObserver {
  type: string;
  disconnected: boolean;
  cb: (list: { getEntries: () => unknown[] }) => void;
}

interface Rig {
  host: SimMonitorHost;
  requests: Array<{ url: string; body: { samples: TelemetrySample[] } }>;
  observers: FakeObserver[];
  advance(ms: number): void;
  tick(): void;
  firePageHide(): void;
  get cancelled(): number;
}

function makeRig(): Rig {
  let nowMs = 0;
  let rafCb: ((t: number) => void) | null = null;
  let cancelled = 0;
  let pageHideCb: (() => void) | null = null;
  const requests: Array<{ url: string; body: { samples: TelemetrySample[] } }> = [];
  const observers: FakeObserver[] = [];

  class FakePerformanceObserver {
    type = '';
    disconnected = false;
    cb: (list: { getEntries: () => unknown[] }) => void;
    constructor(cb: (list: { getEntries: () => unknown[] }) => void) {
      this.cb = cb;
    }
    observe(options: { type: string }) {
      this.type = options.type;
      observers.push(this);
    }
    disconnect() {
      this.disconnected = true;
    }
  }

  const host: SimMonitorHost = {
    raf(cb) {
      rafCb = cb;
      return 1;
    },
    caf() {
      cancelled += 1;
      rafCb = null;
    },
    now: () => nowMs,
    fetchFn: async (url, init) => {
      requests.push({
        url,
        body: JSON.parse((init?.body as string) ?? '{}') as { samples: TelemetrySample[] },
      });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    },
    PerformanceObserver: FakePerformanceObserver as unknown as typeof PerformanceObserver,
    memory: () => ({ usedJSHeapSize: USED_HEAP, totalJSHeapSize: TOTAL_HEAP }),
    onPageHide(cb) {
      pageHideCb = cb;
    },
  };

  return {
    host,
    requests,
    observers,
    advance(ms) {
      nowMs += ms;
    },
    tick() {
      rafCb?.(nowMs);
    },
    firePageHide() {
      pageHideCb?.();
    },
    get cancelled() {
      return cancelled;
    },
  };
}

function samplesOf(rig: Rig, requestIndex = 0): TelemetrySample[] {
  return rig.requests[requestIndex]?.body.samples ?? [];
}

describe('SimMonitor · 前端埋点 SDK（M3）', () => {
  it('按采样窗口用 rAF 统计 FPS 并上报 render.fps', async () => {
    const rig = makeRig();
    const m = createSimMonitor(rig.host, { sampleIntervalMs: 1000, flushIntervalMs: 100_000 });
    m.start();

    // 模拟 60 帧 / ~1000ms（每帧约 16.67ms）
    for (let i = 0; i < 60; i++) {
      rig.advance(16.67);
      rig.tick();
    }

    await m.flush();
    const fps = samplesOf(rig).find((s) => s.name === FPS_METRIC);
    expect(fps).toBeDefined();
    expect(fps!.value).toBeGreaterThan(50);
    expect(fps!.value).toBeLessThan(70);
  });

  it('内存采样上报 memory.js_heap_used / memory.js_heap_total', async () => {
    const rig = makeRig();
    const m = createSimMonitor(rig.host, { sampleIntervalMs: 500, flushIntervalMs: 100_000 });
    m.start();

    rig.advance(500);
    rig.tick();

    await m.flush();
    const samples = samplesOf(rig);
    expect(samples).toContainEqual({ name: MEMORY_USED_METRIC, value: USED_HEAP });
    expect(samples).toContainEqual({ name: MEMORY_TOTAL_METRIC, value: TOTAL_HEAP });
  });

  it('PerformanceObserver 采 Web Vitals（LCP 取末次 / CLS 忽略 hadRecentInput 累积 / FID 首输入）', async () => {
    const rig = makeRig();
    const m = createSimMonitor(rig.host, { flushIntervalMs: 100_000 });
    m.start();

    expect(rig.observers.map((o) => o.type)).toEqual([
      'largest-contentful-paint',
      'layout-shift',
      'first-input',
    ]);

    rig.observers[0]!.cb({ getEntries: () => [{ startTime: 1234.5 }] });
    rig.observers[1]!.cb({
      getEntries: () => [
        { value: 0.05, hadRecentInput: false },
        { value: 0.1, hadRecentInput: true },
      ],
    });
    rig.observers[2]!.cb({ getEntries: () => [{ processingStart: 120, startTime: 100 }] });

    await m.flush();
    const samples = samplesOf(rig);
    expect(samples).toContainEqual({ name: LCP_METRIC, value: 1234.5 });
    expect(samples).toContainEqual({ name: CLS_METRIC, value: 0.05 });
    expect(samples).toContainEqual({ name: FID_METRIC, value: 20 });
  });

  it('样本数达到 flushSize 立即刷新', async () => {
    const rig = makeRig();
    const m = createSimMonitor(rig.host, { flushSize: 3, flushIntervalMs: 100_000 });
    m.start();

    m.report('custom.a', 1);
    m.report('custom.b', 2);
    expect(rig.requests.length).toBe(0);

    m.report('custom.c', 3); // 触发 size flush
    await m.flush();

    expect(rig.requests.length).toBe(1);
    expect(rig.requests[0]!.url).toBe('/telemetry');
    expect(samplesOf(rig).map((s) => s.name)).toEqual(['custom.a', 'custom.b', 'custom.c']);
  });

  it('达到 flushIntervalMs 周期自动 flush', async () => {
    const rig = makeRig();
    const m = createSimMonitor(rig.host, { flushIntervalMs: 1000, sampleIntervalMs: 100_000 });
    m.start();

    m.report('custom.x', 42);
    rig.advance(1000);
    rig.tick(); // 触发周期 flush

    await m.flush();
    expect(rig.requests.length).toBe(1);
    expect(samplesOf(rig)).toContainEqual({ name: 'custom.x', value: 42 });
  });

  it('上报失败静默丢弃并记 lastError，不抛异常', async () => {
    const rig = makeRig();
    const failing: SimMonitorHost = {
      ...rig.host,
      fetchFn: async () => {
        throw new Error('boom');
      },
    };
    const m = createSimMonitor(failing, { flushIntervalMs: 100_000 });
    m.start();

    m.report('custom.fail', 1);
    await m.flush();

    expect(m.stats.dropped).toBe(1);
    expect(m.stats.flushed).toBe(0);
    expect(m.stats.lastError).toBeInstanceOf(Error);
  });

  it('非 2xx 响应视为失败并丢弃', async () => {
    const rig = makeRig();
    const failing: SimMonitorHost = {
      ...rig.host,
      fetchFn: async () => new Response('not found', { status: 404 }),
    };
    const m = createSimMonitor(failing, { flushIntervalMs: 100_000 });
    m.start();

    m.report('custom.404', 1);
    await m.flush();

    expect(m.stats.dropped).toBe(1);
    expect(m.stats.lastError).toBeInstanceOf(Error);
  });

  it('stop 取消 rAF 并断开 PerformanceObserver，停止后不再采样', () => {
    const rig = makeRig();
    const m = createSimMonitor(rig.host, {});
    m.start();
    m.stop();

    expect(rig.cancelled).toBe(1);
    expect(rig.observers.length).toBeGreaterThan(0);
    expect(rig.observers.every((o) => o.disconnected)).toBe(true);

    rig.advance(1000);
    rig.tick(); // rafCb 已清空，no-op
    expect(m.stats.enqueued).toBe(0);
  });

  it('pagehide 触发最后一次 best-effort flush', async () => {
    const rig = makeRig();
    const m = createSimMonitor(rig.host, { flushIntervalMs: 100_000 });
    m.start();

    m.report('custom.pagehide', 7);
    rig.firePageHide();

    await m.flush();
    expect(rig.requests.length).toBe(1);
    expect(samplesOf(rig)).toContainEqual({ name: 'custom.pagehide', value: 7 });
  });

  it('非法样本值（非有限数）不入队', async () => {
    const rig = makeRig();
    const m = createSimMonitor(rig.host, { flushIntervalMs: 100_000 });
    m.start();

    m.report('custom.nan', Number.NaN);
    m.report('custom.inf', Number.POSITIVE_INFINITY);
    m.report('custom.ok', 1);

    await m.flush();
    expect(samplesOf(rig)).toEqual([{ name: 'custom.ok', value: 1 }]);
  });
});
