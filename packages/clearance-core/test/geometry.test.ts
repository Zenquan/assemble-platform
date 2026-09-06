import { describe, expect, it } from 'vitest';
import {
  ClearanceDetector,
  aabbFromPoints,
  aabbToObb,
  aabbVolume,
  obbCenter,
  obbFromBomPart,
  obbFromCenterHalfExtents,
  vec3Max,
  vec3Min,
} from '../src/index.js';

describe('AABB 工具函数', () => {
  it('vec3Min / vec3Max 逐分量取小/取大', () => {
    expect(vec3Min([1, 5, 3], [2, 2, 4])).toEqual([1, 2, 3]);
    expect(vec3Max([1, 5, 3], [2, 2, 4])).toEqual([2, 5, 4]);
  });

  it('aabbFromPoints 由两点扩出包围盒', () => {
    const box = aabbFromPoints([2, 3, 4], [-1, -2, -3]);
    expect(box.min).toEqual([-1, -2, -3]);
    expect(box.max).toEqual([2, 3, 4]);
  });

  it('aabbVolume 计算体积', () => {
    const box = aabbFromPoints([0, 0, 0], [2, 3, 4]);
    expect(aabbVolume(box)).toBe(24);
  });
});

describe('OBB 工具函数', () => {
  it('aabbToObb 派生轴对齐 OBB', () => {
    const obb = aabbToObb({ min: [-1, -2, -3], max: [1, 2, 3] });
    expect(obb.center).toEqual([0, 0, 0]);
    expect(obb.halfExtents).toEqual([1, 2, 3]);
    expect(obb.axes).toEqual([
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ]);
  });

  it('obbCenter 返回中心副本', () => {
    const obb = obbFromCenterHalfExtents([1, 2, 3], [1, 1, 1]);
    expect(obbCenter(obb)).toEqual([1, 2, 3]);
  });

  it('obbFromBomPart 无旋转时 y 底面贴锚点', () => {
    const part = {
      localPosition: [0, 0, 0] as const,
      localRotation: { x: 0, y: 0, z: 0, w: 1 },
    };
    const obb = obbFromBomPart(part, [2, 4, 6]);
    // 中心 = 锚点 + [0, sizeY/2, 0]
    expect(obb.center[0]).toBeCloseTo(0);
    expect(obb.center[1]).toBeCloseTo(2);
    expect(obb.center[2]).toBeCloseTo(0);
    expect(obb.halfExtents).toEqual([1, 2, 3]);
  });

  it('obbFromBomPart 绕 Y 旋转 90° 交换 X/Z 半轴', () => {
    const part = {
      localPosition: [1, 2, 3] as const,
      localRotation: { x: 0, y: Math.SQRT1_2, z: 0, w: Math.SQRT1_2 },
    };
    const obb = obbFromBomPart(part, [2, 4, 6]);
    // 绕 Y 转 90° 后，X 半轴 -> Z（取绝对值），Z 半轴 -> X
    expect(obb.halfExtents[0]).toBeCloseTo(3);
    expect(obb.halfExtents[1]).toBeCloseTo(2);
    expect(obb.halfExtents[2]).toBeCloseTo(1);
    // 中心 x/z 随旋转偏移，y 仍 = 锚点 y + sizeY/2
    expect(obb.center[1]).toBeCloseTo(2 + 2);
  });
});

describe('ClearanceDetector 交互式与边界路径', () => {
  it('partCount 与 rebuild(onlyPartIds) 子集重建', () => {
    const d = new ClearanceDetector();
    d.loadAll([
      { partId: 'A', obb: obbFromCenterHalfExtents([0, 0, 0], [1, 1, 1]) },
      { partId: 'B', obb: obbFromCenterHalfExtents([5, 0, 0], [1, 1, 1]) },
    ]);
    expect(d.partCount).toBe(2);
    // 只重建 A 子集，不影响总零件数
    d.rebuild(['A']);
    expect(d.partCount).toBe(2);
  });

  it('queryInteractive 检测拖拽件与已装配集合干涉', () => {
    const d = new ClearanceDetector();
    d.loadAll([
      { partId: 'A', obb: obbFromCenterHalfExtents([0, 0, 0], [1, 1, 1]) },
      { partId: 'B', obb: obbFromCenterHalfExtents([10, 0, 0], [1, 1, 1]) },
    ]);
    // 拖拽件与 A 重叠 -> 命中 A
    const hits = d.queryInteractive({
      partId: 'M',
      obb: obbFromCenterHalfExtents([1.5, 0, 0], [1, 1, 1]),
    });
    expect(hits).toContain('A');
    expect(hits).not.toContain('B');
  });

  it('queryInteractive 在未 build BVH 时返回空', () => {
    const d = new ClearanceDetector();
    // 未 loadAll/rebuild，bvh 为 null
    const hits = d.queryInteractive({
      partId: 'M',
      obb: obbFromCenterHalfExtents([0, 0, 0], [1, 1, 1]),
    });
    expect(hits).toEqual([]);
  });

  it('roughIntersect 只做 AABB 粗判，返回 broad 阶段命中', () => {
    const d = new ClearanceDetector();
    const hits = d.roughIntersect([
      { partId: 'A', obb: obbFromCenterHalfExtents([0, 0, 0], [1, 1, 1]) },
      { partId: 'B', obb: obbFromCenterHalfExtents([1, 0, 0], [1, 1, 1]) },
      { partId: 'C', obb: obbFromCenterHalfExtents([50, 0, 0], [1, 1, 1]) },
    ]);
    expect(hits.length).toBe(1);
    expect(hits[0]!.phase).toBe('broad');
    expect(hits[0]!.severity).toBe('info');
    expect(hits[0]!.firstPartId).toBe('A');
    expect(hits[0]!.secondPartId).toBe('B');
  });

  it('severity 优先级：零件级覆盖默认值', () => {
    const d = new ClearanceDetector({ severity: 'error' });
    d.loadAll([
      { partId: 'A', obb: obbFromCenterHalfExtents([0, 0, 0], [1, 1, 1]) },
      {
        partId: 'B',
        obb: obbFromCenterHalfExtents([1, 0, 0], [1, 1, 1]),
        severity: 'warning',
      },
    ]);
    const res = d.runFull();
    expect(res.hits.length).toBe(1);
    // 零件级 severity 覆盖默认 error
    expect(res.hits[0]!.severity).toBe('warning');
  });

  it('runFull 空集返回零报告', () => {
    const d = new ClearanceDetector();
    d.loadAll([]);
    const res = d.runFull();
    expect(res.totalPartCount).toBe(0);
    expect(res.hits).toEqual([]);
    expect(res.broadCullRatio).toBe(1);
  });
});
