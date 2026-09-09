/**
 * SimMonitor 类型契约 —— M4「监控与可观测性」方向 M3 前端埋点 SDK 的公开面。
 *
 * 与后端 `services/gateway/src/observability.ts` 的 `TelemetrySample` 保持同名同构：
 * `{ name, value }`，由 gateway `/telemetry` 接收并内存聚合（Prometheus 直方图）。
 */

/** 一条 telemetry 样本（上报到 gateway /telemetry 的最小单元） */
export interface TelemetrySample {
  name: string;
  value: number;
}

/** SimMonitor 配置（均有默认值，可全部省略） */
export interface SimMonitorOptions {
  /** 上报端点（同源 gateway /telemetry），默认 '/telemetry' */
  endpoint?: string;
  /** 批量刷新的最小时间间隔 ms，默认 5000 */
  flushIntervalMs?: number;
  /** 触发立即刷新的样本数阈值，默认 100 */
  flushSize?: number;
  /** FPS / 内存的采样窗口 ms，默认 1000 */
  sampleIntervalMs?: number;
}

/**
 * 浏览器宿主抽象 —— 把 DOM/浏览器 API 收敛成窄接口，让核心编排逻辑
 * （simMonitor.ts）保持纯函数、可在 node 环境用假宿主单测，而 host.ts 负责真实绑定。
 */
export interface SimMonitorHost {
  /** requestAnimationFrame（无则回退 setTimeout），返回句柄 */
  raf(cb: (timestamp: number) => void): number;
  /** cancelAnimationFrame */
  caf(handle: number): void;
  /** 高精度时间戳 ms（默认 performance.now） */
  now(): number;
  /** fetch 实现（上报用） */
  fetchFn(input: string, init?: RequestInit): Promise<Response>;
  /** PerformanceObserver 构造器（可选，不支持则跳过 Web Vitals） */
  PerformanceObserver?: typeof PerformanceObserver;
  /** 读取内存信息（可选，Chrome-only，无则跳过内存采样） */
  memory?(): { usedJSHeapSize: number; totalJSHeapSize: number } | null;
  /** 注册页面隐藏回调（可选，用于卸载前最后一次 best-effort flush） */
  onPageHide?(cb: () => void): void;
}

/** 只读运行统计（供测试/诊断读取） */
export interface SimMonitorStats {
  /** 累计入队样本数 */
  enqueued: number;
  /** 累计成功上报样本数 */
  flushed: number;
  /** 累计因失败丢弃样本数 */
  dropped: number;
  /** 成功 flush 批次数 */
  batches: number;
  /** 最近一次 flush 错误（无则为 null） */
  lastError: unknown;
}

/** 最新一次采样到的实时指标快照（供性能页订阅展示，不依赖上报链路） */
export interface SimMonitorSnapshot {
  /** 最近采样窗口的帧率 */
  fps: number;
  /** 最近 N 个采样窗口的平均帧率（滚动平滑，抗瞬时抖动） */
  fpsAvg: number;
  /** JS 堆已用字节（Chrome 才有，否则 0） */
  jsHeapUsed: number;
  /** 最近 N 个采样窗口的平均已用堆（滚动平滑） */
  jsHeapUsedAvg: number;
  /** JS 堆总量字节 */
  jsHeapTotal: number;
  /** 最近 N 个采样窗口的平均总堆（滚动平滑） */
  jsHeapTotalAvg: number;
  /** LCP ms（首屏最大内容元素渲染耗时，一次性指标；未观测到为 0） */
  lcp: number;
  /** 累计布局偏移（首屏加载指标；未观测到为 0） */
  cls: number;
  /** FID ms（首屏首次输入延迟，一次性指标；未观测到为 0） */
  fid: number;
}

/** 实时快照监听器（采样窗口到期即回调最新快照） */
export type SimMonitorListener = (snapshot: SimMonitorSnapshot) => void;

/** SimMonitor 实例句柄 */
export interface SimMonitor {
  /** 启动采集（幂等） */
  start(): void;
  /** 停止采集：取消 rAF、断开 observers（幂等） */
  stop(): void;
  /** 手动上报一条额外样本（供引擎等宿主数据接入） */
  report(name: string, value: number): void;
  /** 立即刷新缓冲（复用进行中的 flush，避免并发） */
  flush(): Promise<void>;
  /** 只读运行统计快照 */
  readonly stats: SimMonitorStats;
  /** 订阅实时指标快照，返回取消订阅函数（性能页/诊断面板用） */
  subscribe(listener: SimMonitorListener): () => void;
  /** 最近一次实时指标快照 */
  readonly snapshot: SimMonitorSnapshot;
}
