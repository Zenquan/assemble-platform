/**
 * 上游子进程监管器 —— 单容器部署形态下的本地后端进程编排。
 *
 * 负责：
 *   - spawn 各后端服务子进程（保持服务边界与独立 dist 产物）；
 *   - 子进程异常退出 → 指数退避重启（替代 `process.exit(1)` 整体崩溃，单机自愈）；
 *   - `stopAll()` 优雅关闭传播：停止重启 + SIGTERM 存活子进程。
 *
 * spawn 通过构造注入（`SpawnFn`），退避延迟抽成纯函数 `backoffDelayMs`，两者均可单测。
 */
import type { ChildProcess } from 'node:child_process';

/** 被监管的服务（spawn 配置） */
export interface SupervisedService {
  service: string;
  port: number;
  /** 该服务 dist/server.js 相对 gateway dist 目录的路径 */
  serverJsRelative: string;
}

/** 注入的 spawn 工厂：返回已启动的子进程句柄（测试可替换为伪 ChildProcess） */
export type SpawnFn = (service: SupervisedService) => ChildProcess;

/** 事件日志回调（可选）：level + 消息 + 附加字段 */
export type SupervisorLogFn = (
  level: 'info' | 'warn',
  msg: string,
  extra?: Record<string, unknown>,
) => void;

export interface SupervisorOptions {
  /** 退避基数（ms，默认 500） */
  baseDelayMs?: number;
  /** 退避上限（ms，默认 15000） */
  maxDelayMs?: number;
  /** 单服务连续重启上限（默认 10）；超过即放弃自愈，保持退出交给容器重启策略 */
  maxRestarts?: number;
  /** 事件日志回调 */
  onEvent?: SupervisorLogFn;
}

/**
 * 指数退避延迟：`attempt` 从 0 起，`base * 2^attempt`，封顶 `maxMs`。
 * 纯函数，便于单测退避曲线。
 */
export function backoffDelayMs(attempt: number, baseMs: number, maxMs: number): number {
  return Math.min(baseMs * 2 ** attempt, maxMs);
}

export class UpstreamSupervisor {
  private readonly children = new Map<string, ChildProcess>();
  private readonly restarts = new Map<string, number>();
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private stopped = false;

  constructor(
    private readonly services: readonly SupervisedService[],
    private readonly spawnFn: SpawnFn,
    private readonly opts: SupervisorOptions = {},
  ) {}

  /** 启动全部服务子进程 */
  start(): void {
    for (const service of this.services) this.launch(service);
  }

  /** 优雅关闭传播：停止后续重启，SIGTERM 所有存活子进程 */
  stopAll(): void {
    this.stopped = true;
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    for (const child of this.children.values()) child.kill('SIGTERM');
  }

  private launch(service: SupervisedService): void {
    if (this.stopped) return;
    let child: ChildProcess;
    try {
      child = this.spawnFn(service);
    } catch (err) {
      this.opts.onEvent?.('warn', `${service.service} spawn failed`, {
        error: err instanceof Error ? err.message : String(err),
      });
      this.scheduleRestart(service);
      return;
    }
    this.children.set(service.service, child);
    this.opts.onEvent?.('info', `spawned ${service.service}`, {
      pid: child.pid,
      port: service.port,
    });
    child.on('exit', (code, signal) => {
      this.children.delete(service.service);
      if (this.stopped) return;
      this.opts.onEvent?.('warn', `${service.service} exited`, {
        code: code ?? null,
        signal: signal ?? null,
      });
      this.scheduleRestart(service);
    });
  }

  private scheduleRestart(service: SupervisedService): void {
    if (this.stopped) return;
    const restarts = this.restarts.get(service.service) ?? 0;
    if (restarts >= (this.opts.maxRestarts ?? 10)) {
      this.opts.onEvent?.('warn', `${service.service} 重启次数超限，放弃自愈`, { restarts });
      return;
    }
    this.restarts.set(service.service, restarts + 1);
    const delay = backoffDelayMs(
      restarts,
      this.opts.baseDelayMs ?? 500,
      this.opts.maxDelayMs ?? 15_000,
    );
    this.opts.onEvent?.('warn', `${service.service} 退避重启`, {
      attempt: restarts + 1,
      delayMs: delay,
    });
    const timer = setTimeout(() => {
      this.timers.delete(service.service);
      this.launch(service);
    }, delay);
    this.timers.set(service.service, timer);
  }
}
