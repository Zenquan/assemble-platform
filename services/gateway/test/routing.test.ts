import { describe, expect, it } from 'vitest';
import {
  GATEWAY_OWN_PATHS,
  matchRoute,
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
