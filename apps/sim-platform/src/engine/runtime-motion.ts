/**
 * 设备运行态动画的纯时序与位姿采样器。
 *
 * GLB 只声明运动节点类型，具体节点句柄和材质仍由 Babylon 实现持有；本模块只
 * 计算相对基础位姿的偏移，因此可以在无 WebGL 环境中验证节拍、暂停与重置语义。
 */
import type { Vec3 } from '@assemble/domain';

export type RuntimeMotionKind =
  | 'translate-x-loop'
  | 'translate-incline-loop'
  | 'rotate-y'
  | 'vibrate-xz'
  | 'vibrate-radial'
  | 'bucket-gates'
  | 'close-open-x'
  | 'translate-y';

export interface RuntimeMotionSpec {
  nodeId: string;
  motion: RuntimeMotionKind;
  amplitude?: number;
  periodSeconds?: number;
  phase?: number;
}

export interface RuntimeMotionPose {
  translation: Vec3;
  rotation: Vec3;
  scale: Vec3;
}

export interface RuntimeMotionFrame {
  nodeId: string;
  pose: RuntimeMotionPose;
}

interface MotionDefaults {
  amplitude: number;
  periodSeconds: number;
}

const MOTION_DEFAULTS: Record<RuntimeMotionKind, MotionDefaults> = {
  'translate-x-loop': { amplitude: 0.12, periodSeconds: 1.8 },
  'translate-incline-loop': { amplitude: 0.18, periodSeconds: 2.2 },
  'rotate-y': { amplitude: 1, periodSeconds: 1.6 },
  'vibrate-xz': { amplitude: 0.035, periodSeconds: 0.24 },
  'vibrate-radial': { amplitude: 0.045, periodSeconds: 0.28 },
  'bucket-gates': { amplitude: 0.32, periodSeconds: 1.4 },
  'close-open-x': { amplitude: 0.34, periodSeconds: 1.2 },
  'translate-y': { amplitude: 0.18, periodSeconds: 1.1 },
};

const TAU = Math.PI * 2;

function cyclePosition(seconds: number, periodSeconds: number, phase: number): number {
  const cycle = seconds / periodSeconds + phase;
  return ((cycle % 1) + 1) % 1;
}

function cycleSine(seconds: number, periodSeconds: number, phase: number): number {
  return Math.sin(cyclePosition(seconds, periodSeconds, phase) * TAU);
}

function poseFor(spec: RuntimeMotionSpec, elapsedSeconds: number): RuntimeMotionPose {
  const defaults = MOTION_DEFAULTS[spec.motion];
  const amplitude = Math.max(0, spec.amplitude ?? defaults.amplitude);
  const periodSeconds = Math.max(0.001, spec.periodSeconds ?? defaults.periodSeconds);
  const phase = spec.phase ?? 0;
  const sine = cycleSine(elapsedSeconds, periodSeconds, phase);

  switch (spec.motion) {
    case 'translate-x-loop':
      return { translation: [sine * amplitude, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] };
    case 'translate-incline-loop':
      return { translation: [sine * amplitude, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] };
    case 'rotate-y':
      return {
        translation: [0, 0, 0],
        rotation: [0, cyclePosition(elapsedSeconds, periodSeconds, phase) * TAU * amplitude, 0],
        scale: [1, 1, 1],
      };
    case 'vibrate-xz':
      return {
        translation: [sine * amplitude, 0, Math.cos(cyclePosition(elapsedSeconds, periodSeconds, phase) * TAU) * amplitude * 0.7],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
      };
    case 'vibrate-radial':
      return {
        translation: [sine * amplitude, 0, Math.cos(cyclePosition(elapsedSeconds, periodSeconds, phase) * TAU) * amplitude],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
      };
    case 'bucket-gates':
      return {
        translation: [0, 0, 0],
        rotation: [sine * amplitude * 0.45, 0, 0],
        scale: [1, 1, 1],
      };
    case 'close-open-x':
      return {
        translation: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [1 - (0.5 + sine * 0.5) * amplitude, 1, 1],
      };
    case 'translate-y':
      return {
        translation: [0, Math.max(0, sine) * amplitude, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
      };
  }
}

export class RuntimeMotionPlayer {
  private readonly specs: readonly RuntimeMotionSpec[];
  private elapsedSeconds = 0;
  private lastNowMs: number | null = null;
  private _playing = false;

  constructor(specs: readonly RuntimeMotionSpec[]) {
    this.specs = specs;
  }

  get playing(): boolean {
    return this._playing;
  }

  get elapsed(): number {
    return this.elapsedSeconds;
  }

  get bindingCount(): number {
    return this.specs.length;
  }

  start(nowMs: number): boolean {
    if (this.specs.length === 0) return false;
    if (this._playing) return true;
    this.lastNowMs = nowMs;
    this._playing = true;
    return true;
  }

  pause(nowMs?: number): boolean {
    if (this._playing && nowMs !== undefined) this.advance(nowMs);
    this._playing = false;
    this.lastNowMs = null;
    return true;
  }

  reset(): void {
    this.elapsedSeconds = 0;
    this.lastNowMs = null;
    this._playing = false;
  }

  tick(nowMs: number): readonly RuntimeMotionFrame[] {
    if (this._playing) this.advance(nowMs);
    return this.specs.map((spec) => ({ nodeId: spec.nodeId, pose: poseFor(spec, this.elapsedSeconds) }));
  }

  private advance(nowMs: number): void {
    if (this.lastNowMs !== null) {
      this.elapsedSeconds += Math.max(0, nowMs - this.lastNowMs) / 1000;
    }
    this.lastNowMs = nowMs;
  }
}

