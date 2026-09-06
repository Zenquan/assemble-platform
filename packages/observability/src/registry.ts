/**
 * 内存指标注册表：Counter（计数）与 Histogram（分桶分布）。
 *
 * 纯 TS、无 Node/DOM 依赖，浏览器与后端同源可用。series 以「排序后的 label
 * 键值」为 key 分桶，保证同一组 label 始终聚合到同一序列。
 */

export type Labels = Readonly<Record<string, string>>;

/** 把 labels 规范化成稳定 key（键排序），用于 Map 分桶 */
function labelsKey(labels: Labels): string {
  const keys = Object.keys(labels).sort();
  if (keys.length === 0) return '';
  return keys.map((k) => `${k}=${labels[k] ?? ''}`).join('\u0000');
}

export interface CounterEntry {
  labels: Labels;
  value: number;
}

/** 单调递增计数器，支持带 label 的多序列 */
export class Counter {
  readonly name: string;
  readonly help: string;
  private series = new Map<string, CounterEntry>();

  constructor(name: string, help: string) {
    this.name = name;
    this.help = help;
  }

  inc(labels: Labels = {}, by = 1): void {
    const key = labelsKey(labels);
    const existing = this.series.get(key);
    if (existing) {
      existing.value += by;
    } else {
      this.series.set(key, { labels: { ...labels }, value: by });
    }
  }

  /** 返回序列快照，供序列化消费 */
  entries(): CounterEntry[] {
    return [...this.series.values()];
  }
}

export interface HistogramEntry {
  labels: Labels;
  sum: number;
  count: number;
  /** 累计桶计数（bucketCounts[i] = 观察值 ≤ buckets[i] 的次数） */
  bucketCounts: number[];
}

/** 分桶直方图：统计观察值的分布（桶为升序、累计计数） */
export class Histogram {
  readonly name: string;
  readonly help: string;
  readonly buckets: readonly number[];
  private series = new Map<string, HistogramEntry>();

  constructor(name: string, help: string, buckets: readonly number[]) {
    this.name = name;
    this.help = help;
    this.buckets = [...buckets].sort((a, b) => a - b);
  }

  observe(value: number, labels: Labels = {}): void {
    const key = labelsKey(labels);
    let entry = this.series.get(key);
    if (!entry) {
      entry = {
        labels: { ...labels },
        sum: 0,
        count: 0,
        bucketCounts: new Array<number>(this.buckets.length).fill(0),
      };
      this.series.set(key, entry);
    }
    entry.sum += value;
    entry.count += 1;
    for (let i = 0; i < this.buckets.length; i++) {
      const upper = this.buckets[i];
      if (upper !== undefined && value <= upper) {
        entry.bucketCounts[i] = (entry.bucketCounts[i] ?? 0) + 1;
      }
    }
  }

  /** 返回序列快照，供序列化消费 */
  entries(): HistogramEntry[] {
    return [...this.series.values()];
  }
}

export class MetricsRegistry {
  private counters = new Map<string, Counter>();
  private histograms = new Map<string, Histogram>();

  /** 取（或注册）一个 Counter；同名复用同一实例 */
  counter(name: string, help: string): Counter {
    const existing = this.counters.get(name);
    if (existing) return existing;
    const c = new Counter(name, help);
    this.counters.set(name, c);
    return c;
  }

  /** 取（或注册）一个 Histogram；同名复用同一实例 */
  histogram(name: string, help: string, buckets: readonly number[]): Histogram {
    const existing = this.histograms.get(name);
    if (existing) return existing;
    const h = new Histogram(name, help, buckets);
    this.histograms.set(name, h);
    return h;
  }

  allCounters(): Counter[] {
    return [...this.counters.values()];
  }

  allHistograms(): Histogram[] {
    return [...this.histograms.values()];
  }
}
