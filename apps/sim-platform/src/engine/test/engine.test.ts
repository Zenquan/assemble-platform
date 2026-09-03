/**
 * SimEngine 门面契约测试 —— 验证 Noop 替身暴露的公共契约真实可用。
 *
 * 约定（CODE_STYLE §7）：一律走 `@/engine` 包根导出，验证公共接口而非私有实现；
 * 中文 describe/it 描述行为；无 WebGL / DOM / Babylon 依赖。
 */
import { describe, expect, it } from 'vitest';

import type { OBB, ProductionLine, AssemblyBom } from '@assemble/domain';
import {
  createSimEngine,
  NoopAssembler,
  NoopClearance,
  BabylonSimEngine,
  type AssemblyController,
  type ClearanceController,
} from '@/engine';

/** 用中心+半轴长构造一个轴向对齐 OBB（测试几何助手） */
function box(center: [number, number, number], half: number): OBB {
  const axes: [OBB['axes'][0], OBB['axes'][1], OBB['axes'][2]] = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  return { center, axes, halfExtents: [half, half, half] };
}

const part = (partId: string, center: [number, number, number], half = 5) => ({
  partId,
  obb: box(center, half),
});

/** 一个最小可用的装配 BOM（3 步工艺） */
function makeBom(): AssemblyBom {
  const parts: AssemblyBom['parts'] = [
    { id: 'base', name: '机座', assetId: 'conveyor', localPosition: [0, 0, 0] as const, localRotation: { x: 0, y: 0, z: 0, w: 1 }, isMovable: false },
    { id: 'shaft_1', name: '轴一', assetId: 'feeder', localPosition: [0, 20, 0] as const, localRotation: { x: 0, y: 0, z: 0, w: 1 }, isMovable: true, parentId: 'base' },
    { id: 'shaft_2', name: '轴二', assetId: 'box-pack', localPosition: [0, 40, 0] as const, localRotation: { x: 0, y: 0, z: 0, w: 1 }, isMovable: true, parentId: 'base' },
  ];
  return {
    lineId: 'L1',
    parts,
    constraints: [],
    steps: [
      { seq: 0, partId: 'base', stationId: 'station-1', constraintIds: [], durationSeconds: 1, description: '固定机座' },
      { seq: 1, partId: 'shaft_1', stationId: 'station-1', constraintIds: [], durationSeconds: 1, description: '装入轴一' },
      { seq: 2, partId: 'shaft_2', stationId: 'station-1', constraintIds: [], durationSeconds: 1, description: '装入轴二' },
    ],
  };
}

describe('createSimEngine 门面工厂', () => {
  it('无 WebGL（jsdom/CI）回落 noop 后端，init 后可读取健康快照', async () => {
    // 注：浏览器 E2E 下 WebGL 可用时工厂会返回 BabylonSimEngine（backend='babylon'），
    //     本单元测试在 jsdom 下运行，无 WebGL，自动回落 Noop。
    const engine = createSimEngine();
    expect(engine.backend).toBe('noop');

    const before = engine.health();
    expect(before.ok).toBe(false);

    const line: ProductionLine = {
      id: 'L1', name: '一号线', kind: 'sorting', stations: [], enabled: true,
      modelVersion: 'v1', createdAt: '', updatedAt: '',
    };
    const after = await engine.init({ line, bom: makeBom() });
    expect(after.ok).toBe(true);
    expect(after.backend).toBe('noop');
    expect(after.activeLineId).toBe('L1');
  });

  it('门面正确暴露 BabylonSimEngine 类（仅引用，不实例化以免启 WebGL）', () => {
    // 不在此处 new —— BabylonSimEngine 一旦构造会尝试建临时 canvas，jsdom 环境不安全；
    // 仅验证门面根出口能拿到类形态，符合 0.2.0「真渲染后端已挂门面」出口。
    expect(typeof BabylonSimEngine).toBe('function');
    expect(BabylonSimEngine.name).toBe('BabylonSimEngine');
  });

  it('dispose 后健康态回到未初始化', async () => {
    const engine = createSimEngine();
    await engine.init({ line: { id: 'L1', name: '', kind: 'sorting', stations: [], enabled: true, modelVersion: '', createdAt: '', updatedAt: '' }, bom: makeBom() });
    engine.dispose();
    expect(engine.health().ok).toBe(false);
    expect(engine.health().activeLineId).toBeNull();
  });
});

describe('NoopClearance 实时干涉（委托 clearance-core 真实算法）', () => {
  it('互不相交的零件对不命中', () => {
    const c: ClearanceController = new NoopClearance();
    const n = c.registerAssembled([part('a', [0, 0, 0]), part('b', [100, 100, 100])]);
    expect(n).toBe(2);
    expect(c.queryInteractive(part('dragging', [200, 200, 200]))).toHaveLength(0);
  });

  it('与已装配集合交叠的拖拽件被实时命中', () => {
    const c: ClearanceController = new NoopClearance();
    c.registerAssembled([part('a', [0, 0, 0], 10)]);
    const hits = c.queryInteractive(part('dragging', [2, 2, 2], 10));
    expect(hits.length).toBe(1);
    expect(hits[0]!.phase).toBe('narrow');
  });

  it('runFull 输出领域标准报告（命中/耗时/剔除率字段齐全）', () => {
    const c: ClearanceController = new NoopClearance();
    const report = c.runFull([part('a', [0, 0, 0], 10), part('b', [1, 1, 1], 10), part('c', [300, 300, 300])]);
    expect(report.source).toBe('interactive');
    expect(report.totalPartCount).toBe(3);
    expect(report.hitCount).toBe(1);
    expect(report.broadCullRatio).toBeGreaterThan(0);
    expect(typeof report.elapsedMs).toBe('number');
    expect(report.hits[0]).toMatchObject({ phase: 'narrow' });
  });
});

describe('NoopAssembler 三模式装配状态机', () => {
  function freshAssembler(): { a: AssemblyController; c: ClearanceController } {
    const c: ClearanceController = new NoopClearance();
    const a: AssemblyController = new NoopAssembler(c);
    a.load(makeBom());
    return { a, c };
  }

  it('load 后回手动模式且步骤为 0', () => {
    const { a } = freshAssembler();
    expect(a.mode).toBe('manual');
    expect(a.currentStepSeq).toBe(0);
    expect(a.assembledPartIds).toHaveLength(0);
    expect(a.bom).not.toBeNull();
  });

  it('assemble 严格按工艺步骤序推进，错序/重复被拒', () => {
    const { a } = freshAssembler();
    // 错序：第一步应是 base，却先装 shaft_1 → 拒绝
    expect(a.assemble('shaft_1')).toBe(false);
    expect(a.assemble('base')).toBe(true);
    expect(a.assemble('base')).toBe(false); // 重复装配拒绝
    expect(a.assemble('shaft_1')).toBe(true);
    expect(a.currentStepSeq).toBe(2);
  });

  it('undo 回退最近一步且不越过起点', () => {
    const { a } = freshAssembler();
    a.assemble('base');
    a.assemble('shaft_1');
    expect(a.currentStepSeq).toBe(2);
    expect(a.undo()).toBe(true);
    expect(a.currentStepSeq).toBe(1);
    expect(a.assembledPartIds).toEqual(['base']);
    a.undo();
    a.undo();
    expect(a.undo()).toBe(false); // 空栈不可再退
  });

  it('seekTo 按步回填已装配集合，越界拒绝', () => {
    const { a } = freshAssembler();
    expect(a.seekTo(2)).toBe(true);
    expect(a.assembledPartIds).toEqual(['base', 'shaft_1']);
    expect(a.seekTo(99)).toBe(false);
    expect(a.seekTo(-1)).toBe(false);
  });

  it('manual 模式下 play 被拒，切到 auto/replay 后可播放', () => {
    const { a } = freshAssembler();
    expect(a.play()).toBe(false); // manual 不可自动播放
    expect(a.switchMode('auto').ok).toBe(true);
    expect(a.play()).toBe(true);
    a.pause();
    expect(a.switchMode('replay').ok).toBe(true);
  });
});

describe('门面 syncAssemblyState（S1 分态同步口径）', () => {
  it('Noop 后端：seated/scattered 与装配状态机 assembledPartIds 一致', async () => {
    const engine = createSimEngine(); // node 环境回落 noop
    await engine.init({
      line: { id: 'L1', name: '', kind: 'sorting', stations: [], enabled: true, modelVersion: '', createdAt: '', updatedAt: '' },
      bom: makeBom(),
    });
    engine.assembly.load(makeBom());
    // 起始全待装配 → 0 seated
    expect(engine.syncAssemblyState()).toEqual({ seated: 0, scattered: 3 });
    // 依次装配 base、shaft_1 → seated 递增
    engine.assembly.assemble('base');
    expect(engine.syncAssemblyState()).toEqual({ seated: 1, scattered: 2 });
    engine.assembly.assemble('shaft_1');
    expect(engine.syncAssemblyState()).toEqual({ seated: 2, scattered: 1 });
    // undo 回退 → 一件回到待装配
    engine.assembly.undo();
    expect(engine.syncAssemblyState()).toEqual({ seated: 1, scattered: 2 });
    engine.dispose();
  });
});

describe('门面装配动画（S2 auto/replay 播放态契约）', () => {
  it('resetForPlay 保留不可动基座，其余零件回待装配', async () => {
    const engine = createSimEngine(); // noop
    await engine.init({ line: { id: 'L1', name: '', kind: 'sorting', stations: [], enabled: true, modelVersion: '', createdAt: '', updatedAt: '' }, bom: makeBom() });
    engine.assembly.load(makeBom());
    engine.assembly.seekTo(3); // 先到全贴合
    expect(engine.syncAssemblyState()).toEqual({ seated: 3, scattered: 0 });
    const r = engine.resetForPlay();
    expect(r).toEqual({ seated: 1, scattered: 2 });
    expect(engine.animState.cursorSeq).toBe(1);
    expect(engine.animState.done).toBe(false);
    engine.dispose();
  });

  it('manual 模式 playAssembly 被拒；切 auto 后可播放且播放态如实', async () => {
    const engine = createSimEngine(); // noop
    await engine.init({ line: { id: 'L1', name: '', kind: 'sorting', stations: [], enabled: true, modelVersion: '', createdAt: '', updatedAt: '' }, bom: makeBom() });
    engine.assembly.load(makeBom());
    // manual 下不可自动播放
    expect(engine.assembly.mode).toBe('manual');
    expect(engine.playAssembly()).toBe(false);
    // 切 auto/replay 后可播放
    engine.assembly.switchMode('auto');
    expect(engine.playAssembly()).toBe(true);
    expect(engine.animState.playing).toBe(false); // Noop 无帧循环 → 不处于真实播放
    engine.pauseAssembly();
    engine.dispose();
  });
});

describe('门面手动拖拽（S3 manual drag · Noop 镜像 contract）', () => {
  async function loadedManual() {
    const engine = createSimEngine(); // noop
    await engine.init({ line: { id: 'L1', name: '', kind: 'sorting', stations: [], enabled: true, modelVersion: '', createdAt: '', updatedAt: '' }, bom: makeBom() });
    engine.assembly.load(makeBom());
    engine.assembly.assemble('base'); // step0 → step1，下一待装 = shaft_1
    return engine;
  }

  it('beginDrag 仅允许"下一步待装"散落件；装配中件/非下一序被拒', async () => {
    const engine = await loadedManual();
    expect(engine.assembly.currentStepSeq).toBe(1);
    // 下一步 shaft_1 可拖
    expect(engine.interaction.beginDrag('shaft_1')).toBe(true);
    expect(engine.interaction.dragState.dragging).toBe(true);
    expect(engine.interaction.dragState.partId).toBe('shaft_1');
    expect(engine.interaction.dragState.reason).toBe('dragging');
    // 非下一序（shaft_2）被拒
    expect(engine.interaction.beginDrag('shaft_2')).toBe(false);
    expect(engine.interaction.dragState.reason).toBe('not-movable');
    // 已装配件（base）被拒
    expect(engine.interaction.beginDrag('base')).toBe(false);
    expect(engine.interaction.dragState.reason).toBe('not-movable');
    engine.dispose();
  });

  it('endDrag 对下一步件返回 ok（镜像贴合）；dragState 收束', async () => {
    const engine = await loadedManual();
    engine.interaction.beginDrag('shaft_1');
    expect(engine.interaction.dragState.reason).toBe('dragging');
    const r = engine.interaction.endDrag('shaft_1');
    expect(r.ok).toBe(true);
    expect(engine.interaction.dragState.dragging).toBe(false);
    expect(engine.interaction.dragState.reason).toBe('landed');
    engine.dispose();
  });

  it('dragState 缺省为 idle（未拖拽）', async () => {
    const engine = createSimEngine();
    await engine.init({ line: { id: 'L1', name: '', kind: 'sorting', stations: [], enabled: true, modelVersion: '', createdAt: '', updatedAt: '' }, bom: makeBom() });
    expect(engine.interaction.dragState.reason).toBe('idle');
    expect(engine.interaction.dragState.dragging).toBe(false);
    engine.dispose();
  });
});
