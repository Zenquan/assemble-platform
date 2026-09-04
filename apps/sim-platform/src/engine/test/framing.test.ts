import { describe, expect, it } from 'vitest';

import { fitSphereCameraRadius } from '../framing.js';

describe('fitSphereCameraRadius', () => {
  it('竖向窄视口按更小的水平视场角拉远相机', () => {
    const landscape = fitSphereCameraRadius({
      boundingRadius: 12,
      verticalFovRadians: 0.8,
      aspectRatio: 16 / 9,
    });
    const portrait = fitSphereCameraRadius({
      boundingRadius: 12,
      verticalFovRadians: 0.8,
      aspectRatio: 0.8,
    });

    expect(portrait).toBeGreaterThan(landscape);
    expect(portrait).toBeCloseTo(40.449, 2);
  });

  it('保留最小相机半径并容忍无效宽高比', () => {
    expect(
      fitSphereCameraRadius({
        boundingRadius: 1,
        verticalFovRadians: 0.8,
        aspectRatio: 0,
      }),
    ).toBe(14);
  });

  it('允许设备聚焦使用更近的最小半径与独立留白', () => {
    expect(
      fitSphereCameraRadius({
        boundingRadius: 2.25,
        verticalFovRadians: 0.8,
        aspectRatio: 0.8,
        minRadius: 8,
        padding: 1.15,
      }),
    ).toBeCloseTo(8.075, 2);
  });
});
