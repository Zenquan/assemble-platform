import { describe, expect, it } from 'vitest';
import {
  Counter,
  createHttpMetrics,
  createRequestId,
  DEFAULT_DURATION_BUCKETS,
  Histogram,
  injectServiceLabel,
  MetricsRegistry,
  REQUEST_ID_HEADER,
  renderPrometheusText,
} from '../src/index.js';

describe('Counter', () => {
  it('无 label 时累加到同一序列', () => {
    const c = new Counter('http_requests_total', 'help');
    c.inc();
    c.inc();
    c.inc({}, 3);
    const entries = c.entries();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.value).toBe(5);
  });

  it('不同 label 分到不同序列，同 label 累加', () => {
    const c = new Counter('http_requests_total', 'help');
    c.inc({ method: 'GET' });
    c.inc({ method: 'GET' });
    c.inc({ method: 'POST' });
    const byMethod = new Map(c.entries().map((e) => [e.labels.method, e.value]));
    expect(byMethod.get('GET')).toBe(2);
    expect(byMethod.get('POST')).toBe(1);
    expect(c.entries()).toHaveLength(2);
  });

  it('label 键顺序不影响序列归并', () => {
    const c = new Counter('x', 'help');
    c.inc({ a: '1', b: '2' });
    c.inc({ b: '2', a: '1' });
    expect(c.entries()).toHaveLength(1);
  });
});

describe('Histogram', () => {
  it('按升序桶累计计数，并统计 sum/count', () => {
    const h = new Histogram('dur', 'help', [0.5, 1, 2]);
    h.observe(0.3); // 命中 0.5/1/2 三个桶
    h.observe(0.7); // 命中 1/2
    h.observe(5); // 只命中 +Inf
    const e = h.entries()[0];
    expect(e).toBeDefined();
    expect(e!.count).toBe(3);
    expect(e!.sum).toBeCloseTo(6.0);
    expect(e!.bucketCounts).toEqual([1, 2, 2]);
  });

  it('乱序传入桶会先升序排列', () => {
    const h = new Histogram('dur', 'help', [2, 0.5, 1]);
    expect(h.buckets).toEqual([0.5, 1, 2]);
  });
});

describe('MetricsRegistry', () => {
  it('同名 counter/histogram 复用同一实例', () => {
    const r = new MetricsRegistry();
    const a = r.counter('http_requests_total', 'help');
    const b = r.counter('http_requests_total', 'other help');
    expect(a).toBe(b);
    expect(r.allCounters()).toHaveLength(1);
  });
});

describe('renderPrometheusText', () => {
  it('输出含 # HELP/# TYPE、counter 与 histogram 分桶', () => {
    const r = new MetricsRegistry();
    const http = createHttpMetrics(r);
    http.record(http.startRequest(), 'GET', '/lines', 200);
    http.record(http.startRequest(), 'POST', '/lines', 201);

    const text = renderPrometheusText(r);
    expect(text).toContain('# HELP http_requests_total');
    expect(text).toContain('# TYPE http_requests_total counter');
    expect(text).toContain('# TYPE http_request_duration_seconds histogram');
    expect(text).toContain('http_requests_total{method="GET",route="/lines",status="200"} 1');
    expect(text).toContain('http_request_duration_seconds_bucket');
    expect(text).toContain('http_request_duration_seconds_sum');
    expect(text).toContain('http_request_duration_seconds_count');
    expect(text).toContain('le="+Inf"');
  });

  it('DEFAULT_DURATION_BUCKETS 为升序', () => {
    const sorted = [...DEFAULT_DURATION_BUCKETS].sort((a, b) => a - b);
    expect(DEFAULT_DURATION_BUCKETS).toEqual(sorted);
  });
});

describe('injectServiceLabel', () => {
  it('为带 label 的 sample 行注入 service 标签', () => {
    const text =
      '# HELP http_requests_total Total\n' +
      '# TYPE http_requests_total counter\n' +
      'http_requests_total{method="GET",route="/lines",status="200"} 3\n';
    const out = injectServiceLabel(text, 'assembly-svc');
    expect(out).toContain('# HELP http_requests_total Total');
    expect(out).toContain(
      'http_requests_total{service="assembly-svc",method="GET",route="/lines",status="200"} 3',
    );
  });

  it('为无 label 的 sample 行补上 service 标签', () => {
    const text = 'some_gauge 42\n';
    const out = injectServiceLabel(text, 'takt-svc');
    expect(out).toContain('some_gauge{service="takt-svc"} 42');
  });

  it('注释行、空行、无法解析的行原样保留', () => {
    const text = '# TYPE x counter\n\nx 1\nnot-a-valid-line\n';
    const out = injectServiceLabel(text, 'svc');
    expect(out).toContain('# TYPE x counter');
    expect(out).toContain('\n\n');
    expect(out).toContain('x{service="svc"} 1');
    expect(out).toContain('not-a-valid-line');
  });

  it('转义 service 中的引号/反斜杠', () => {
    const out = injectServiceLabel('x 1\n', 'a"b\\c');
    expect(out).toContain('x{service="a\\"b\\\\c"} 1');
  });
});

describe('createRequestId', () => {
  it('生成非空且不同的 ID', () => {
    const a = createRequestId();
    const b = createRequestId();
    expect(a.length).toBeGreaterThan(0);
    expect(a).not.toBe(b);
  });

  it('统一透传头名', () => {
    expect(REQUEST_ID_HEADER).toBe('x-request-id');
  });
});
