import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import {
  createReadinessState,
  httpUpstreamProbe,
  installGracefulShutdown,
  registerHealthRoutes,
} from '../src/index.js';

async function buildTestApp(readiness?: () => boolean | Promise<boolean>) {
  const app = Fastify({ logger: false });
  const state = createReadinessState(true);
  registerHealthRoutes(app, { service: 'test-svc', readiness }, state);
  return { app, state };
}

describe('registerHealthRoutes 双探针', () => {
  it('liveness /healthz 恒 200 且含 service', async () => {
    const { app } = await buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { status: string; service: string };
    expect(body.status).toBe('ok');
    expect(body.service).toBe('test-svc');
  });

  it('readiness /readyz 依赖就绪时 200 ready', async () => {
    const { app } = await buildTestApp(() => true);
    const res = await app.inject({ method: 'GET', url: '/readyz' });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { ready: boolean }).ready).toBe(true);
  });

  it('readiness /readyz 依赖不健康时 503 not_ready', async () => {
    const { app } = await buildTestApp(() => false);
    const res = await app.inject({ method: 'GET', url: '/readyz' });
    expect(res.statusCode).toBe(503);
    const body = res.json() as { ready: boolean; depsReady: boolean };
    expect(body.ready).toBe(false);
    expect(body.depsReady).toBe(false);
  });

  it('markNotReady 后 /readyz 立即 503（即使依赖仍健康）', async () => {
    const { app, state } = await buildTestApp(() => true);
    state.markNotReady();
    const res = await app.inject({ method: 'GET', url: '/readyz' });
    expect(res.statusCode).toBe(503);
    expect((res.json() as { ready: boolean }).ready).toBe(false);
  });

  it('缺省 readiness（无外部依赖）时 /readyz 恒 200', async () => {
    const app = Fastify({ logger: false });
    registerHealthRoutes(app, { service: 'simple-svc' });
    const res = await app.inject({ method: 'GET', url: '/readyz' });
    expect(res.statusCode).toBe(200);
  });
});

describe('installGracefulShutdown 优雅停机', () => {
  it('触发 shutdown → markNotReady + app.close + exit(0)', async () => {
    const { app, state } = await buildTestApp();
    const exit = vi.fn();
    const log = vi.fn();
    let signalHandler: (() => void) | undefined;
    installGracefulShutdown(app, state, {
      drainTimeoutMs: 50,
      exit,
      log,
      onSignals: (h) => {
        signalHandler = h;
      },
    });

    signalHandler?.();
    await vi.waitFor(() => expect(exit).toHaveBeenCalled());
    expect(exit).toHaveBeenCalledWith(0);
    expect(state.ready).toBe(false);
    expect(log).toHaveBeenCalled();
  });

  it('重复触发 shutdown 只执行一次（幂等）', async () => {
    const { app, state } = await buildTestApp();
    const exit = vi.fn();
    let signalHandler: (() => void) | undefined;
    const shutdown = installGracefulShutdown(app, state, {
      drainTimeoutMs: 50,
      exit,
      onSignals: (h) => {
        signalHandler = h;
      },
    });
    signalHandler?.();
    await shutdown();
    await vi.waitFor(() => expect(exit).toHaveBeenCalled());
    expect(exit).toHaveBeenCalledTimes(1);
  });

  it('close 挂起时超时兜底 exit(1)', async () => {
    const app = Fastify({ logger: false });
    const state = createReadinessState(true);
    // mock close 永不 resolve，验证 drainTimeoutMs 超时后强退
    vi.spyOn(app, 'close').mockImplementation(() => new Promise(() => {}));
    const exit = vi.fn();
    const shutdown = installGracefulShutdown(app, state, { drainTimeoutMs: 20, exit });
    // app.close 永不 resolve，shutdown 靠超时兜底 exit(1)；不 await 避免挂起
    void shutdown();
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1), { timeout: 1000 });
  });
});

describe('httpUpstreamProbe 依赖可达性探针', () => {
  it('上游 2xx 视为就绪', async () => {
    const fetchImpl = (async () =>
      new Response('ok', { status: 200 })) as unknown as typeof fetch;
    const probe = httpUpstreamProbe('http://upstream/healthz', fetchImpl);
    await expect(probe()).resolves.toBe(true);
  });

  it('上游非 2xx 视为不健康', async () => {
    const fetchImpl = (async () =>
      new Response('down', { status: 503 })) as unknown as typeof fetch;
    const probe = httpUpstreamProbe('http://upstream/healthz', fetchImpl);
    await expect(probe()).resolves.toBe(false);
  });

  it('网络错误/超时视为不健康', async () => {
    const fetchImpl = (async () => {
      throw new Error('connection refused');
    }) as unknown as typeof fetch;
    const probe = httpUpstreamProbe('http://upstream/healthz', fetchImpl, 50);
    await expect(probe()).resolves.toBe(false);
  });
});
