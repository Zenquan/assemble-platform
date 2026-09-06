import { test, expect, type Page } from '@playwright/test';

/**
 * 产线选择页 —— 冒烟 + 视觉回归。
 *
 * 用固定 fixture mock 后端（/lines 与 /interference/offline），
 * 不依赖真实服务，保证基线截图可复现。
 */

/** 简化产线 fixture（结构对齐 @assemble/domain ProductionLine） */
const FIXTURE_LINES = [
  {
    id: 'line-sorting-01',
    name: '三号分拣线',
    kind: 'sorting',
    baseAssetId: 'conveyor',
    modelVersion: 'sha3-v1.2.0',
    enabled: true,
    createdAt: '2026-09-06T00:00:00.000Z',
    updatedAt: '2026-09-06T00:00:00.000Z',
    stations: [
      { id: 'st-s1', lineId: 'line-sorting-01', seq: 1, name: '上料工位', taktSeconds: 3.2, deviceKind: 'feeder', position: [-3, 0, 0], facingDeg: 90 },
      { id: 'st-s2', lineId: 'line-sorting-01', seq: 2, name: '视觉分拣', taktSeconds: 2.6, deviceKind: 'vision-module', position: [0, 0, 0], facingDeg: 90 },
      { id: 'st-s3', lineId: 'line-sorting-01', seq: 3, name: '装箱工位', taktSeconds: 3.8, deviceKind: 'box-pack', position: [3, 0, 0], facingDeg: 90 },
    ],
  },
  {
    id: 'line-freshcut-01',
    name: '果蔬净菜加工线',
    kind: 'fresh-cut',
    transferAssetId: 'transfer-conveyor',
    transferGapMeters: 0.8,
    modelVersion: 'freshcut-v1.0.1',
    enabled: true,
    createdAt: '2026-09-06T00:00:00.000Z',
    updatedAt: '2026-09-06T00:00:00.000Z',
    stations: [
      { id: 'st-f1', lineId: 'line-freshcut-01', seq: 1, name: '提升上料', taktSeconds: 5.2, deviceKind: 'infeed-elevator', footprintLengthMeters: 3.49, facingDeg: 0 },
      { id: 'st-f2', lineId: 'line-freshcut-01', seq: 2, name: '气泡清洗', taktSeconds: 6.8, deviceKind: 'bubble-washer', footprintLengthMeters: 4.5, facingDeg: 0 },
      { id: 'st-f3', lineId: 'line-freshcut-01', seq: 3, name: '组合称重包装', taktSeconds: 6.2, deviceKind: 'weigh-packer', footprintLengthMeters: 2.15, facingDeg: 0 },
    ],
  },
];

/** 构造一条 InterferenceReport 响应 */
function report(lineId: string, hitCount: number) {
  return {
    reportId: `rep-${lineId}`,
    lineId,
    source: 'offline',
    totalPartCount: 12,
    pairsChecked: 3,
    hitCount,
    hits: [],
    elapsedMs: 4.2,
    broadCullRatio: 0.75,
    createdAt: '2026-09-06T00:00:00.000Z',
  };
}

/** 安装 API mock：/lines 返回 fixture，/interference/offline 按 lineId 返回命中数 */
async function mockApis(page: Page) {
  await page.route('**/lines', (route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill({ json: { ok: true, data: FIXTURE_LINES } });
    }
    return route.continue();
  });
  await page.route('**/interference/offline', (route) => {
    const body = route.request().postDataJSON() as { lineId: string };
    // 分拣线就绪(0)，净菜线待检修(3)，覆盖两种卡片状态
    const hitCount = body.lineId === 'line-freshcut-01' ? 3 : 0;
    return route.fulfill({ json: { ok: true, data: report(body.lineId, hitCount) } });
  });
}

test('smoke: 产线选择页渲染卡片网格', async ({ page }) => {
  await mockApis(page);
  await page.goto('/');

  await expect(page.locator('.title')).toContainText('产线列表');
  await expect(page.locator('.grid .card')).toHaveCount(2);
});

test('visual: 产线选择页截图基线对比', async ({ page }) => {
  await mockApis(page);
  await page.goto('/');

  await expect(page.locator('.title')).toContainText('产线列表');
  await expect(page.locator('.grid')).toBeVisible();
  // 等待卡片预检状态落定（mock 即时返回，但让 DOM 稳定一拍）
  await page.waitForTimeout(300);

  await expect(page).toHaveScreenshot('line-select.png', {
    fullPage: true,
    maxDiffPixelRatio: 0.01,
  });
});
