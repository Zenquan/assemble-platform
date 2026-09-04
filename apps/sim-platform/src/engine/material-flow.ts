import type { Vec3 } from '@assemble/domain';

export interface MaterialFlowWaypoint {
  id: string;
  position: Vec3;
}

export interface MaterialFlowFrame {
  itemId: string;
  position: Vec3;
  stationId: string;
}

export class MaterialFlowPlayer {
  private readonly waypoints: readonly MaterialFlowWaypoint[];
  private readonly itemOffsets: readonly number[];
  private readonly cycleSeconds: number;
  private elapsedSeconds = 0;
  private lastNowMs: number | null = null;
  private _playing = false;

  constructor(
    waypoints: readonly MaterialFlowWaypoint[],
    opts: { itemCount?: number; cycleSeconds?: number } = {},
  ) {
    this.waypoints = waypoints;
    const itemCount = Math.max(0, Math.floor(opts.itemCount ?? 6));
    this.itemOffsets = Array.from({ length: itemCount }, (_, index) => index / itemCount);
    this.cycleSeconds = Math.max(0.1, opts.cycleSeconds ?? Math.max(4, waypoints.length * 1.6));
  }

  get playing(): boolean {
    return this._playing;
  }

  get itemCount(): number {
    return this.itemOffsets.length;
  }

  get completedUnits(): number {
    return Math.floor(this.elapsedSeconds / this.cycleSeconds) * this.itemCount;
  }

  start(nowMs: number): boolean {
    if (this.itemCount === 0 || this.waypoints.length < 2) return false;
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

  tick(nowMs: number): readonly MaterialFlowFrame[] {
    if (this._playing) this.advance(nowMs);
    return this.itemOffsets.map((offset, index) => {
      const progress = ((this.elapsedSeconds / this.cycleSeconds + offset) % 1 + 1) % 1;
      return {
        itemId: `material-${index + 1}`,
        ...this.positionAt(progress),
      };
    });
  }

  private advance(nowMs: number): void {
    if (this.lastNowMs !== null) {
      this.elapsedSeconds += Math.max(0, nowMs - this.lastNowMs) / 1000;
    }
    this.lastNowMs = nowMs;
  }

  private positionAt(progress: number): { position: Vec3; stationId: string } {
    const first = this.waypoints[0];
    if (!first) return { position: [0, 0, 0], stationId: '' };
    if (this.waypoints.length === 1) {
      return { position: [...first.position] as Vec3, stationId: first.id };
    }

    const segmentProgress = progress * (this.waypoints.length - 1);
    const segmentIndex = Math.min(this.waypoints.length - 2, Math.floor(segmentProgress));
    const from = this.waypoints[segmentIndex] ?? first;
    const to = this.waypoints[segmentIndex + 1] ?? from;
    const localProgress = segmentProgress - segmentIndex;
    return {
      position: [
        from.position[0] + (to.position[0] - from.position[0]) * localProgress,
        from.position[1] + (to.position[1] - from.position[1]) * localProgress,
        from.position[2] + (to.position[2] - from.position[2]) * localProgress,
      ],
      stationId: to.id,
    };
  }
}
