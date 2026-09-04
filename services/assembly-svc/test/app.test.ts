import { describe, expect, it } from 'vitest';

import type { AssemblyBom, ModelAssetId, ProductionLine } from '@assemble/domain';
import { createMemoryRepo } from '@assemble/storage';

import { buildApp } from '../src/app.js';
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

  it('未知流水线返回 404 信封错误', async () => {
    const app = await appWith();
    const response = await app.inject({ method: 'GET', url: '/lines/missing/bom' });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ ok: false, code: 'NOT_FOUND' });

    await app.close();
  });
});
