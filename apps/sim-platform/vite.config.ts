/**
 * sim-platform Vite + Vitest 配置
 *
 * - `@/*` 内部 alias → src
 * - workspace 依赖 alias → packages/<pkg>/src（测试/Dev 免 build，与根 vitest.config 口径一致）
 * - dev 代理：客户端同源调用 `/lines` → assembly-svc(7101)、`/interference` → interference-svc(7102)、
 *   `/takt` → takt-svc(7104)（后端走降级内存仓储即可本地跑通产线选择页；生产由网关同源汇聚）
 */
import { fileURLToPath, URL } from 'node:url';
import vue from '@vitejs/plugin-vue';
import { defineConfig, loadEnv, type ProxyOptions } from 'vite';

const DEFAULT_DEV_HOST = '127.0.0.1';
const DEFAULT_DEV_PORT = 5177;

/**
 * gateway 未就绪（本地 dev 未起 gateway）时，把 http-proxy 的连接失败从误导性的
 * 500 改判为 503（Service Unavailable），前端据此静默降级而不当作错误上报。
 */
const gatewayUnavailable: NonNullable<ProxyOptions['configure']> = (proxy) => {
  proxy.on('error', (_err, _req, res) => {
    if (res.headersSent) return res.end();
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, code: 'GATEWAY_UNAVAILABLE', message: 'gateway 未就绪' }));
  });
};

function port(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env };
  return {
    plugins: [vue()],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
        '@assemble/domain': fileURLToPath(new URL('../../packages/domain/src/index.ts', import.meta.url)),
        '@assemble/clearance-core': fileURLToPath(new URL('../../packages/clearance-core/src/index.ts', import.meta.url)),
        '@assemble/sim-utils': fileURLToPath(new URL('../../packages/sim-utils/src/index.ts', import.meta.url)),
      },
    },
    server: {
      host: env['VITE_DEV_HOST'] ?? DEFAULT_DEV_HOST,
      port: port(env['VITE_DEV_PORT'], DEFAULT_DEV_PORT),
      proxy: {
        '/lines': { target: env['VITE_ASSEMBLY_TARGET'] ?? 'http://127.0.0.1:7101', changeOrigin: true },
        '/interference': { target: env['VITE_INTERFERENCE_TARGET'] ?? 'http://127.0.0.1:7102', changeOrigin: true },
        '/takt': { target: env['VITE_TAKT_TARGET'] ?? 'http://127.0.0.1:7104', changeOrigin: true },
        '/model': { target: env['VITE_MODEL_TARGET'] ?? 'http://127.0.0.1:7103', changeOrigin: true },
        // 鉴权：登录/验签/角色查询转发 auth-svc(7105)，本地 dev 也可走通登录流
        '/auth': { target: env['VITE_AUTH_TARGET'] ?? 'http://127.0.0.1:7105', changeOrigin: true },
        // 可观测性：SimMonitor 上报 /telemetry、拉取聚合 /metrics 都转发 gateway。
        // 本地需单独起 gateway（PORT=7100 node services/gateway/dist/server.js），
        // 未起时 proxy 连接失败回 503，前端静默降级，不影响业务与性能页本地实时数据。
        '/telemetry': {
          target: env['VITE_GATEWAY_TARGET'] ?? 'http://127.0.0.1:7100',
          changeOrigin: true,
          configure: gatewayUnavailable,
        },
        '/metrics': {
          target: env['VITE_GATEWAY_TARGET'] ?? 'http://127.0.0.1:7100',
          changeOrigin: true,
          configure: gatewayUnavailable,
        },
      },
    },
    test: {
      environment: 'node',
      include: ['src/**/*.test.ts', 'src/**/test/**/*.test.ts'],
    },
  };
});
