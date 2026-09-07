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
      '@assemble/observability': r('./packages/observability/src/index.ts'),
      '@assemble/security': r('./packages/security/src/index.ts'),
    },
  },
  test: {
    // 相对 cwd 的 glob：根目录 `vitest` 跑全仓，单包 `vitest`（cwd 在包内）只跑该包。
    // 注意：hoisted 软链接会让根目录全量跑时把 workspace 依赖包测试重复执行一遍，
    // 无害但更慢；覆盖率统计按 coverage.include 的源码绝对路径收敛，不受影响。
    include: ['**/test/**/*.test.ts', '**/tests/**/*.test.ts'],
    // apps/* 自带 vite.config 含内部 alias 与 vue plugin，由各自包内 `vitest run` 执行；
    // 根 vitest 仅覆盖 packages/services 的共享/服务侧回归，避免 alias 冲突。
    exclude: ['node_modules/**', 'dist/**', 'apps/**'],
    environment: 'node',
    // 覆盖率门禁（pnpm test:coverage）：只对核心算法包强制阈值，
    // 骨架/服务/前端包不做数字 KPI（见 docs/TESTING.md §6）。
    // include 相对 config 所在根目录解析。
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'html'],
      include: ['packages/clearance-core/src/**', 'packages/sim-utils/src/**'],
      thresholds: {
        lines: 80,
        functions: 80,
        statements: 80,
        // branches 略低于其余维度：math.ts/obb.ts 含大量防御性 `?? 0`/`|| 1`
        // 兜底分支（类型层已保证非空），无法通过有意义用例触发，故单独放宽到 75。
        branches: 75,
      },
    },
  },
});
