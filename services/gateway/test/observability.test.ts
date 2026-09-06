import { EventEmitter } from 'node:events';
import type { IncomingMessage } from 'node:http';
import { describe, expect, it } from 'vitest';
import {
  aggregateUpstreamMetrics,
  getOrCreateRequestId,
  readJsonBody,
  recordTelemetry,
  renderGatewayMetrics,
} from '../src/observability.js';

const makeReq = (headers: Record<string, string | string[] | undefined>): IncomingMessage =>
  ({ headers }) as unknown as IncomingMessage;

describe('getOrCreateRequestId', () => {
  it('采纳上游传入的 x-request-id', () => {
    expect(getOrCreateRequestId(makeReq({ 'x-request-id': 'req-abc' }))).toBe('req-abc');
  });

  it('数组头取第一个非空值', () => {
    expect(getOrCreateRequestId(makeReq({ 'x-request-id': ['req-first', 'req-second'] }))).toBe(
      'req-first',
    );
  });

  it('无头时自动生成非空 ID', () => {
    const id = getOrCreateRequestId(makeReq({}));
    expect(id.length).toBeGreaterThan(0);
  });
});

describe('recordTelemetry', () => {
  it('合法样本全部记录，返回条数', () => {
    const n = recordTelemetry([
      { name: 'FPS', value: 58.2 },
      { name: 'LCP', value: 2340 },
      { name: 'memoryUsedMB', value: 180 },
    ]);
    expect(n).toBe(3);
  });

  it('非法样本（value 非有限数 / name 非字符串）被丢弃', () => {
    const n = recordTelemetry([
      { name: 'FPS', value: Number.NaN },
      { name: 123, value: 10 },
      { name: 'LCP', value: Number.POSITIVE_INFINITY },
      { name: 'valid', value: 5 },
    ] as never[]);
    expect(n).toBe(1);
  });

  it('空数组返回 0', () => {
    expect(recordTelemetry([])).toBe(0);
  });
});

describe('aggregateUpstreamMetrics / renderGatewayMetrics', () => {
  it('为每份上游指标注入 service 标签', () => {
    const out = aggregateUpstreamMetrics([
      { service: 'assembly-svc', text: 'http_requests_total{method="GET"} 3\n' },
      { service: 'takt-svc', text: 'http_requests_total{method="GET"} 1\n' },
    ]);
    expect(out).toContain('http_requests_total{service="assembly-svc",method="GET"} 3');
    expect(out).toContain('http_requests_total{service="takt-svc",method="GET"} 1');
  });

  it('完整输出同时包含 gateway 自身指标与上游指标', () => {
    const text = renderGatewayMetrics([
      { service: 'assembly-svc', text: 'http_requests_total{method="GET"} 3\n' },
    ]);
    // gateway 自身指标头存在
    expect(text).toContain('# HELP http_requests_total');
    expect(text).toContain('# TYPE http_request_duration_seconds histogram');
    // 上游注入后的指标存在
    expect(text).toContain('http_requests_total{service="assembly-svc",method="GET"} 3');
  });
});

describe('readJsonBody', () => {
  it('合法 JSON 正常解析', async () => {
    const e = new EventEmitter();
    const req = e as unknown as IncomingMessage;
    const p = readJsonBody(req);
    e.emit('data', Buffer.from('{"samples":[{"name":"FPS","value":60}]}'));
    e.emit('end');
    const body = await p;
    expect(body).toEqual({ samples: [{ name: 'FPS', value: 60 }] });
  });

  it('非法 JSON 返回 null', async () => {
    const e = new EventEmitter();
    const req = e as unknown as IncomingMessage;
    const p = readJsonBody(req);
    e.emit('data', Buffer.from('not-json'));
    e.emit('end');
    expect(await p).toBeNull();
  });

  it('空 body 返回 null', async () => {
    const e = new EventEmitter();
    const req = e as unknown as IncomingMessage;
    const p = readJsonBody(req);
    e.emit('end');
    expect(await p).toBeNull();
  });
});
