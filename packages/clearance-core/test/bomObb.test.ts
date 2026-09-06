import { describe, expect, it } from 'vitest';

import type { AssemblyPart } from '@assemble/domain';
import { obbFromBomPart } from '../src/index.js';

function part(
  id: string,
  localPosition: readonly [number, number, number],
  localRotation = { x: 0, y: 0, z: 0, w: 1 },
): Pick<AssemblyPart, 'localPosition' | 'localRotation'> & { id: string } {
  return { id, localPosition, localRotation };
}

describe('obbFromBomPart（BOM 位姿 → 真实世界 OBB）', () => {
  it('未旋转时底面中心锚点落到 y=0，OBB 中心抬到高度一半', () => {
    const obb = obbFromBomPart(part('conveyor', [0, 0, 0]), [8, 0.73, 0.7]);
    expect(obb.center[0]).toBe(0);
    expect(obb.center[1]).toBeCloseTo(0.365);
    expect(obb.center[2]).toBe(0);
    expect(obb.halfExtents[0]).toBeCloseTo(4);
    expect(obb.halfExtents[1]).toBeCloseTo(0.365);
    expect(obb.halfExtents[2]).toBeCloseTo(0.35);
  });

  it('绕 Y 旋转 90° 时半轴按世界 AABB 口径交换 x/z', () => {
    const obb = obbFromBomPart(
      part('feeder', [-3, 0, 0], { x: 0, y: Math.SQRT1_2, z: 0, w: Math.SQRT1_2 }),
      [1.21, 0.55, 1.35],
    );
    expect(obb.center[0]).toBeCloseTo(-3);
    expect(obb.center[1]).toBeCloseTo(0.275);
    expect(obb.halfExtents[0]).toBeCloseTo(1.35 / 2);
    expect(obb.halfExtents[1]).toBeCloseTo(0.275);
    expect(obb.halfExtents[2]).toBeCloseTo(1.21 / 2);
  });

  it('把位置平移带到中心，不影响半轴', () => {
    const obb = obbFromBomPart(part('box', [7, 0, -2]), [1.04, 0.74, 0.98]);
    expect(obb.center[0]).toBe(7);
    expect(obb.center[1]).toBeCloseTo(0.37);
    expect(obb.center[2]).toBe(-2);
  });
});
