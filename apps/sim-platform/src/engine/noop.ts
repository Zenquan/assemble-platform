/**
 * SimEngine 的 Noop 测试替身实现（本轮范围）
 *
 * 目的（对应本轮交付验收）：
 *   1. **接口稳定**：不 import '@babylonjs/core'，业务组件可安全注入本实现先行开发，
 *      后续切换真 Babylon 实现只改 `createSimEngine` 工厂返回，业务代码零改动。
 *   2. **可被 mock / 可真跑算法**：渲染类能力（Scene/Asset/Interaction 视觉部分）为
 *      类型安全的 no-op；装配状态机（mode/step/已装配集合）与实时干涉 **复用
 *      clearance-core 纯算法真实执行** —— 从而装配/干涉契约可被 vitest 无 WebGL 验证。
 *
 * 本文件内约定：
 *   - 命名带 `Noop*` 前缀的即纯占位实现；`NoopAssembler` / `NoopClearance` 为真实逻辑。
 *   - 绝无 DOM / WebGL / Babylon 副作用（DOM 依赖集中在 SceneManager 的 mount 入参）。
 */

import { ClearanceDetector, type ClearancePart } from '@assemble/clearance-core';
import type { AssemblyBom, AssemblyMode, InterferenceHit, OBB, ProductionLine } from '@assemble/domain';

import type {
  AssemblyController,
  AssetManager,
  CameraPose,
  CameraViewId,
  ClearanceController,
  DragLiveState,
  EngineHealth,
  InteractionManager,
  ModeSwitchResult,
  PickResult,
  SceneManager,
  SimEngine,
  RuntimeAnimationController,
} from './types.js';

/* ------------------------------------------------------------------ */
/* 相机位姿默认表（noop 亦返回稳定值，供 UI 读取视角状态）             */
/* ------------------------------------------------------------------ */

const CAMERA_PRESETS: Record<CameraViewId, CameraPose> = {
  iso: { viewId: 'iso', position: [120, 160, 200], target: [0, 40, 0], orthographic: true },
  front: { viewId: 'front', position: [0, 80, 220], target: [0, 40, 0], orthographic: true },
  top: { viewId: 'top', position: [0, 260, 0], target: [0, 40, 0], orthographic: true },
  side: { viewId: 'side', position: [240, 80, 0], target: [0, 40, 0], orthographic: true },
  free: { viewId: 'free', position: [150, 180, 150], target: [0, 40, 0], orthographic: false },
};

/* ------------------------------------------------------------------ */
/* 实时干涉控制器 —— 委托 clearance-core 纯算法（真实逻辑）           */
/* ------------------------------------------------------------------ */

export class NoopClearance implements ClearanceController {
  private detector = new ClearanceDetector();

  registerAssembled(parts: ReadonlyArray<{ partId: string; obb: OBB }>): number {
    const mapped: ClearancePart[] = parts.map((p) => ({ partId: p.partId, obb: p.obb }));
    this.detector.loadAll(mapped);
    return this.detector.partCount;
  }

  queryInteractive(moving: { partId: string; obb: OBB }): InterferenceHit[] {
    const part: ClearancePart = { partId: moving.partId, obb: moving.obb };
    // clearance 的 queryInteractive 返回"命中的已存在零件 id"，据此组装 hits。
    // 为获得稳定 phase 标注，这里返回轻量命中（阶段统一 narrow，供 UI 展示）。
    const hitIds = this.detector.queryInteractive(part);
    return hitIds.map((otherId) => ({
      firstPartId: moving.partId < otherId ? moving.partId : otherId,
      secondPartId: moving.partId < otherId ? otherId : moving.partId,
      severity: 'error',
      overlapEstimate: 1,
      contactPoint: [0, 0, 0] as const,
      phase: 'narrow',
    }));
  }

  runFull(parts: ReadonlyArray<{ partId: string; obb: OBB }>): import('@assemble/domain').InterferenceReport {
    const mapped: ClearancePart[] = parts.map((p) => ({ partId: p.partId, obb: p.obb }));
    const r = this.detector.loadAll(mapped).runFull();
    return {
      reportId: `fe-${Date.now().toString(36)}`,
      lineId: '',
      source: 'interactive',
      totalPartCount: r.totalPartCount,
      pairsChecked: r.pairsChecked,
      hitCount: r.hits.length,
      hits: r.hits,
      elapsedMs: r.elapsedMs,
      broadCullRatio: r.broadCullRatio,
      createdAt: new Date().toISOString(),
    };
  }
}

class NoopRuntime implements RuntimeAnimationController {
  readonly boundNodeCount = 0;
  readonly playing = false;

  start(): boolean {
    return false;
  }

  pause(): boolean {
    return true;
  }

  reset(): void {
    // Noop 没有 Babylon 节点可复位。
  }
}

/* ------------------------------------------------------------------ */
/* 装配状态机 —— 真实三模式/步骤/集合状态（无渲染依赖，可单测）        */
/* ------------------------------------------------------------------ */

export class NoopAssembler implements AssemblyController {
  private _mode: AssemblyMode = 'manual';
  private _bom = null as AssemblyController['bom'];
  private _assembled: string[] = [];
  private _step = 0;
  private _playing = false;
  readonly clearance: ClearanceController;

  constructor(clearance: ClearanceController) {
    this.clearance = clearance;
  }

  get mode(): AssemblyMode {
    return this._mode;
  }
  get assembledPartIds(): readonly string[] {
    return this._assembled;
  }
  get currentStepSeq(): number {
    return this._step;
  }
  get bom() {
    return this._bom;
  }

  load(bom: NonNullable<AssemblyController['bom']>): void {
    this._bom = bom;
    this._assembled = [];
    this._step = 0;
    this._playing = false;
    // 初始清空算法集合（装配从 0 开始）
    this.clearance.registerAssembled([]);
  }

  switchMode(to: AssemblyMode): ModeSwitchResult {
    const from = this._mode;
    if (from === to) return { from, to, ok: true };
    // 手动模式离开前若有"正拖拽未落位"零件则拒绝（本轮简化：无可拖拽状态即放行）
    this._mode = to;
    return { from, to, ok: true };
  }

  /** 按当前装配顺序取出"下一待装配"零件（auto/replay 用） */
  private nextPendingPartId(): string | undefined {
    if (!this._bom) return undefined;
    const done = new Set(this._assembled);
    return this._bom.parts.find((p) => !done.has(p.id))?.id;
  }

  assemble(partId: string): boolean {
    if (!this._bom || this._assembled.includes(partId)) return false;
    // 手动模式允许任意顺序？否 —— 严格按步骤序保证与工艺一致。
    const expected = this._bom.steps[this._step];
    if (!expected || expected.partId !== partId) return false;
    this._assembled.push(partId);
    this._step += 1;
    return true;
  }

  undo(): boolean {
    if (this._assembled.length === 0) return false;
    const removed = this._assembled.pop();
    if (removed) this._step = Math.max(0, this._step - 1);
    return true;
  }

  play(): boolean {
    if (this._mode === 'manual') return false;
    this._playing = true;
    return true;
  }
  pause(): boolean {
    this._playing = false;
    return true;
  }

  seekTo(stepSeq: number): boolean {
    if (!this._bom) return false;
    const n = this._bom.steps.length;
    if (stepSeq < 0 || stepSeq > n) return false;
    this._step = stepSeq;
    this._assembled = this._bom.steps.slice(0, stepSeq).map((s) => s.partId);
    return true;
  }

  checkPlacement(partId: string, targetObb: OBB): InterferenceHit[] | null {
    // 手动模式落位校验：把"待装配件目标位姿"与"已装配集合"做实时检测。
    const hits = this.clearance.queryInteractive({ partId, obb: targetObb });
    return hits.length > 0 ? hits : null;
  }
}

/* ------------------------------------------------------------------ */
/* 占位能力（渲染相关，本轮不真跑 WebGL）                              */
/* ------------------------------------------------------------------ */

class NoopScene implements SceneManager {
  private viewId: CameraViewId = 'iso';
  private rendering = false;
  private mounted = false;

  mount(_container: HTMLElement): boolean {
    this.mounted = true;
    return true;
  }
  unmount(): void {
    this.mounted = false;
    this.rendering = false;
  }
  setCamera(viewId: CameraViewId): CameraPose {
    this.viewId = viewId;
    return CAMERA_PRESETS[viewId];
  }
  frameToPart(_partIds: readonly string[]): void {
    /* noop：真 Babylon 实现时改为聚焦包围盒 */
  }
  requestRender(): boolean {
    return this.mounted;
  }
  setRendering(on: boolean): void {
    this.rendering = on;
  }
}

class NoopAssets implements AssetManager {
  private _loaded = 0;
  get loadedPartCount(): number {
    return this._loaded;
  }
  async loadLine(_line: ProductionLine, bom: AssemblyBom): Promise<readonly string[]> {
    // Noop 不创建可见几何，仅镜像后端 BOM 的零件集合。
    const ids = bom.parts.map((p) => p.id);
    this._loaded = ids.length;
    return ids;
  }
  dispose(): void {
    this._loaded = 0;
  }
}

class NoopInteraction implements InteractionManager {
  /** 拖拽中零件的最近命中（noop 无真实射线，仅供记录/测试覆盖） */
  private picked: PickResult = { partId: '', ok: false };

  /** Noop 装配状态机引用（用于镜像"下一步序可拖"门槛与落位裁决） */
  private assembler: NoopAssembler | null = null;

  /** 会话实时状态（noop 无几何，不搬网格；如实反映 ordering 门槛与会话生命周期） */
  private _drag: DragLiveState = {
    dragging: false,
    partId: '',
    blocked: false,
    hitPartId: '',
    nearSeat: false,
    canLand: false,
    reason: 'idle',
  };

  /** 由宿主（NoopSimEngine）注入装配状态机，供拖拽门槛/落位镜像 */
  bind(assembler: NoopAssembler): void {
    this.assembler = assembler;
  }

  pick(_clientX: number, _clientY: number): PickResult {
    // 未接真实射线：返回上一次记录（无命中表则 miss）
    return this.picked;
  }

  /** 仅"下一步待装配"的散落件可拖（镜像 babylon 真拾取后的门槛） */
  beginDrag(partId: string): boolean {
    const as = this.assembler;
    if (!as) return false;
    const next = as.bom?.steps[as.currentStepSeq];
    const draggable = !!next && next.partId === partId && !as.assembledPartIds.includes(partId);
    this.picked = { partId, ok: draggable };
    if (!draggable) {
      this._drag = { dragging: false, partId, blocked: false, hitPartId: '', nearSeat: false, canLand: false, reason: 'not-movable' };
      return false;
    }
    this._drag = { dragging: true, partId, blocked: false, hitPartId: '', nearSeat: true, canLand: true, reason: 'dragging' };
    return true;
  }

  dragTo(_partId: string, _delta: readonly [number, number, number]): void {
    // noop：位置由真引擎（babylon）计算；此处仅保持会话状态
  }

  endDrag(partId: string): { ok: boolean; hits: InterferenceHit[] } {
    const as = this.assembler;
    // 仅当确实是下一步序件 → 镜像落位成功（几何干涉判定归 babylon 真渲染）
    const next = as?.bom?.steps[as.currentStepSeq];
    const ok = !!next && next.partId === partId;
    this._drag = { dragging: false, partId: '', blocked: false, hitPartId: '', nearSeat: false, canLand: false, reason: ok ? 'landed' : 'snapped-back' };
    return { ok, hits: [] };
  }

  get dragState(): DragLiveState {
    return this._drag;
  }
}

/* ------------------------------------------------------------------ */
/* 顶层 NoopSimEngine + 工厂                                           */
/* ------------------------------------------------------------------ */

export class NoopSimEngine implements SimEngine {
  readonly backend = 'noop' as const;
  readonly scene: SceneManager;
  readonly assets: AssetManager;
  readonly interaction: InteractionManager;
  readonly assembly: AssemblyController;
  readonly clearance: ClearanceController;
  readonly runtime: RuntimeAnimationController;

  private _activeLineId: string | null = null;
  private _initialized = false;
  private _fps = 0;

  constructor() {
    this.clearance = new NoopClearance();
    this.scene = new NoopScene();
    this.assets = new NoopAssets();
    this.assembly = new NoopAssembler(this.clearance);
    this.runtime = new NoopRuntime();
    // 手动拖拽的 ordering 门槛镜像需引用装配状态机
    const interaction = new NoopInteraction();
    interaction.bind(this.assembly as NoopAssembler);
    this.interaction = interaction;
  }

  /** S2 门面契约 · 动画播放态（Noop 无帧循环，如实反映状态机 + 无真实播放） */
  private _animSnapshot(): SimEngine['animState'] {
    const total = this.assembly.bom?.steps.length ?? 0;
    return {
      playing: false,
      cursorSeq: this.assembly.currentStepSeq,
      totalSteps: total,
      done: this.assembly.currentStepSeq >= total,
    };
  }

  async init(opts: {
    container?: HTMLElement;
    line: import('@assemble/domain').ProductionLine;
    bom: AssemblyBom;
  }): Promise<EngineHealth> {
    if (opts.line.id !== opts.bom.lineId) throw new Error('产线与 BOM 不匹配');
    if (opts.container) this.scene.mount(opts.container);
    this._activeLineId = opts.line.id;
    await this.assets.loadLine(opts.line, opts.bom);
    this.assembly.load(opts.bom);
    this.assembly.seekTo(opts.bom.steps.length);
    this._initialized = true;
    this._fps = 0;
    return this.health();
  }

  dispose(): void {
    this.scene.unmount();
    this.assets.dispose();
    this._activeLineId = null;
    this._initialized = false;
  }

  /** S1 分态同步的 Noop 镜像：无真实网格，按状态机返回集合计数（视觉归属见 Babylon 后端） */
  syncAssemblyState(): { seated: number; scattered: number } {
    const seated = this.assembly.assembledPartIds.length;
    const total = this.assembly.bom?.parts.length ?? 0;
    return { seated, scattered: Math.max(0, total - seated) };
  }

  /** S2 · Noop 镜像：auto 播放推进由 animator 纯逻辑驱动（animator.test 覆盖逐步到位）；
   *  本门面在无帧循环后端不做瞬时快进，仅校验前置并如实反映状态（播放语义归 Babylon 真渲染）。 */
  playAssembly(): boolean {
    if (this.assembly.mode === 'manual') return false;
    if (!this.assembly.bom) return false;
    return this.assembly.play();
  }

  pauseAssembly(): boolean {
    this.assembly.pause();
    return true;
  }

  resetForPlay(): { seated: number; scattered: number } {
    const bom = this.assembly.bom;
    if (!bom) return this.syncAssemblyState();
    const firstMovableStep = bom.steps.findIndex((step) =>
      bom.parts.find((part) => part.id === step.partId)?.isMovable !== false,
    );
    this.assembly.seekTo(firstMovableStep < 0 ? bom.steps.length : firstMovableStep);
    return this.syncAssemblyState();
  }

  get animState(): SimEngine['animState'] {
    return this._animSnapshot();
  }

  health(): EngineHealth {
    return {
      ok: this._initialized,
      backend: 'noop',
      activeLineId: this._activeLineId,
      fps: this._fps,
      assembledParts: this.assembly.assembledPartIds.length,
      totalParts: this.assembly.bom?.parts.length ?? 0,
      rendering: false,
    };
  }
}

/** 工厂 —— 门面唯一构造入口；后续真 Babylon 实现在此按条件切换，业务不感知 */
export function createSimEngine(): SimEngine {
  return new NoopSimEngine();
}
