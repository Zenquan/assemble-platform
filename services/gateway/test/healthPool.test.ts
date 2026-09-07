import { describe, expect, it } from 'vitest';
import { UpstreamHealthPool, type TargetProbe } from '../src/healthPool.js';

function probeOf(map: Record<string, boolean>): TargetProbe {
  return async (host, port) => map[`${host}:${port}`] ?? false;
}

describe('UpstreamHealthPool', () => {
  it('pick 轮询返回健康目标并循环', () => {
    const pool = new UpstreamHealthPool(probeOf({}));
    pool.add('assembly-svc', '127.0.0.1', 7101);
    pool.add('assembly-svc', '127.0.0.1', 7102);

    expect(pool.pick('assembly-svc')?.port).toBe(7101);
    expect(pool.pick('assembly-svc')?.port).toBe(7102);
    expect(pool.pick('assembly-svc')?.port).toBe(7101); // 回到队首（轮询）
  });

  it('同地址重复 add 幂等去重', () => {
    const pool = new UpstreamHealthPool(probeOf({}));
    pool.add('auth-svc', '127.0.0.1', 7105);
    pool.add('auth-svc', '127.0.0.1', 7105);
    expect(pool.targets('auth-svc')).toHaveLength(1);
  });

  it('全部目标不健康时 pick 返回 undefined', () => {
    const pool = new UpstreamHealthPool(probeOf({}));
    pool.add('model-svc', '127.0.0.1', 7103);
    pool.markUnhealthy('model-svc', '127.0.0.1', 7103, 'ECONNREFUSED');
    expect(pool.pick('model-svc')).toBeUndefined();
  });

  it('摘流后 skip 不健康目标，只轮询健康目标', () => {
    const pool = new UpstreamHealthPool(probeOf({}));
    pool.add('takt-svc', '127.0.0.1', 7104);
    pool.add('takt-svc', '127.0.0.1', 7105);
    pool.markUnhealthy('takt-svc', '127.0.0.1', 7104, 'timeout');

    // 只剩 7105 健康，轮询始终返回它
    expect(pool.pick('takt-svc')?.port).toBe(7105);
    expect(pool.pick('takt-svc')?.port).toBe(7105);
  });

  it('refresh 恢复可达目标为健康并清空 lastError', async () => {
    const pool = new UpstreamHealthPool(
      probeOf({ '127.0.0.1:7101': true, '127.0.0.1:7102': false }),
    );
    pool.add('assembly-svc', '127.0.0.1', 7101);
    pool.add('assembly-svc', '127.0.0.1', 7102);
    pool.markUnhealthy('assembly-svc', '127.0.0.1', 7101, 'ECONNREFUSED');
    pool.markUnhealthy('assembly-svc', '127.0.0.1', 7102, 'ECONNREFUSED');

    await pool.refresh();

    const t1 = pool.targets('assembly-svc').find((t) => t.port === 7101);
    const t2 = pool.targets('assembly-svc').find((t) => t.port === 7102);
    expect(t1?.healthy).toBe(true);
    expect(t1?.lastError).toBeUndefined();
    expect(t2?.healthy).toBe(false); // 仍不可达，保持不健康
  });

  it('snapshot 返回所有服务与目标状态', async () => {
    const pool = new UpstreamHealthPool(probeOf({ '127.0.0.1:7101': true }));
    pool.add('assembly-svc', '127.0.0.1', 7101);
    await pool.refresh();

    const snap = pool.snapshot();
    expect(snap).toHaveLength(1);
    expect(snap[0]).toMatchObject({
      service: 'assembly-svc',
      target: { host: '127.0.0.1', port: 7101, healthy: true },
    });
  });
});
