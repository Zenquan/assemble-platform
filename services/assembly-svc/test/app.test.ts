import { describe, expect, it } from 'vitest';

import type { AssemblyBom, ModelAssetId, ProductionLine } from '@assemble/domain';
import { createMemoryRepo } from '@assemble/storage';

import { buildApp } from '../src/app.js';
import { suggestStationLayout } from '../src/layoutSuggestion.js';
import { buildBomForLine, buildSeedLines } from '../src/repositories/index.js';

function line(
  id: string,
  devices: ModelAssetId[],
  baseAssetId: ModelAssetId | null = 'conveyor',
): ProductionLine {
  const now = '2026-09-04T00:00:00.000Z';
  return {
    id,
    name: `${id} 产线`,
    kind: 'sorting',
    ...(baseAssetId ? { baseAssetId } : {}),
    enabled: true,
    modelVersion: 'fixture-v1',
    createdAt: now,
    updatedAt: now,
    stations: devices.map((deviceKind, index) => ({
      id: `${id}-station-${index + 1}`,
      lineId: id,
      seq: index + 1,
      name: `工位 ${index + 1}`,
      taktSeconds: 2 + index,
      deviceKind,
      position: [index * 3, 0, 0],
      facingDeg: 90,
    })),
  };
}

async function appWith(...lines: ProductionLine[]) {
  const repo = createMemoryRepo<ProductionLine>();
  for (const item of lines) await repo.upsert(item);
  return buildApp({ repos: { lines: repo } });
}

describe('GET /lines/:id/bom', () => {
  it('净菜 seed 使用七个行业设备且不附加通用整线基座', () => {
    const freshcut = buildSeedLines().find((item) => item.id === 'line-freshcut-01');
    expect(freshcut?.baseAssetId).toBeUndefined();
    expect(freshcut?.transferAssetId).toBe('transfer-conveyor');
    expect(freshcut?.stations.map((station) => station.deviceKind)).toEqual([
      'infeed-elevator',
      'bubble-washer',
      'inspection-conveyor',
      'vegetable-cutter',
      'vibratory-dewaterer',
      'weigh-packer',
      'metal-detector',
    ]);
  });

  it('两条扩展净菜线复用真实设备资产但工艺组合不同', () => {
    const lines = buildSeedLines();
    const leaf = lines.find((item) => item.id === 'line-freshcut-02');
    const root = lines.find((item) => item.id === 'line-freshcut-03');

    expect(leaf?.stations.map((station) => station.deviceKind)).toEqual([
      'infeed-elevator', 'bubble-washer', 'inspection-conveyor',
      'vibratory-dewaterer', 'weigh-packer', 'metal-detector',
    ]);
    expect(root?.stations.map((station) => station.deviceKind)).toEqual([
      'infeed-elevator', 'bubble-washer', 'vegetable-cutter',
      'inspection-conveyor', 'weigh-packer', 'metal-detector',
    ]);
    expect(buildBomForLine(leaf!).parts.filter((part) => part.assetId === 'transfer-conveyor')).toHaveLength(5);
    expect(buildBomForLine(root!).parts.filter((part) => part.assetId === 'transfer-conveyor')).toHaveLength(5);
  });

  it('净菜 BOM 按 GLB 外包络排布，并用固定转运段填满设备间隙', () => {
    const freshcut = buildSeedLines().find((item) => item.id === 'line-freshcut-01');
    expect(freshcut).toBeDefined();
    const bom = buildBomForLine(freshcut!);
    const devices = bom.parts.filter((part) => part.isMovable);
    const transfers = bom.parts.filter((part) => part.assetId === 'transfer-conveyor');
    const expectedDevicePositions = [-1.745, 3.05, 7.965, 11.875, 15.43, 18.815, 21.85];
    const expectedTransferPositions = [0.4, 5.7, 10.23, 13.52, 17.34, 20.29];

    expect(devices).toHaveLength(7);
    expect(transfers).toHaveLength(6);
    devices.forEach((part, index) =>
      expect(part.localPosition[0]).toBeCloseTo(expectedDevicePositions[index] ?? 0, 3),
    );
    transfers.forEach((part, index) =>
      expect(part.localPosition[0]).toBeCloseTo(expectedTransferPositions[index] ?? 0, 3),
    );
    expect(transfers.every((part) => part.isMovable === false)).toBe(true);
    expect(bom.steps).toHaveLength(7);
  });

  it('按所选流水线工位返回不同 BOM、GLB 资产与步骤归属', async () => {
    const sorting = line('sorting-line', ['feeder', 'vision-module', 'box-pack']);
    const fresh = line('fresh-line', ['bubble-washer', 'vegetable-cutter'], null);
    const app = await appWith(sorting, fresh);

    const sortingResponse = await app.inject({ method: 'GET', url: '/lines/sorting-line/bom' });
    const freshResponse = await app.inject({ method: 'GET', url: '/lines/fresh-line/bom' });
    const sortingBom = sortingResponse.json<{ data: AssemblyBom }>().data;
    const freshBom = freshResponse.json<{ data: AssemblyBom }>().data;

    expect(sortingResponse.statusCode).toBe(200);
    expect(freshResponse.statusCode).toBe(200);
    expect(sortingBom.parts.map((part) => part.assetId)).toEqual([
      'conveyor',
      'feeder',
      'vision-module',
      'box-pack',
    ]);
    expect(freshBom.parts.map((part) => part.assetId)).toEqual([
      'bubble-washer',
      'vegetable-cutter',
    ]);
    expect(sortingBom).not.toEqual(freshBom);

    const validStationIds = new Set(sorting.stations.map((station) => station.id));
    expect(sortingBom.steps.every((step) => validStationIds.has(step.stationId))).toBe(true);
    expect(sortingBom.steps.map((step) => step.partId)).toEqual(
      sortingBom.parts.map((part) => part.id),
    );

    await app.close();
  });

  it('工位显式 position 优先于紧凑/默认推导，供干涉调整后保存布局', () => {
    const line: ProductionLine = {
      id: 'manual-layout',
      name: '手动布局线',
      kind: 'fresh-cut',
      enabled: true,
      modelVersion: 'fixture-v1',
      createdAt: '2026-09-04T00:00:00.000Z',
      updatedAt: '2026-09-04T00:00:00.000Z',
      transferAssetId: 'transfer-conveyor',
      transferGapMeters: 0.8,
      stations: [
        {
          id: 'manual-s1', lineId: 'manual-layout', seq: 1, name: '工位 1',
          taktSeconds: 5, deviceKind: 'bubble-washer', footprintLengthMeters: 4.5,
          facingDeg: 0, position: [100, 1.2, -3],
        },
        {
          id: 'manual-s2', lineId: 'manual-layout', seq: 2, name: '工位 2',
          taktSeconds: 5, deviceKind: 'vegetable-cutter', footprintLengthMeters: 2.49,
          facingDeg: 0, position: [200, 0.5, 4],
        },
      ],
    };
    const bom = buildBomForLine(line);
    const devices = bom.parts.filter((part) => part.assetId !== 'transfer-conveyor');

    expect(devices[0]?.localPosition).toEqual([100, 1.2, -3]);
    expect(devices[1]?.localPosition).toEqual([200, 0.5, 4]);
  });

  it('自动避让建议回填后重新预检归零（分拣线 conveyor 与设备冲突）', () => {
    const sorting = buildSeedLines().find((item) => item.id === 'line-sorting-01');
    expect(sorting).toBeDefined();
    const before = suggestStationLayout(sorting!, buildBomForLine(sorting!));

    expect(before.hitCount).toBe(3);
    expect(before.suggestions).toHaveLength(3);
    expect(before.suggestions.every((item) => (item.position[1] ?? 0) > 0.7)).toBe(true);

    const byStation = new Map(before.suggestions.map((item) => [item.stationId, item.position]));
    const adjusted: ProductionLine = {
      ...sorting!,
      stations: sorting!.stations.map((station) => ({
        ...station,
        position: byStation.get(station.id) ?? station.position,
      })),
    };
    const after = suggestStationLayout(adjusted, buildBomForLine(adjusted));
    expect(after.hitCount).toBe(0);
    expect(after.suggestions).toEqual([]);
  });

  it('GET /lines/:id/layout-suggestions 返回可回填工位的建议', async () => {
    const sorting = buildSeedLines().find((item) => item.id === 'line-sorting-01');
    const app = await appWith(sorting!);
    const response = await app.inject({
      method: 'GET',
      url: '/lines/line-sorting-01/layout-suggestions',
    });
    const body = response.json<{
      data: {
        hitCount: number;
        suggestions: Array<{ stationId: string; position: readonly [number, number, number] }>;
      };
    }>();

    expect(response.statusCode).toBe(200);
    expect(body.data.hitCount).toBe(3);
    expect(body.data.suggestions.map((item) => item.stationId).sort()).toEqual(
      ['st-s1', 'st-s2', 'st-s3'],
    );
    expect(body.data.suggestions.every((item) => (item.position[1] ?? 0) > 0.7)).toBe(true);
    await app.close();
  });

  it('未知流水线返回 404 信封错误', async () => {
    const app = await appWith();
    const response = await app.inject({ method: 'GET', url: '/lines/missing/bom' });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ ok: false, code: 'NOT_FOUND' });

    await app.close();
  });

  it('拒绝无效的工位节拍和未注册设备资产', async () => {
    const app = await appWith();
    const response = await app.inject({
      method: 'POST',
      url: '/lines',
      payload: {
        id: 'invalid-line',
        name: '无效产线',
        kind: 'fresh-cut',
        enabled: true,
        modelVersion: 'test',
        stations: [{
          id: 'invalid-station', lineId: 'invalid-line', seq: 1, name: '工位',
          taktSeconds: 0, deviceKind: 'unknown-device',
        }],
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ ok: false, code: 'VALIDATION_FAILED' });
    await app.close();
  });
});

describe('可观测性：/metrics 与 X-Request-Id', () => {
  it('/metrics 返回 Prometheus 文本并累计请求计数', async () => {
    const app = await appWith();
    await app.inject({ method: 'GET', url: '/lines/missing/bom' });
    const res = await app.inject({ method: 'GET', url: '/metrics' });

    expect(res.statusCode).toBe(200);
    expect(String(res.headers['content-type'] ?? '')).toContain('text/plain');
    expect(res.body).toContain('# TYPE http_requests_total counter');
    expect(res.body).toContain('# TYPE http_request_duration_seconds histogram');
    expect(res.body).toContain('status="404"');
    await app.close();
  });

  it('响应头回显透传的 x-request-id，无则自动生成', async () => {
    const app = await appWith();
    const withId = await app.inject({
      method: 'GET',
      url: '/lines/missing/bom',
      headers: { 'x-request-id': 'req-test-1' },
    });
    expect(withId.headers['x-request-id']).toBe('req-test-1');

    const withoutId = await app.inject({ method: 'GET', url: '/lines/missing/bom' });
    expect(withoutId.headers['x-request-id']).toBeDefined();
    expect(withoutId.headers['x-request-id']).not.toBe('');
    await app.close();
  });
});
