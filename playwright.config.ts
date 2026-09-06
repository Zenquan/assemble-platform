import { defineConfig } from '@playwright/test';

/**
 * E2E / 视觉回归骨架（M4 加固「视觉回归」一环）。
 *
 * - 冒烟 + 视觉回归以「产线选择页」为入口：mock 后端 API，不依赖真实服务，
 *   用固定 fixture 渲染卡片网格，保证基线可复现。
 * - 视觉回归（toHaveScreenshot）对字体/渲染差异敏感，作为**本地工具**使用，
 *   不并入主 CI（避免跨机器误报）；冒烟断言可单独跑（--grep smoke）。
 *
 * 用法（根目录）：
 *   pnpm e2e                          # 冒烟 + 视觉回归
 *   pnpm e2e --update-snapshots       # 首次/有意变更 UI 后更新截图基线
 *   pnpm e2e --grep smoke             # 只跑冒烟（无截图对比）
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  fullyParallel: true,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:5199',
    viewport: { width: 1440, height: 900 },
    locale: 'zh-CN',
    // 关闭动画/过渡，减少视觉回归抖动
    reducedMotion: 'reduce',
  },
  webServer: {
    // 用冷门端口，避免与本机其它 dev 服务（如 5173）冲突被 reuseExistingServer 误复用
    command: 'cd apps/sim-platform && ../../node_modules/.bin/vite --port 5199 --strictPort',
    url: 'http://127.0.0.1:5199',
    reuseExistingServer: true,
    timeout: 60_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
});
