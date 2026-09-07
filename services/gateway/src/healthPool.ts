/**
 * 上游健康池 —— gateway 反向代理的多副本地址管理（摘流 / 恢复 / 轮询选址）。
 *
 * 每个服务（assembly-svc / interference-svc / model-svc / takt-svc / auth-svc）
 * 可对应一个或多个上游目标（`UpstreamTarget`，形如 `host:port`）。本模块是纯逻辑
 * （探针通过构造注入），不依赖 node:http 连接语义，便于单测：
 *
 *   - `add(service, host, port)`  注册目标（幂等，同一地址去重）
 *   - `pick(service)`             轮询返回一个「健康」目标；全不健康返回 undefined
 *   - `markUnhealthy(...)`        转发失败后摘流该目标
 *   - `refresh()`                 探测所有目标，恢复的重新置健康（failover 恢复）
 *   - `snapshot()`                诊断快照（供 /healthz 聚合与日志）
 */
export interface UpstreamTarget {
  host: string;
  port: number;
  healthy: boolean;
  /** 最近一次判定不健康的原因 */
  lastError?: string;
  /** 最近一次探活时间戳（ms） */
  lastCheckAt?: number;
}

/** 目标探活：host:port 可达且 /healthz 2xx 返回 true */
export type TargetProbe = (host: string, port: number) => Promise<boolean>;

export class UpstreamHealthPool {
  private readonly pools = new Map<string, UpstreamTarget[]>();
  private readonly roundRobin = new Map<string, number>();

  constructor(private readonly probe: TargetProbe) {}

  /** 注册一个上游目标；同 host:port 幂等去重 */
  add(service: string, host: string, port: number): void {
    const list = this.pools.get(service) ?? [];
    if (!list.some((t) => t.host === host && t.port === port)) {
      list.push({ host, port, healthy: true });
    }
    this.pools.set(service, list);
  }

  /** 某服务的全部目标（只读） */
  targets(service: string): readonly UpstreamTarget[] {
    return this.pools.get(service) ?? [];
  }

  /** 轮询返回一个健康目标；无健康目标返回 undefined（调用方据此 502） */
  pick(service: string): UpstreamTarget | undefined {
    const list = this.pools.get(service);
    if (!list || list.length === 0) return undefined;
    const healthy = list.filter((t) => t.healthy);
    if (healthy.length === 0) return undefined;
    const n = this.roundRobin.get(service) ?? 0;
    const target = healthy[n % healthy.length];
    this.roundRobin.set(service, n + 1);
    return target;
  }

  /** 摘流：转发失败时标记目标不健康并记录原因 */
  markUnhealthy(service: string, host: string, port: number, error: string): void {
    const target = this.pools.get(service)?.find((t) => t.host === host && t.port === port);
    if (target) {
      target.healthy = false;
      target.lastError = error;
    }
  }

  /** 探测所有目标并更新健康状态（恢复的目标重新 healthy=true） */
  async refresh(): Promise<void> {
    const tasks: Array<Promise<void>> = [];
    for (const [service, list] of this.pools) {
      for (const target of list) {
        tasks.push(
          this.probe(target.host, target.port).then((ok) => {
            target.healthy = ok;
            target.lastCheckAt = Date.now();
            if (ok) target.lastError = undefined;
          }),
        );
      }
    }
    await Promise.all(tasks);
  }

  /** 诊断快照：所有服务及其目标状态 */
  snapshot(): Array<{ service: string; target: UpstreamTarget }> {
    const out: Array<{ service: string; target: UpstreamTarget }> = [];
    for (const [service, list] of this.pools) {
      for (const target of list) out.push({ service, target });
    }
    return out;
  }
}
