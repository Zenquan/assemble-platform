/**
 * S2 · 装配过程动画 —— 纯逻辑驱动器（引擎无关，可无 WebGL 单测）
 *
 * 职责（对齐 FEAT-20260903-003 S2「装配过程动画 auto/replay 散落→贴合，seek/undo 跳变」）：
 *   1. 持有每个零件在 `placement.ts` 里算好的 seat/scatter 两目标位；
 *   2. 维护"飞行表"——正从 scatter 平滑滑向 seat 的零件（过渡中）；
 *   3. `play()` 按 BOM 步骤序 + `AssemblyStep.durationSeconds` 逐件**自动推进**，
 *      每播完一件回调 onAssemble(partId) 让宿主把它正式落进 assembled 集合；
 *   4. `seekTo(seq)` / `undo()` 走**跳变**（清飞行表，不插帧）——与 S1 瞬时一致；
 *   5. `pose(partId, fallback)` 供渲染层每帧消费：飞行中的件返回插值位，否则 null
 *      （渲染层回落到 S1 的 seat/scatter 判定）。
 *
 * 本模块**不 import 任何渲染句柄 / 状态机实现**：
 *   - `placements` 来自纯 placement.ts；
 *   - "贴合动作"通过注入回调 onAssemble 解耦——宿主（Noop 断言 / Babylon 真渲染）
 *     各自实现为调用装配机的 assemble(partId)。时钟可注入（默认 performance.now），
 *     单测注入假时钟即可锁定推进节奏。
 */
import type { AssemblyStep, Vec3 } from '@assemble/domain';
import type { PartPlacement } from './placement.js';
import { easeInOutCubic, progressAt, type EaseFn } from './ease.js';

/** 时钟：返回当前时间（ms）。默认 performance.now；单测注入假时钟。 */
export type Clock = () => number;

/** 一条"正在 scatter→seat 平滑过渡"的飞行记录 */
export interface Flight {
  partId: string;
  /** 该件本次落位对应的步骤 seq（用于进度/日志） */
  seq: number;
  /** 起点 = scatter 待料位 */
  from: Vec3;
  /** 终点 = seat 贴合位 */
  to: Vec3;
  /** 过渡起止（ms，驱动时钟域） */
  t0: number;
  t1: number;
}

/** pose() 的回落输入：渲染层应据 assembledIds 判定 seat/scatter（S1 语义由宿主传给 fallback） */
export interface AnimatorOptions {
  /** 每件 seat/scatter 布局（来自 computeTwoStatePlacement） */
  placements: PartPlacement[];
  /** 只读步骤序（seq 升序）；时长取 step.durationSeconds */
  getSteps: () => AssemblyStep[];
  /** 播放到某步完成时回调该件的落位动作（宿主=调装配机 assemble） */
  onAssemble: (partId: string) => void;
  /** 时钟（默认 performance.now） */
  now?: Clock;
  /** 缓动（默认 easeInOutCubic） */
  ease?: EaseFn;
}

/** tick()/play 后给宿主的本次步进快照 */
export interface AnimTick {
  /** 本次已贴合的零件 id（若无则 null） */
  seatedPartId: string | null;
  /** 全部步骤完成 */
  done: boolean;
  /** 当前进度 seq / 总数 */
  stepSeq: number;
  stepsTotal: number;
}

/** 各零件当前应停目标位的惰性解析器：飞行中→插值位；否则 null（宿主回落 S1） */
export interface PoseQuery {
  /** 若该件正在飞行，返回其当前插值位置；否则 null */
  (partId: string): Vec3 | null;
}

export class AssemblyAnimator {
  private placements: Map<string, PartPlacement>;
  private getSteps: () => AssemblyStep[];
  private onAssemble: (partId: string) => void;
  private now: Clock;
  private ease: EaseFn;

  /** 飞行表：partId -> 在途过渡（同一时刻至多一件在播 auto，undo/seek 时清空） */
  private flights = new Map<string, Flight>();
  /** 播放器游标：当前"将要贴合"的步骤 seq（0 起点；== stepsTotal 表示播完） */
  private cursor = 0;
  private stepsTotal = 0;
  private _playing = false;
  /** 下一次贴合触发时刻（驱动时钟域），播放节奏由 durationSeconds 决定 */
  private nextSeatAt = -1;

  constructor(opts: AnimatorOptions) {
    this.placements = new Map(opts.placements.map((p) => [p.partId, p]));
    this.getSteps = opts.getSteps;
    this.onAssemble = opts.onAssemble;
    this.now = opts.now ?? (typeof performance !== 'undefined' ? () => performance.now() : () => Date.now());
    this.ease = opts.ease ?? easeInOutCubic;
    this.stepsTotal = opts.getSteps().length;
  }

  /** 由外部初始化播放游标（如引擎 init 已 seek 到全贴合） */
  syncCursor(seq: number): void {
    this.cursor = Math.max(0, Math.min(seq, this.stepsTotal));
    this.flights.clear();
    this._playing = false;
    this.nextSeatAt = -1;
  }

  /** 读取当前播放状态（供 HUD / 测试断言） */
  get playing(): boolean {
    return this._playing;
  }
  get cursorSeq(): number {
    return this.cursor;
  }
  get totalSteps(): number {
    return this.stepsTotal;
  }
  /** 是否有在途飞行件（渲染层据此判断是否需插值） */
  get hasFlight(): boolean {
    return this.flights.size > 0;
  }
  get flyingPartId(): string | null {
    return this.flights.size > 0 ? this.flights.keys().next().value ?? null : null;
  }

  /** 装配动画时长：步骤 durationSeconds → ms */
  durationMs(step: AssemblyStep): number {
    const s = step.durationSeconds ?? 1;
    return Math.max(0, s * 1000);
  }

  /** 开始自动播放：从当前游标起，按 steps 逐件贴合（每件播 durationSeconds 过渡）。返回是否成功开始 */
  play(): boolean {
    if (this.cursor >= this.stepsTotal) {
      this._playing = false;
      return false;
    }
    if (this._playing) return true;
    this._playing = true;
    if (this.nextSeatAt < 0) this.nextSeatAt = this.now();
    return true;
  }

  pause(): boolean {
    this._playing = false;
    return true;
  }

  /**
   * 跳变到某步骤：清空飞行表 + 停止播放 + 游标对齐。
   * 宿主应随后用装配机 seekTo(seq) 把 assembled 集合同步（本类不直接持有集合）。
   */
  seekTo(seq: number): boolean {
    if (seq < 0 || seq > this.stepsTotal) return false;
    this.cursor = seq;
    this.flights.clear();
    this._playing = false;
    this.nextSeatAt = -1;
    return true;
  }

  /** 撤销一步：跳变回退游标，清飞行（宿主自行 undo 装配机集合） */
  undoStep(): boolean {
    if (this.cursor <= 0) return false;
    this.cursor -= 1;
    this.flights.clear();
    this._playing = false;
    this.nextSeatAt = -1;
    return true;
  }

  /**
   * 每帧推进（渲染循环 / 测试假时钟驱动）。
   * - 若正在播放：到点则贴合下一件（回调 onAssemble），并把它登记进飞行表让渲染播过渡；
   * - 推进飞行表里在途件的进度（按 now 自然推移）。
   * @param nowMs 可选推进时刻；缺省用注入时钟 now()
   */
  tick(nowMs?: number): AnimTick {
    const now = nowMs ?? this.now();
    let seatedPartId: string | null = null;
    let done = this.cursor >= this.stepsTotal;

    // 播放推进：到点贴合下一件（登记飞行，让散落→贴合走缓动）
    if (this._playing && !done) {
      const steps = this.getSteps();
      const step = steps[this.cursor];
      if (step && now >= this.nextSeatAt) {
        const pl = this.placements.get(step.partId);
        const start = this.now();
        const dur = this.durationMs(step);
        if (pl) {
          // 起点 = scatter（待料位），终点 = seat（贴合位）；若已在贴合位则秒到位
          this.flights.set(step.partId, {
            partId: step.partId,
            seq: step.seq,
            from: pl.scatter as Vec3,
            to: pl.seat as Vec3,
            t0: start,
            t1: start + dur,
          });
          this.onAssemble(step.partId); // 宿主把它正式落进 assembled 集合
          seatedPartId = step.partId;
        }
        this.cursor += 1;
        // 下一件贴合时刻 = 本件过渡完成后再留一帧间隙
        this.nextSeatAt = this.cursor < steps.length ? start + dur : now;
      }
    }

    // 推进/清理飞行表：过渡已结束的件从飞行表移除（此后由 S1 seat/scatter 判定接管）
    for (const [partId, f] of [...this.flights]) {
      if (now >= f.t1) {
        this.flights.delete(partId);
      }
    }

    done = this.cursor >= this.stepsTotal;
    if (done) this._playing = false;
    return {
      seatedPartId,
      done,
      stepSeq: this.cursor,
      stepsTotal: this.stepsTotal,
    };
  }

  /**
   * 渲染层每帧查询某件的"飞行插值位"：若该件在飞行中返回当前位置，否则 null。
   * 宿主逻辑：pos = animator.pose(id); mesh.position = pos ?? (assembled? seat : scatter)
   */
  pose(partId: string, nowMs?: number): Vec3 | null {
    const f = this.flights.get(partId);
    if (!f) return null;
    const now = nowMs ?? this.now();
    const k = progressAt(now, f.t0, f.t1, this.ease);
    return [
      f.from[0] + (f.to[0] - f.from[0]) * k,
      f.from[1] + (f.to[1] - f.from[1]) * k,
      f.from[2] + (f.to[2] - f.from[2]) * k,
    ] as Vec3;
  }
}
