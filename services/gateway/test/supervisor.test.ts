import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  UpstreamSupervisor,
  backoffDelayMs,
  type SpawnFn,
  type SupervisedService,
} from '../src/supervisor.js';

/** 伪子进程：EventEmitter + pid + kill，可手动 emit('exit') 模拟退出 */
class FakeChild extends EventEmitter {
  pid = 4242;
  kill = vi.fn();
}

interface SpawnHarness {
  calls: SupervisedService[];
  children: FakeChild[];
  spawnFn: SpawnFn;
}

function makeSpawn(): SpawnHarness {
  const calls: SupervisedService[] = [];
  const children: FakeChild[] = [];
  const spawnFn: SpawnFn = (service) => {
    calls.push(service);
    const child = new FakeChild();
    children.push(child);
    return child as unknown as ChildProcess;
  };
  return { calls, children, spawnFn };
}

const SVC_A: SupervisedService = { service: 'assembly-svc', port: 7101, serverJsRelative: '../a.js' };
const SVC_B: SupervisedService = { service: 'model-svc', port: 7103, serverJsRelative: '../b.js' };

describe('backoffDelayMs', () => {
  it('首次尝试返回基数', () => {
    expect(backoffDelayMs(0, 500, 15_000)).toBe(500);
  });

  it('按 2^attempt 指数增长', () => {
    expect(backoffDelayMs(0, 500, 15_000)).toBe(500);
    expect(backoffDelayMs(1, 500, 15_000)).toBe(1000);
    expect(backoffDelayMs(2, 500, 15_000)).toBe(2000);
    expect(backoffDelayMs(3, 500, 15_000)).toBe(4000);
  });

  it('封顶 maxMs', () => {
    expect(backoffDelayMs(10, 500, 15_000)).toBe(15_000);
    expect(backoffDelayMs(20, 500, 15_000)).toBe(15_000);
  });
});

describe('UpstreamSupervisor', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('start 为每个服务 spawn 一次', () => {
    const { calls, spawnFn } = makeSpawn();
    const sup = new UpstreamSupervisor([SVC_A, SVC_B], spawnFn);
    sup.start();
    expect(calls.map((s) => s.service)).toEqual(['assembly-svc', 'model-svc']);
  });

  it('子进程退出后按退避延迟重启', () => {
    const { calls, children, spawnFn } = makeSpawn();
    const onEvent = vi.fn();
    const sup = new UpstreamSupervisor([SVC_A], spawnFn, { onEvent });
    sup.start();
    expect(calls).toHaveLength(1);

    // 触发退出 → 应调度重启
    children[0]?.emit('exit', 1, null);
    expect(calls).toHaveLength(1); // 尚未到重启时间
    vi.advanceTimersByTime(500);
    expect(calls).toHaveLength(2); // 第一次退避 500ms 后重启

    // 再次退出 → 第二次退避 1000ms
    children[1]?.emit('exit', 1, null);
    vi.advanceTimersByTime(1000);
    expect(calls).toHaveLength(3);
  });

  it('达到 maxRestarts 后放弃重启', () => {
    const { calls, children, spawnFn } = makeSpawn();
    const onEvent = vi.fn();
    const sup = new UpstreamSupervisor([SVC_A], spawnFn, { maxRestarts: 2, onEvent });
    sup.start();
    expect(calls).toHaveLength(1);

    // 连续退出 3 次：前 2 次重启，第 3 次超限放弃
    for (let i = 0; i < 3; i++) {
      const child = children[children.length - 1];
      child?.emit('exit', 1, null);
      vi.advanceTimersByTime(1_000_000);
    }
    // 初始 1 次 + 2 次重启 = 3 次 spawn
    expect(calls).toHaveLength(3);
    expect(onEvent).toHaveBeenCalledWith('warn', 'assembly-svc 重启次数超限，放弃自愈', expect.anything());
  });

  it('stopAll 后不再重启且 SIGTERM 存活子进程', () => {
    const { calls, children, spawnFn } = makeSpawn();
    const sup = new UpstreamSupervisor([SVC_A, SVC_B], spawnFn);
    sup.start();
    expect(children).toHaveLength(2);

    sup.stopAll();
    expect(children[0]?.kill).toHaveBeenCalledWith('SIGTERM');
    expect(children[1]?.kill).toHaveBeenCalledWith('SIGTERM');

    // stopAll 后触发退出不应再调度重启
    children[0]?.emit('exit', 0, 'SIGTERM');
    vi.advanceTimersByTime(1_000_000);
    expect(calls).toHaveLength(2);
  });

  it('spawn 抛错时退避重试而非崩溃', () => {
    const spawnFn: SpawnFn = vi.fn((service: SupervisedService) => {
      throw new Error(`boom ${service.service}`);
    }) as unknown as SpawnFn;
    const onEvent = vi.fn();
    const sup = new UpstreamSupervisor([SVC_A], spawnFn, { onEvent });
    sup.start();
    expect(spawnFn).toHaveBeenCalledTimes(1);
    // 首次失败 → 退避后重试
    vi.advanceTimersByTime(500);
    expect(spawnFn).toHaveBeenCalledTimes(2);
  });
});
