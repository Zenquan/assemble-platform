import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// 统一把 workspace 依赖 alias 到 src，使未 build 时测试可直接跑源码
export default defineConfig({
  resolve: {
    alias: {
      '@assemble/domain': r('./packages/domain/src/index.ts'),
      '@assemble/sim-utils': r('./packages/sim-utils/src/index.ts'),
      '@assemble/clearance-core': r('./packages/clearance-core/src/index.ts'),
    },
  },
  test: {
    include: ['**/test/**/*.test.ts', '**/tests/**/*.test.ts', '**/*.test.ts'],
    // apps/* 自带 vite.config 含内部 alias 与 vue plugin，由各自包内 `vitest run` 执行；
    // 根 vitest 仅覆盖 packages/services 的共享/服务侧回归，避免 alias 冲突。
    exclude: ['node_modules/**', 'dist/**', 'apps/**'],
    environment: 'node',
  },
});
