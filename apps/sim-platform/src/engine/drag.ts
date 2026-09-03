/**
 * S3 · 手动装配拖拽 —— 纯逻辑裁决（无 Babylon / WebGL / DOM，可被 vitest 锁定）
 *
 * 语义（FEAT-20260903-003 S3，方案A：射线拾取 + 平面拖拽）：
 *   在 manual 模式点选一件**散落待装**零件后，把它在**自己的贴合位高度**（planeY = 该件
 *   seat 的 y）上沿 XZ 平面随指针平移；拖拽中每帧用 clearance.queryInteractive 判定是否与
 *   已装配集合干涉（命中 → 变红/不可落位）；松开时裁决：
 *     - 候选中心与 seat 的 XZ 距离 ≤ snapRadius 且无干涉 → 可落位（贴合）；
 *     - 否则 → 回 scatter（或停在被拦截处，由引擎会话决定）。
 *
 * 本模块只承担**引擎无关的纯判定**，输入/输出均为可序列化值类型：
 *   - `planeCenterAtCursor`：把指针在水平拖拽平面上的命中点（cursor XZ）换算为候选中心；
 *   - `canSnap`：XZ 是否已贴近 seat（吸附半径内）；
 *   - `clearOfAssembled`：经注入的 clearance.queryInteractive 判定候选是否干净。
 * 射线↔平面求交、pointer 监听、网格位移等渲染侧逻辑放 babylon.ts（引擎唯一边界）。
 */
import type { InterferenceHit, OBB, Vec3 } from '@assemble/domain';
import { obbFromCenterHalfExtents } from '@assemble/clearance-core';
import type { DragLiveState } from './types.js';

/* ------------------------------------------------------------------ */
/* 输入几何                                                            */
/* ------------------------------------------------------------------ */

/** 一个待拖拽零件的渲染几何输入（center=seat 中心，half=轴对齐半轴长） */
export interface DragBox {
  partId: string;
  /** 贴合基准中心（seat），其 y 即水平拖拽平面高度 */
  center: Vec3;
  /** 轴对齐半轴长（用于构造 OBB 与吸附距离估计） */
  half: Vec3;
}

/** 当前候选中心是否允许贴合的结果 */
export interface DragAdjudication {
  /** 候选中心（世界坐标） */
  candidate: Vec3;
  /** XZ 平面已贴近 seat（吸附半径内）→ 具备贴合前提 */
  canSnap: boolean;
  /** 与已装配集合是否干净（无干涉） */
  clear: boolean;
  /** 若被拦截：命中的已装配件清单（供 UI 变红/提示） */
  hits: InterferenceHit[];
  /** 综合裁决：可落位 = canSnap && clear */
  land: boolean;
}

/** 实时干涉查询回调（由宿主注入 clearance.queryInteractive 的领域等价） */
export type QueryInteractive = (
  moving: { partId: string; obb: OBB },
) => InterferenceHit[];

/* ------------------------------------------------------------------ */
/* 几何：OBB / 平面换算 / 吸附判定                                     */
/* ------------------------------------------------------------------ */

/** 由中心 + 半轴长构造轴对齐 OBB（拖拽件未旋转 → 轴向即世界轴） */
export function boxObbAt(center: Vec3, half: Vec3): OBB {
  return obbFromCenterHalfExtents([center[0], center[1], center[2]], half);
}

/**
 * 把「指针在水平拖拽平面（y=planeY）上的命中点 XZ」换算为该件的候选中心。
 * 拖拽件保持自身 seat 高度 planeY，只随指针在 XZ 平移（planeY 由宿主锁定为零件 seat.y）。
 */
export function candidateCenterAt(
  cursorWorld: { x: number; y: number; z: number },
  planeY: number,
): Vec3 {
  return [cursorWorld.x, planeY, cursorWorld.z];
}

/** XZ 平面距离（用于"贴近 seat"吸附判定） */
function xzDistanceSq(a: { x: number; z: number }, b: { x: number; z: number }): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return dx * dx + dz * dz;
}

/** 一条世界射线（原点到方向） */
export interface WorldRay {
  origin: Vec3;
  direction: Vec3;
}

/**
 * 求世界射线与水平面 y=planeY 的交点；射线近水平（|dy|≈0）则不相交返回 null。
 * Babylon 侧由 `scene.createPickingRay` 提供 origin/direction，本纯函数换算交点，
 * 供"拖拽平面"把指针屏幕坐标映射到世界 XZ（引擎无关、可 vitest）。
 */
export function rayPlaneYIntersect(ray: WorldRay, planeY: number): { x: number; y: number; z: number } | null {
  const [ox, oy, oz] = ray.origin;
  const [dx, dy, dz] = ray.direction;
  if (Math.abs(dy) < 1e-9) return null; // 与平面平行
  const t = (planeY - oy) / dy;
  if (t < 0) return null; // 交点在射线反方向
  return { x: ox + dx * t, y: planeY, z: oz + dz * t };
}

/**
 * 核心裁决：给定某件的 seat、当前候选中心与已装配实时查询，返回能否贴合。
 * @param partId  被拖拽件 id（排除在已装配查询之外——本件不在静态集中）
 * @param half    被拖拽件半轴长
 * @param seat    贴合基准（用于吸附距离判定）
 * @param candidate  候选中心（平面拖拽后的当前中心）
 * @param snapRadius 吸附半径（默认取零件最大半轴长）
 * @param query   已装配集合的实时干涉查询
 */
export function adjudicateLand(
  partId: string,
  half: Vec3,
  seat: Vec3,
  candidate: Vec3,
  query: QueryInteractive,
  snapRadius?: number,
): DragAdjudication {
  const r = snapRadius ?? Math.max(half[0], half[1], half[2]);
  const d2 = xzDistanceSq(
    { x: candidate[0], z: candidate[2] },
    { x: seat[0], z: seat[2] },
  );
  const canSnap = d2 <= r * r;
  // 候选 OBB 与已装配集合实时检测（仅当贴近 seat 才值得查？否——拖拽全程高亮也需查，
  // 但落位判定只在贴近时才有意义。此处始终查，交由宿主只在需要拦截时使用。）
  const hits = query({ partId, obb: boxObbAt(candidate, half) });
  const clear = hits.length === 0;
  return { candidate, canSnap, clear, hits, land: canSnap && clear };
}

/* ------------------------------------------------------------------ */
/* 有状态拖拽会话（S3c · 引擎无关核心）                                */
/* ------------------------------------------------------------------ */

/** 宿主注入的"被拖拽件几何"（seat=贴合基准，half=半轴长） */
export interface DragGeometry {
  partId: string;
  seat: Vec3;
  half: Vec3;
}

/** 宿主对一次拖拽"结算"的策略回调：候选中心应否贴合；true→贴合，false→驳回回散落 */
export type LandDecision = (candidate: Vec3) => boolean;

/**
 * S3c · 一次手动拖拽会话的有状态裁决器（无 Babylon/DOM，纯逻辑、可 vitest）。
 *
 * 职责：把宿主每次传入的"新候选中心"换算成实时 `DragLiveState`，并在 `finish()`
 * 时按 `landDecision` 给出是否贴合。Babylon 真拖拽（每帧 pointermove→候选中心）与
 * Noop 镜像 / 单测共用同一裁决口径，杜绝两后端判定漂移。
 *
 * 本类只做判定与状态记录；**不搬动任何网格**（位移由渲染后端负责）。
 */
export class ManualDragSession {
  /** 拖拽中实时判定的最新状态（供 HUD / 断言读取；`reason` 见 types.DragLiveState） */
  state: DragLiveState = {
    dragging: false,
    partId: '',
    blocked: false,
    hitPartId: '',
    nearSeat: false,
    canLand: false,
    reason: 'idle',
  };

  private geometry: DragGeometry | null = null;
  private query: QueryInteractive | null = null;
  private landDecision: LandDecision | null = null;
  private candidate: Vec3 = [0, 0, 0];

  /**
   * 开启一次会话。仅当宿主判定该件"可拖"（散落待装 + 且为下一步序）后调用。
   * 由宿主办妥几何注入（seat/half）与判定依赖（query/landDecision）。
   */
  begin(g: DragGeometry, query: QueryInteractive, landDecision: LandDecision): boolean {
    this.geometry = g;
    this.query = query;
    this.landDecision = landDecision;
    this.candidate = [...g.seat];
    this.state = {
      dragging: true,
      partId: g.partId,
      blocked: false,
      hitPartId: '',
      nearSeat: true,
      canLand: true,
      reason: 'dragging',
    };
    return true;
  }

  /** 会话进行中：把零件迁到新候选中心并做实时裁决（每帧 pointermove / 程序化 dragTo） */
  moveTo(candidate: Vec3): DragLiveState {
    if (!this.geometry || !this.query || !this.state.dragging) return this.state;
    this.candidate = candidate;
    const a = adjudicateLand(
      this.geometry.partId,
      this.geometry.half,
      this.geometry.seat,
      candidate,
      this.query,
    );
    const blocked = !a.clear; // 干涉 → 拦截（即使贴近也 red）
    this.state = {
      dragging: true,
      partId: this.geometry.partId,
      blocked,
      hitPartId: a.hits[0]?.secondPartId ?? a.hits[0]?.firstPartId ?? '',
      nearSeat: a.canSnap,
      canLand: a.land,
      reason: blocked ? 'blocked' : 'dragging',
    };
    return this.state;
  }

  /** 结束会话：按 landDecision 结算（可贴合→land，否则驳回回散落）。返回是否贴合 */
  finish(): boolean {
    if (!this.geometry || !this.state.dragging) return false;
    const landed = this.landDecision?.(this.candidate) ?? false;
    if (landed) this.state.reason = 'landed';
    else this.state.reason = 'snapped-back';
    // 无论结果，会话结束（宿主据此落 mesh 位 / 归 scatter / sync）
    this.state.dragging = false;
    this.state.partId = '';
    return landed;
  }

  /** 放弃会话（如指针移出/异常）：清状态回 idle（宿主负责把 mesh 归 scatter） */
  abort(): void {
    this.state = {
      dragging: false,
      partId: '',
      blocked: false,
      hitPartId: '',
      nearSeat: false,
      canLand: false,
      reason: 'idle',
    };
    this.geometry = null;
    this.query = null;
    this.landDecision = null;
  }

  get dragging(): boolean {
    return this.state.dragging;
  }
}
