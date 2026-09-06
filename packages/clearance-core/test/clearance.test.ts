import { describe, expect, it } from 'vitest';
import { ClearanceDetector, obbIntersect } from '../src/index.js';
import { obbFromCenterHalfExtents, aabbToObb } from '../src/index.js';

describe('OBB-SAT obbIntersect', () => {
  it('两盒分离时返回 false（不相交）', () => {
    const a = obbFromCenterHalfExtents([0, 0, 0], [1, 1, 1]);
    const b = obbFromCenterHalfExtents([5, 0, 0], [1, 1, 1]);
    expect(obbIntersect(a, b)).toBe(false);
  });

  it('两盒重叠时返回 true（干涉）', () => {
    const a = obbFromCenterHalfExtents([0, 0, 0], [1, 1, 1]);
    const b = obbFromCenterHalfExtents([1, 0, 0], [1, 1, 1]);
    expect(obbIntersect(a, b)).toBe(true);
  });

  it('仅边缘接触视为不干涉（容差内分离）', () => {
    const a = obbFromCenterHalfExtents([0, 0, 0], [1, 1, 1]);
    const b = obbFromCenterHalfExtents([2, 0, 0], [1, 1, 1]);
    expect(obbIntersect(a, b)).toBe(false);
  });

  it('恰好端面相贴不判干涉（净菜转运段与设备同缝贴合）', () => {
    const a = obbFromCenterHalfExtents([-1.745, 0.905, 0], [1.745, 0.905, 0.72]);
    const b = obbFromCenterHalfExtents([0.4, 0.365, 0], [0.4, 0.365, 0.35]);
    expect(obbIntersect(a, b)).toBe(false);
  });

  it('旋转 45° 的斜盒与轴对齐盒在正确情形下判定相交', () => {
    // A 沿 X 拉伸的盒，绕 Z 转 45 度
    const rot = Math.SQRT1_2; // cos45 = sin45 = 0.7071
    const a = {
      center: [0, 0, 0] as const,
      axes: [
        [rot, rot, 0] as const,
        [-rot, rot, 0] as const,
        [0, 0, 1] as const,
      ],
      halfExtents: [2, 1, 1] as const,
    };
    // B 放在 A 旋转后覆盖区域内 -> 相交
    const b = obbFromCenterHalfExtents([1.5, 1.5, 0], [0.5, 0.5, 0.5]);
    expect(obbIntersect(a, b)).toBe(true);
  });
});

describe('BVH + Detector 集成', () => {
  it('loadAll + runFull: 检测到重叠零件并给出报告指标', () => {
    const d = new ClearanceDetector();
    // 一个在原点、一个重叠在原点上 -> 干涉；第三个远离 -> 不干涉
    d.loadAll([
      { partId: 'A', obb: obbFromCenterHalfExtents([0, 0, 0], [1, 1, 1]) },
      { partId: 'B', obb: obbFromCenterHalfExtents([1.5, 0, 0], [1, 1, 1]) },
      { partId: 'C', obb: obbFromCenterHalfExtents([50, 0, 0], [1, 1, 1]) },
    ]);
    const res = d.runFull();
    expect(res.totalPartCount).toBe(3);
    expect(res.totalPossiblePairs).toBe(3);
    // A-B 干涉 1 对；A-C、B-C 均分离
    expect(res.hits.length).toBe(1);
    expect(res.hits[0]!.firstPartId).toBe('A');
    expect(res.hits[0]!.secondPartId).toBe('B');
    expect(res.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  it('loadAll + runFull: 完全分离时无干涉、剔除率高', () => {
    const d = new ClearanceDetector();
    d.loadAll([
      { partId: 'A', obb: obbFromCenterHalfExtents([0, 0, 0], [1, 1, 1]) },
      { partId: 'B', obb: obbFromCenterHalfExtents([10, 0, 0], [1, 1, 1]) },
      { partId: 'C', obb: obbFromCenterHalfExtents([0, 10, 0], [1, 1, 1]) },
    ]);
    const res = d.runFull();
    expect(res.hits.length).toBe(0);
    expect(res.broadCullRatio).toBe(1);
  });

  it('大规模(200零件)性能基准落在 <200ms（对应简历口径）', () => {
    const d = new ClearanceDetector();
    const n = 200;
    const parts = [];
    for (let i = 0; i < n; i++) {
      // 每条产线一段，内部密集、段间稀疏，以体现 BVH 剔除价值
      const seg = Math.floor(i / 10);
      const inSeg = i % 10;
      parts.push({
        partId: `p${i}`,
        obb: obbFromCenterHalfExtents(
          [seg * 12 + inSeg * 1.5, inSeg * 1.5, 0],
          [1, 1, 1],
        ),
      });
    }
    d.loadAll(parts);
    const res = d.runFull();
    expect(res.totalPartCount).toBe(200);
    expect(res.elapsedMs).toBeLessThan(200);
  });
});
