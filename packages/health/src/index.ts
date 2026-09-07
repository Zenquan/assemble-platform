import type { FastifyInstance } from 'fastify';

/**
 * 健康检查共享库 —— liveness / readiness 双探针 + 优雅停机。
 *
 * 设计目标：让 5 个无状态后端服务用同一套口径暴露健康状态，并被
 * 任意编排器（CloudBase 云托管 / Docker / K8s）正确自愈与摘流：
 *
 *   - `/healthz`（liveness）：进程活着即 200，用于「该不该重启」。
 *   - `/readyz`（readiness）：依赖就绪才 200，用于「该不该接流量」。
 *
 * 优雅停机（graceful shutdown）顺序：
 *   1. 收到 SIGTERM / SIGINT；
 *   2. readiness 置为 down（/readyz 立刻返回 503，负载均衡停止派发新请求）；
 *   3. 等待在途请求 drain（上限 `drainTimeoutMs`）；
 *   4. `app.close()` 关闭监听与连接池；
 *   5. 超时兜底强退、正常完成以 0 退出。
 */

/** readiness 状态源：返回 true 表示「依赖就绪，可接流量」。 */
export type ReadinessProbe = () => boolean | Promise<boolean>;

export interface HealthOptions {
  /** 服务名，用于探针响应体与日志 */
  service: string;
  /** readiness 判定函数；缺省恒 true（无外部依赖的简单服务） */
  readiness?: ReadinessProbe;
}

export interface ReadinessState {
  /** 进程是否处于「可接流量」状态（优雅停机时被置 false） */
  ready: boolean;
  /** 将 readiness 置为 down（优雅停机第一步） */
  markNotReady: () => void;
}

/**
 * 各服务 `buildApp` 通过 `app.decorate('readinessState', state)` 注入，
 * 供 `server.ts` 取用做优雅停机。这里做 Fastify 实例类型增强。
 */
declare module 'fastify' {
  interface FastifyInstance {
    /** buildApp 注入的 readiness 状态（server.ts 优雅停机取用） */
    readinessState: ReadinessState;
  }
}

/**
 * 创建可变的 readiness 状态对象。
 * 优雅停机第一步调用 `markNotReady()`，使 /readyz 立即 503。
 */
export function createReadinessState(initial = true): ReadinessState {
  let ready = initial;
  return {
    get ready() {
      return ready;
    },
    markNotReady: () => {
      ready = false;
    },
  };
}

/**
 * 在 Fastify 实例上注册 `/healthz`（liveness）与 `/readyz`（readiness）双探针。
 *
 * - liveness：恒 200，进程活着即通过（编排器据此决定是否重启容器）。
 * - readiness：调用 `readiness()` 与 `ReadinessState.ready` 的合取；
 *   任一为 false → 503（编排器据此决定是否摘流）。
 */
export function registerHealthRoutes(
  app: FastifyInstance,
  opts: HealthOptions,
  state?: ReadinessState,
): void {
  const probe: ReadinessProbe = opts.readiness ?? (() => true);

  app.get('/healthz', async () => ({
    status: 'ok',
    service: opts.service,
    time: new Date().toISOString(),
  }));

  app.get('/readyz', async (_req, reply) => {
    const depsReady = await probe();
    const ready = depsReady && (state?.ready ?? true);
    const body = {
      status: ready ? 'ready' : 'not_ready',
      service: opts.service,
      ready,
      depsReady,
      time: new Date().toISOString(),
    };
    return reply.status(ready ? 200 : 503).send(body);
  });
}

export interface GracefulShutdownOptions {
  /** 等待在途请求排空的时长上限（ms），超时强退。默认 3000 */
  drainTimeoutMs?: number;
  /** 优雅停机日志钩子（服务侧接入自己的结构化日志） */
  log?: (msg: string) => void;
  /** 供测试注入「进程退出」动作，默认 process.exit */
  exit?: (code: number) => void;
  /** 供测试注入「注册信号处理器」的宿主，默认 process */
  onSignals?: (handler: () => void) => void;
}

/**
 * 安装 SIGTERM / SIGINT 优雅停机处理器。
 *
 * 返回一个 `shutdown()` 函数（供测试/主动调用）。处理器触发后：
 *   1. `state.markNotReady()` —— 立即使 /readyz 503，LB 停止派发；
 *   2. 等待 `drainTimeoutMs` 让在途请求完成；
 *   3. `app.close()` 优雅关闭；
 *   4. 成功退出 0；超时兜底退出 1。
 */
export function installGracefulShutdown(
  app: FastifyInstance,
  state: ReadinessState,
  opts: GracefulShutdownOptions = {},
): () => Promise<void> {
  const drainTimeoutMs = opts.drainTimeoutMs ?? 3_000;
  const log = opts.log ?? (() => {});
  const exit = opts.exit ?? ((code: number) => process.exit(code));
  const onSignals = opts.onSignals ?? ((handler) => {
    process.once('SIGTERM', handler);
    process.once('SIGINT', handler);
  });

  let shuttingDown = false;

  const shutdown = async (): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    log('收到停机信号，开始优雅停机（readiness → down，drain 在途请求）');
    state.markNotReady();

    let closed = false;
    // 兜底：超时仍未关完，强退
    const timer = setTimeout(() => {
      if (!closed) {
        log(`优雅停机超时（${drainTimeoutMs}ms），强制退出`);
        exit(1);
      }
    }, drainTimeoutMs);
    timer.unref?.();

    try {
      await app.close();
      closed = true;
      clearTimeout(timer);
      log('优雅停机完成，进程退出');
      exit(0);
    } catch (err) {
      clearTimeout(timer);
      log(`优雅停机出错：${err instanceof Error ? err.message : String(err)}`);
      exit(1);
    }
  };

  onSignals(() => {
    void shutdown();
  });

  return shutdown;
}

/**
 * 依赖可达性探针工厂：返回一个 `ReadinessProbe`，每次调用 GET 一次上游
 * `/healthz`，2xx 视为依赖就绪；网络错误/超时/非 2xx 视为不健康。
 *
 * 用于有外部依赖的服务（interference/takt 依赖 assembly-svc）——
 * 让 `/readyz` 真正反映「依赖是否可接流量」，而非进程活着即就绪。
 */
export function httpUpstreamProbe(
  url: string,
  fetchImpl: typeof fetch,
  timeoutMs = 2_000,
): ReadinessProbe {
  return async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url, { signal: controller.signal });
      return res.ok;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  };
}
