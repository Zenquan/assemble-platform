import { describe, expect, it } from 'vitest';
import {
  GATEWAY_OWN_PATHS,
  matchRoute,
  parseUpstreamTargets,
  resolveUpstreams,
  SERVICE_ROUTES,
  UPSTREAM_SERVICES,
} from '../src/routing.js';

describe('matchRoute', () => {
  it('精确前缀命中', () => {
    expect(matchRoute('/lines')?.service).toBe('assembly-svc');
    expect(matchRoute('/interference')?.service).toBe('interference-svc');
    expect(matchRoute('/model')?.service).toBe('model-svc');
    expect(matchRoute('/takt')?.service).toBe('takt-svc');
    expect(matchRoute('/auth')?.service).toBe('auth-svc');
    expect(matchRoute('/audit')?.service).toBe('auth-svc');
  });

  it('前缀后跟子路径命中', () => {
    expect(matchRoute('/lines/fresh-cut-01')?.port).toBe(7101);
    expect(matchRoute('/model/glb/conveyor.glb')?.port).toBe(7103);
    expect(matchRoute('/takt/simulate')?.port).toBe(7104);
  });

  it('相似前缀不误吞（/linesx 不命中 /lines）', () => {
    expect(matchRoute('/linesx')).toBeUndefined();
    expect(matchRoute('/modelx')).toBeUndefined();
    expect(matchRoute('/taktix')).toBeUndefined();
  });

  it('无前缀路径返回 undefined', () => {
    expect(matchRoute('/healthz')).toBeUndefined();
    expect(matchRoute('/assets/index.js')).toBeUndefined();
    expect(matchRoute('/')).toBeUndefined();
  });
});

describe('路由表一致性', () => {
  it('路由端口与上游服务清单一一对应', () => {
    const routePorts = new Set(SERVICE_ROUTES.map((r) => r.port));
    const upstreamPorts = new Set(UPSTREAM_SERVICES.map((s) => s.port));
    expect(routePorts).toEqual(upstreamPorts);
  });

  it('路由表中的服务名都出现在上游清单中', () => {
    const upstreamServices = new Set(UPSTREAM_SERVICES.map((s) => s.service));
    for (const route of SERVICE_ROUTES) {
      expect(upstreamServices.has(route.service)).toBe(true);
    }
  });
});

describe('网关自有路径', () => {
  it('/healthz 由网关自己应答', () => {
    expect(GATEWAY_OWN_PATHS).toContain('/healthz');
  });
});

describe('parseUpstreamTargets', () => {
  it('解析逗号分隔的 service=host:port，同名多副本保留', () => {
    const targets = parseUpstreamTargets(
      'assembly-svc=127.0.0.1:7101,assembly-svc=127.0.0.1:7111,model-svc=10.0.0.5:7103',
    );
    expect(targets).toEqual([
      { service: 'assembly-svc', host: '127.0.0.1', port: 7101 },
      { service: 'assembly-svc', host: '127.0.0.1', port: 7111 },
      { service: 'model-svc', host: '10.0.0.5', port: 7103 },
    ]);
  });

  it('空串 / undefined 返回空数组', () => {
    expect(parseUpstreamTargets(undefined)).toEqual([]);
    expect(parseUpstreamTargets('')).toEqual([]);
    expect(parseUpstreamTargets('   ')).toEqual([]);
  });

  it('非法条目（缺 =、非法端口、空 host/service）静默跳过', () => {
    const targets = parseUpstreamTargets(
      'assembly-svc=127.0.0.1:7101,bad-entry,model-svc=:7103,takt-svc=127.0.0.1:notaport,=1.2.3.4:7104',
    );
    expect(targets).toEqual([{ service: 'assembly-svc', host: '127.0.0.1', port: 7101 }]);
  });
});

describe('resolveUpstreams', () => {
  it('未配置时回退单副本 127.0.0.1:7101–7105 且 spawnLocal=true', () => {
    const { targets, spawnLocal } = resolveUpstreams(undefined);
    expect(spawnLocal).toBe(true);
    expect(targets.map((t) => t.port)).toEqual([7101, 7102, 7103, 7104, 7105]);
    expect(targets.every((t) => t.host === '127.0.0.1')).toBe(true);
    expect(targets.map((t) => t.service)).toEqual([
      'assembly-svc',
      'interference-svc',
      'model-svc',
      'takt-svc',
      'auth-svc',
    ]);
  });

  it('显式配置时原样使用且 spawnLocal=false', () => {
    const { targets, spawnLocal } = resolveUpstreams(
      'assembly-svc=10.0.0.1:7101,assembly-svc=10.0.0.2:7101',
    );
    expect(spawnLocal).toBe(false);
    expect(targets).toEqual([
      { service: 'assembly-svc', host: '10.0.0.1', port: 7101 },
      { service: 'assembly-svc', host: '10.0.0.2', port: 7101 },
    ]);
  });
});
