/**
 * sim-platform Vite + Vitest 配置
 *
 * - `@/*` 内部 alias → src
 * - workspace 依赖 alias → packages/<pkg>/src（测试/Dev 免 build，与根 vitest.config 口径一致）
 * - dev 代理：客户端同源调用 `/lines` → assembly-svc(7101)、`/interference` → interference-svc(7102)
 *   （后端走降级内存仓储即可本地跑通产线选择页；生产由网关同源汇聚）
 */
import { fileURLToPath, URL } from 'node:url';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

export default defineConfig({
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
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/lines': { target: 'http://127.0.0.1:7101', changeOrigin: true },
      '/interference': { target: 'http://127.0.0.1:7102', changeOrigin: true },
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/test/**/*.test.ts'],
  },
});
