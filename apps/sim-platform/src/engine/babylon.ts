/**
 * SimEngine 的 Babylon 真渲染实现（0.2.0 出口「浏览器渲染装配」）
 *
 * 职责范围（经 grill-me 确认，FEAT-20260903-002「最小真渲染：先关门禁」+ S1 分态渲染）：
 *   ✅ 本模块 = 真 WebGL 渲染后端：工作台视口挂 Babylon Engine+Scene；
 *      `loadLine` 真加载产线，把零件按确定性布局渲成 **OBB 盒体占位**，
 *      配网格 + 坐标轴 + ArcRotateCamera + 环境/平行光 + HUD(STEP/引擎实时)。
 *   ✅ S1 · 分态渲染：零件被分为「已贴合 / 待装配」两态。已贴合停 seat（贴合位），
 *      待装配停确定性散落待料位；由 `assembledPartIds` 驱动归属切换（`setAssemblyState`）。
 *   ✅ S2 · 装配过程动画：门面经 `AssemblyAnimator`（纯逻辑驱动器）在每帧（scene.onFrame）
 *      推进 auto/replay 播放，零件从散落位平滑滑向贴合位；seek/undo 仍走瞬时跳变。
 *   ❌ 不做（归 0.3.x S3+）：实时干涉拖拽联动、BOM 树/节拍面板、真 glTF 资产管线。
 *
 * 架构红线（ARCHITECTURE §2）：
 *   1. 本文件是本仓**唯一** import '@babylonjs/core' 的渲染实现边界；
 *   2. 业务组件/视图只经 `SimEngine` 门面（types.ts）拿到本实现的窄接口，
 *      绝不直接 import 本文件或 Babylon；
 *   3. `createSimEngine()` 在无 WebGL（vitest/jsdom/CI）时回落 Noop 替身，
 *      保证单测不启真渲染、契约仍可被无 WebGL 验证。
 */

import {
  ArcRotateCamera,
  Color3,
  Color4,
  Engine,
  HemisphericLight,
  Matrix,
  MeshBuilder,
  Scene,
  StandardMaterial,
  Vector3,
} from '@babylonjs/core';

import type { AssemblyBom, OBB, ProductionLine, Vec3 } from '@assemble/domain';
import { obbFromCenterHalfExtents } from '@assemble/clearance-core';

import { NoopAssembler, NoopClearance, NoopSimEngine } from './noop.js';
import { AssemblyAnimator } from './animator.js';
import { computeTwoStatePlacement, type PartPlacement } from './placement.js';
import { ManualDragSession, boxObbAt, rayPlaneYIntersect, type DragGeometry } from './drag.js';
import type {
  AssetManager,
  AssemblyController,
  CameraPose,
  CameraViewId,
  ClearanceController,
  DragLiveState,
  EngineHealth,
  InteractionManager,
  PickResult,
  SceneManager,
  SimEngine,
} from './types.js';

/* ------------------------------------------------------------------ */
/* WebGL 可用性探测（决定工厂回落路径）                                */
/* ------------------------------------------------------------------ */

let _webglChecked = false;
let _webglSupported = false;

function detectWebGL(): boolean {
  if (_webglChecked) return _webglSupported;
  _webglChecked = true;
  try {
    const canvas = document.createElement('canvas');
    const gl =
      canvas.getContext('webgl2') ||
      canvas.getContext('webgl') ||
      (canvas.getContext('experimental-webgl') as WebGLRenderingContext | null);
    _webglSupported = !!gl;
  } catch {
    _webglSupported = false;
  }
  return _webglSupported;
}

/* ------------------------------------------------------------------ */
/* 相机位姿默认表（与 noop 保持一致，供 UI 读取视角状态）              */
/* ------------------------------------------------------------------ */

const CAMERA_PRESETS: Record<CameraViewId, CameraPose> = {
  iso: { viewId: 'iso', position: [140, 130, 190], target: [0, 10, 0], orthographic: false },
  front: { viewId: 'front', position: [0, 30, 240], target: [0, 10, 0], orthographic: false },
  top: { viewId: 'top', position: [0, 260, 0], target: [0, 0, 0], orthographic: false },
  side: { viewId: 'side', position: [260, 30, 0], target: [0, 10, 0], orthographic: false },
  free: { viewId: 'free', position: [150, 140, 150], target: [0, 10, 0], orthographic: false },
};

/**
 * 单一事实：一个待渲染零件的几何（含贴合基准 seat + 半轴长），供 `computeTwoStatePlacement`
 * 推导每个零件的「贴合位 / 散落待料位」。seat 即 `AssemblyPart.localPosition` 的合成等价。
 */
export interface RenderPart {
  partId: string;
  /** 贴合基准中心（已装配时停此位） */
  center: Vec3;
  /** 该件 OBB 半轴长（用于 CreateBox 尺寸与散落包围估计） */
  half: Vec3;
}

/** 从一条 OBB 提取一个 RenderPart（对齐世界系时 axes 恒等轴，直接取 center/halfExtents） */
function partFromObb(partId: string, obb: OBB): RenderPart {
  return { partId, center: obb.center, half: obb.halfExtents };
}

/* ------------------------------------------------------------------ */
/* Babylon 装配状态机 —— 复用 noop 真实逻辑（非视觉，不重写）          */
/* ------------------------------------------------------------------ */

/**
 * 把一个确定性合成的"零件 OBB 列表"渲染成 Babylon 场景。
 * 0.2.x 无真 glTF/装配约束库，用与 interference-svc `synthesizePartsForLine`
 * 同一套确定性布局口径，保证工作台 3D 装配体与离线预检口径可对齐。
 */
export interface BabylonLineScene {
  scene: Scene;
  /** 已建盒体的零件 id 顺序 */
  partIds: string[];
  /** 单个装配基座盒（视觉锚点，不算零件） */
  base?: ReturnType<typeof MeshBuilder.CreateBox>;
}

/* ------------------------------------------------------------------ */
/* SceneManager（真 WebGL）                                            */
/* ------------------------------------------------------------------ */

class BabylonScene implements SceneManager {
  private engine: Engine | null = null;
  private scene: Scene | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private container: HTMLElement | null = null;
  private camera: ArcRotateCamera | null = null;
  private viewId: CameraViewId = 'iso';
  private _rendering = false;
  /** partId -> 盒体网格（按需隐藏/高亮预留） */
  private meshes = new Map<string, ReturnType<typeof MeshBuilder.CreateBox>>();
  /** partId -> 已装配停驻位（seat / 贴合位，由 placement 推导） */
  private seatPos = new Map<string, Vector3>();
  /** partId -> 待装配散落待料位 */
  private scatterPos = new Map<string, Vector3>();
  /** S3 · partId -> 轴对齐半轴长（供 seat OBB 构造，实时干涉用） */
  private halfSize = new Map<string, Vec3>();
  /** 稳定零件序（决定散落环相位与 palette 着色） */
  private _partOrder: string[] = [];
  /** S2 · 每件 seat/scatter 纯布局（renderParts 时缓存，供 animator 构造） */
  private _placements: PartPlacement[] = [];
  /** S3c · 射线求交用单位矩阵（createPickingRay 的 world 参数） */
  private _idMatrix = Matrix.Identity();
  /** S2 · 最近一次已知的 assembled 集合快照（供飞行覆盖退出时回落 S1 seat/scatter 判定） */
  private _assembledIds: ReadonlySet<string> = new Set();
  /** S2 · 每帧驱动回调（render loop 每帧先调再 render；由引擎注册动画推进） */
  onFrame: (() => void) | null = null;

  get isMounted(): boolean {
    return this.engine !== null && this.scene !== null;
  }

  /** 视口 canvas（供 pointer 监听挂载）；未挂载返回 null */
  get canvasEl(): HTMLCanvasElement | null {
    return this.canvas;
  }

  /** 当前已贴合/散落集合快照（供 HUD 与门面同步断言；纯读取） */
  get stateSnapshot(): { seated: number; scattered: number } {
    let seated = 0;
    let scattered = 0;
    const base = this.scatterPos.size;
    for (const [id, mesh] of this.meshes) {
      const seat = this.seatPos.get(id);
      if (seat && mesh.position.equalsWithEpsilon(seat, 1e-4)) seated += 1;
    }
    scattered = Math.max(0, base - seated);
    return { seated, scattered };
  }

  /** S2 · 读取 renderParts 时缓存的 seat/scatter 纯布局（供引擎构造动画驱动器） */
  get placements(): PartPlacement[] {
    return this._placements;
  }

  /** S3 · 取给定零件集合在 seat 处的世界 OBB（实时干涉的"已装配静态集"几何源）。
   *  半轴来自 renderParts 时登记的 halfSize；无该件登记则跳过。 */
  seatObbsOf(ids: ReadonlySet<string>): Array<{ partId: string; obb: OBB }> {
    const out: Array<{ partId: string; obb: OBB }> = [];
    for (const id of ids) {
      const seat = this.seatPos.get(id);
      const half = this.halfSize.get(id);
      if (!seat || !half) continue;
      out.push({
        partId: id,
        obb: obbFromCenterHalfExtents(
          [seat.x, seat.y, seat.z],
          [half[0], half[1], half[2]],
        ),
      });
    }
    return out;
  }

  mount(container: HTMLElement): boolean {
    if (!detectWebGL()) return false;
    if (this.engine) {
      // 已在渲染：直接挂到新容器（复用引擎）
      if (this.container !== container) {
        container.appendChild(this.canvas as HTMLCanvasElement);
        this.container = container;
      }
      return true;
    }

    // 首次挂载：创建 canvas + Engine + Scene
    this.container = container;
    this.canvas = document.createElement('canvas');
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.canvas.style.display = 'block';
    this.canvas.style.background = '#0a1420';
    container.appendChild(this.canvas);

    try {
      this.engine = new Engine(this.canvas, true, {
        preserveDrawingBuffer: true,
        antialias: true,
      });
      this.scene = new Scene(this.engine);
      this.scene.clearColor = new Color4(0.035, 0.06, 0.1, 1);
      // 基础光照：半球环境光 + 平行光塑造体积感（避免一片死黑）
      new HemisphericLight('hemi', new Vector3(0, 1, 0), this.scene);
      const hemi = this.scene.getLightByName('hemi');
      if (hemi && 'intensity' in hemi) hemi.intensity = 0.85;
      this._buildFloorGrid();
      this._setupCamera();
      this._startRenderLoop();
      this.setCamera(this.viewId);
      return true;
    } catch (e) {
      // 真 WebGL 初始化失败 → 释放并回落（由工厂层决定是否转 noop）
      this.unmount();
      return false;
    }
  }

  unmount(): void {
    this._rendering = false;
    if (this.engine) {
      this.engine.stopRenderLoop();
      this.engine.dispose();
      this.engine = null;
    }
    this.scene = null;
    if (this.canvas && this.canvas.parentNode) {
      this.canvas.parentNode.removeChild(this.canvas);
    }
    this.canvas = null;
    this.container = null;
    this.meshes.clear();
    this.seatPos.clear();
    this.scatterPos.clear();
    this.halfSize.clear();
    this._placements = [];
    this.onFrame = null;
  }

  /** 地板：一块深色半透明网格底 + 坐标轴线（X 红 / Y 绿 / Z 蓝 简化示意） */
  private _buildFloorGrid(): void {
    const scene = this.scene;
    if (!scene) return;
    const S = 28; // 半幅（与零件布局 ~24×24 匹配，避免空旷感）
    const step = 2.8;
    const mat = new StandardMaterial('gridline', scene);
    mat.diffuseColor = new Color3(0.11, 0.16, 0.26);
    mat.alpha = 0.9;
    // 用 CreateGround 做底板，暗色
    MeshBuilder.CreateGround('floor', { width: S * 2, height: S * 2 }, scene).material = mat;
    // 网格线：在 XZ 平面按 step 铺 CreateLines
    for (let i = -S; i <= S; i += step) {
      const lineMat = new StandardMaterial(`gl${i}`, scene);
      lineMat.diffuseColor = new Color3(0.13, 0.2, 0.32);
      lineMat.emissiveColor = new Color3(0.06, 0.1, 0.17);
      lineMat.alpha = 0.5;
      const pointsA = [new Vector3(i, 0.01, -S), new Vector3(i, 0.01, S)];
      const pointsB = [new Vector3(-S, 0.01, i), new Vector3(S, 0.01, i)];
      const la = MeshBuilder.CreateLines(`glA${i}`, { points: pointsA }, scene);
      const lb = MeshBuilder.CreateLines(`glB${i}`, { points: pointsB }, scene);
      la.color = lineMat.diffuseColor;
      lb.color = lineMat.diffuseColor;
    }
  }

  private _setupCamera(): void {
    if (!this.scene || !this.canvas) return;
    this.camera = new ArcRotateCamera(
      'cam',
      Math.PI / 4,
      Math.PI / 2.8,
      55,
      new Vector3(0, 6, 0),
      this.scene,
    );
    this.camera.attachControl(this.canvas, true);
    this.camera.lowerRadiusLimit = 8;
    this.camera.upperRadiusLimit = 300;
    this.camera.minZ = 0.1;
    this.camera.maxZ = 2000;
    this.camera.wheelDeltaPercentage = 0.02;
    this.scene.activeCamera = this.camera;
  }

  private _startRenderLoop(): void {
    if (!this.engine || !this.scene) return;
    this._rendering = true;
    this.engine.runRenderLoop(() => {
      if (this.scene) {
        // S2 · 每帧驱动点：动画推进器（引擎注册）先于 scene.render 结算本帧零件位
        this.onFrame?.();
        this.scene.render();
      }
    });
  }

  setCamera(viewId: CameraViewId): CameraPose {
    this.viewId = viewId;
    if (this.camera) {
      const p = CAMERA_PRESETS[viewId];
      // 映射为轨道参数：方位 alpha / 仰角 beta / 半径
      const [tx, ty, tz] = p.target;
      this.camera.setTarget(new Vector3(tx, ty, tz));
      const [px, py, pz] = p.position;
      const alpha = Math.atan2(pz - tz, px - tx);
      const radius = Math.hypot(px - tx, py - ty, pz - tz);
      const beta = Math.asin((py - ty) / Math.max(radius, 1e-6));
      this.camera.alpha = alpha;
      this.camera.beta = Math.min(Math.max(beta, 0.05), Math.PI - 0.05);
      this.camera.radius = radius;
    }
    return CAMERA_PRESETS[viewId];
  }

  frameToPart(partIds: readonly string[]): void {
    // 聚焦到所给零件的平均中心并拉近
    if (!this.camera || partIds.length === 0) return;
    let cx = 0;
    let cy = 0;
    let cz = 0;
    let hit = 0;
    for (const id of partIds) {
      const m = this.meshes.get(id);
      if (m) {
        cx += m.position.x;
        cy += m.position.y;
        cz += m.position.z;
        hit += 1;
      }
    }
    if (hit === 0) return;
    const target = new Vector3(cx / hit, cy / hit, cz / hit);
    this.camera.setTarget(target);
    if (this.camera.radius > 40) this.camera.radius = 40;
  }

  requestRender(): boolean {
    if (!this.engine) return false;
    this.engine.stopRenderLoop();
    this.scene?.render();
    this._startRenderLoop();
    return true;
  }

  setRendering(on: boolean): void {
    if (this.engine && on !== this._rendering) {
      if (on) this._startRenderLoop();
      else {
        this._rendering = false;
        this.engine.stopRenderLoop();
      }
    }
  }

  /**
   * 由 AssetManager.loadLine 注入一批零件（内部协作，不对外暴露 Babylon）。
   * S1 分态：把零件按 `computeTwoStatePlacement` 推得 seat/scatter 两态，
   * 建盒体默认全部停 seat（完整装配体视效，延续 0.2 观感），待 `setAssemblyState`
   * 按 `assembledPartIds` 把"未贴合件"移到散落待料位。
   */
  renderParts(parts: RenderPart[]): void {
    const scene = this.scene;
    if (!scene) return;
    const placements = computeTwoStatePlacement(parts);
    // S2 · 缓存纯布局，供引擎构造动画驱动器（seat/scatter 双目标位）
    this._placements = placements;
    // 深色科技扁平调色：主用青/蓝系，个别强调件用琥珀/绿（对齐 tokens.css）
    const palette = [
      new Color3(0.20, 0.44, 0.92), // blue #1f6feb
      new Color3(0.13, 0.83, 0.93), // cyan #22d3ee
      new Color3(0.20, 0.83, 0.60), // green #34d399
      new Color3(0.42, 0.55, 0.70),
    ];
    this.meshes.clear();
    this.seatPos.clear();
    this.scatterPos.clear();
    this.halfSize.clear();
    this._partOrder = parts.map((p) => p.partId);

    placements.forEach((pl, i) => {
      const part = parts[i] as RenderPart;
      const [hx, hy, hz] = part.half;
      const name = `part-${part.partId}`;
      const mesh = MeshBuilder.CreateBox(
        name,
        { width: hx * 2, height: hy * 2, depth: hz * 2 },
        scene,
      );
      const seat = new Vector3(pl.seat[0], pl.seat[1], pl.seat[2]);
      mesh.position = seat.clone(); // 默认贴合位（完整装配体）
      this.seatPos.set(part.partId, seat);
      this.scatterPos.set(part.partId, new Vector3(pl.scatter[0], pl.scatter[1], pl.scatter[2]));
      this.halfSize.set(part.partId, part.half); // S3 · 供 seat OBB 构造（实时干涉）

      // 边框描边用 wireframe 叠加层提"工程件"观感
      const paletteColor = palette[i % palette.length] as Color3;
      const m = new StandardMaterial(`mat-${name}`, scene);
      m.diffuseColor = paletteColor;
      m.specularColor = new Color3(0.08, 0.1, 0.14);
      m.specularPower = 24;
      mesh.material = m;
      // 给个别件描淡青色边框
      if (i % 3 === 0) {
        const edge = MeshBuilder.CreateBox(`edge-${name}`, {
          width: hx * 2 + 0.06,
          height: hy * 2 + 0.06,
          depth: hz * 2 + 0.06,
        }, scene);
        edge.position = seat.clone();
        edge.visibility = 0;
        const em = new StandardMaterial(`emat-${name}`, scene);
        em.wireframe = true;
        em.diffuseColor = new Color3(0.13, 0.83, 0.93);
        em.emissiveColor = new Color3(0.05, 0.4, 0.45);
        edge.material = em;
      }
      this.meshes.set(part.partId, mesh);
    });
    this._frameWholeAssembly(parts);
  }

  /** 把相机取景到装配体（质心 + 包围半径 → 半径取景公式，见 LRN-005） */
  private _frameWholeAssembly(parts: RenderPart[]): void {
    if (!this.camera || parts.length === 0) return;
    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (const b of parts) {
      cx += b.center[0];
      cy += b.center[1];
      cz += b.center[2];
    }
    cx /= parts.length;
    cy /= parts.length;
    cz /= parts.length;
    let maxR = 0;
    for (const b of parts) {
      const r =
        Math.hypot(b.center[0] - cx, b.center[1] - cy, b.center[2] - cz) +
        Math.max(b.half[0], b.half[1], b.half[2]);
      if (r > maxR) maxR = r;
    }
    this.camera.setTarget(new Vector3(cx, cy, cz));
    this.camera.radius = Math.max(14, maxR * 2.6);
  }

  /** S1 · 状态变化后取景：把 seat ∪ scatter 的并集质心与包围半径算进相机半径，
   *  让"已贴合 + 散落并存"也能完整入框（不论状态如何切都自适配）。 */
  private _frameForCurrentState(): void {
    if (!this.camera) return;
    let cx = 0, cy = 0, cz = 0, n = 0, maxR = 0;
    // 并集采样：每个 mesh 当前实际位置即其应取景点
    for (const [, mesh] of this.meshes) {
      cx += mesh.position.x;
      cy += mesh.position.y;
      cz += mesh.position.z;
      n += 1;
    }
    if (n === 0) return;
    cx /= n; cy /= n; cz /= n;
    for (const [id, mesh] of this.meshes) {
      const seat = this.seatPos.get(id);
      const half = Math.max(0.8, ...(seat ? [0.8] : []));
      const dx = Math.abs(mesh.position.x - cx) + half;
      const dy = Math.abs(mesh.position.y - cy) + half;
      const dz = Math.abs(mesh.position.z - cz) + half;
      const r = Math.hypot(dx, dy, dz);
      if (r > maxR) maxR = r;
    }
    this.camera.setTarget(new Vector3(cx, cy, cz));
    this.camera.radius = Math.max(14, maxR * 2.4);
  }

  /**
   * S1 · 分态渲染核心：把零件按「已贴合 / 待装配」两态摆位。
   * - `assembledIds` 中的零件 → 停 seat（贴合位）；
   * - 其余零件 → 停 scatter（确定性散落待料位）。
   * 归属由外部单一事实 `assembly.assembledPartIds` 驱动（本方法不私有持有集合）。
   * 返回本次应用后的 {seated, scattered} 供调用方/门面断言与 HUD 展示。
   */
  setAssemblyState(assembledIds: ReadonlySet<string>): { seated: number; scattered: number } {
    const scene = this.scene;
    if (!scene) return this.stateSnapshot;
    this._assembledIds = new Set(assembledIds);
    // 两态着色：已贴合亮青（确认），待装配琥珀（待料、显眼）。
    const seatedTint = new Color3(0.18, 0.85, 0.9); // 青
    const pendingTint = new Color3(0.95, 0.62, 0.18); // 琥珀（与青形成强对比）
    for (const [id, mesh] of this.meshes) {
      const seat = this.seatPos.get(id);
      const scatter = this.scatterPos.get(id);
      if (!seat || !scatter) continue;
      const assembled = assembledIds.has(id);
      mesh.position = assembled ? seat.clone() : scatter.clone();
      const mat = mesh.material as StandardMaterial | null;
      if (mat) mat.diffuseColor = assembled ? seatedTint.clone() : pendingTint.clone();
    }
    // 散落待料环比贴合位范围更大 —— 状态变化后重取景，让 seat+scatter 并存也完整入框
    this._frameForCurrentState();
    if (this.scene) this.scene.render();
    return this.stateSnapshot;
  }

  /**
   * S2 · 应用某件的"飞行插值位"（动画中视觉叠加，不写 seatPos/scatterPos）。
   * - 传 Vec3：把该件 mesh 覆盖到动画当前位置（渲染层每帧驱动用）；
   * - 传 null：退出飞行覆盖，回落 S1 的 seat/scatter 判定（由 syncAssemblyState 落位）。
   */
  applyFlightPose(partId: string, pos: Vec3 | null): void {
    const mesh = this.meshes.get(partId);
    if (!mesh) return;
    if (pos) mesh.position = new Vector3(pos[0], pos[1], pos[2]);
    else {
      // 退出覆盖：按 S1 seat/scatter 判定落回
      const assembled = this._assembledIds?.has(partId) ?? false;
      const seat = this.seatPos.get(partId);
      const scatter = this.scatterPos.get(partId);
      if (assembled && seat) mesh.position = seat.clone();
      else if (scatter) mesh.position = scatter.clone();
    }
  }

  /** S2 · 引擎把某件在动画完成时标记为已贴合集合（供 applyFlightPose(null) 回落判定） */
  setAssembledSnapshot(ids: ReadonlySet<string>): void {
    this._assembledIds = new Set(ids);
  }

  get loadedPartCount(): number {
    return this.meshes.size;
  }

  /* ---------------- S3c · 手动拖拽渲染原语（仅 Babylon 侧，门面窄口消费） ------------- */

  /** 取某件 seat 中心 + 半轴（拖拽平面高度 = seat.y，几何源）。无该件返回 null。 */
  partSeatHalf(partId: string): { seat: Vector3; half: Vec3 } | null {
    const seat = this.seatPos.get(partId);
    const half = this.halfSize.get(partId);
    if (!seat || !half) return null;
    return { seat, half };
  }

  /** 屏幕坐标拾取零件 id；未命中任何零件盒体返回空串。 */
  pickPartId(clientX: number, clientY: number): string {
    const scene = this.scene;
    if (!scene) return '';
    const hit = scene.pick(clientX, clientY, undefined, false, this.camera ?? undefined);
    if (!hit?.hit || !hit.pickedMesh) return '';
    const name = hit.pickedMesh.name ?? '';
    if (!name.startsWith('part-')) return '';
    return name.slice('part-'.length);
  }

  /** 屏幕坐标 → 世界射线与水平拖拽平面（y=planeY）的交点 XZ；无命中返回 null。 */
  pointerXZAtPlane(clientX: number, clientY: number, planeY: number): { x: number; z: number } | null {
    const scene = this.scene;
    if (!scene) return null;
    const ray = scene.createPickingRay(clientX, clientY, this._idMatrix, this.camera ?? null);
    const p = rayPlaneYIntersect(
      {
        origin: [ray.origin.x, ray.origin.y, ray.origin.z],
        direction: [ray.direction.x, ray.direction.y, ray.direction.z],
      },
      planeY,
    );
    return p ? { x: p.x, z: p.z } : null;
  }

  /** 把某件 mesh 停到世界候选中心（拖拽实时摆位；不写 seat/scatter 两态 map）。 */
  setMeshWorldCenter(partId: string, center: Vec3): void {
    const mesh = this.meshes.get(partId);
    if (!mesh) return;
    mesh.position = new Vector3(center[0], center[1], center[2]);
  }

  /** 取某件 mesh 当前世界中心（拖拽起点/复位用）；无该件返回 null。 */
  meshCenterOf(partId: string): Vec3 | null {
    const mesh = this.meshes.get(partId);
    if (!mesh) return null;
    return [mesh.position.x, mesh.position.y, mesh.position.z];
  }

  /** 临时高亮某件 mesh（拖拽 hover / 干涉变红）。'none' 还原材质原色（琥珀散落/青贴合由 setAssemblyState 统一） */
  setMeshHighlight(partId: string, kind: 'none' | 'hover' | 'blocked'): void {
    const mesh = this.meshes.get(partId);
    if (!mesh) return;
    const mat = mesh.material as StandardMaterial | null;
    if (!mat) return;
    if (kind === 'blocked') mat.diffuseColor = new Color3(0.95, 0.2, 0.2); // 红：干涉拦截
    else if (kind === 'hover') mat.diffuseColor = new Color3(0.4, 0.7, 1.0); // 亮蓝：可拖 hover
    // 'none' → 交还 setAssemblyState 语义（下轮 sync 覆盖），此处不硬改
  }

  /** 拖拽期间挂起/恢复相机轨道控制（避免旋转与零件拖拽冲突） */
  setCameraControlEnabled(on: boolean): void {
    if (!this.canvas || !this.camera) return;
    // Babylon 9：detachControl 无参、attachControl(canvas, noPreventDefault)
    if (!on) this.camera.detachControl();
    else this.camera.attachControl(this.canvas, true);
  }
}

/* ------------------------------------------------------------------ */
/* AssetManager —— 真加载：合成确定性零件布局并建盒体网格             */
/* ------------------------------------------------------------------ */

class BabylonAssets implements AssetManager {
  private sceneMgr: BabylonScene;
  private _loaded = 0;
  private _partIds: string[] = [];
  /** 与合成盒体同源的装配 BOM（供门面把状态机 universe 对齐渲染），0.3.x 换真 BOM 端点后替换 */
  private _syntheticBom: AssemblyBom | null = null;

  constructor(sceneMgr: BabylonScene) {
    this.sceneMgr = sceneMgr;
  }

  get loadedPartCount(): number {
    return this._loaded;
  }

  /** 合成 BOM（S1：盒体与装配状态机共享同一零件集/步骤序） */
  get synthesizedBom(): AssemblyBom | null {
    return this._syntheticBom;
  }

  async loadLine(line: ProductionLine, _bom?: unknown): Promise<readonly string[]> {
    // 0.2.x + S1：无真 glTF 资产；按产线类型与工位规模确定性合成一组零件 OBB，
    // 与 interference-svc synthesizePartsForLine 同口径，渲成盒体占位（分态渲染的 seat 源）。
    const parts = buildSyntheticBoxes(line);
    this.sceneMgr.renderParts(parts);
    this._partIds = parts.map((p) => p.partId);
    this._syntheticBom = buildSyntheticBom(parts, line.id);
    this._loaded = this._partIds.length;
    return this._partIds;
  }

  dispose(): void {
    // 场景卸载由 SceneManager.unmount 统一清理网格；这里仅清登记
    this._loaded = 0;
    this._partIds = [];
    this._syntheticBom = null;
  }
}

/** 依产线类型确定性合成零件盒体（OBB 占位渲染，口径对齐服务端几何目录） */
function buildSyntheticBoxes(line: ProductionLine): RenderPart[] {
  // 用工位数驱动零件规模：默认约 3×工位数 件，最少 12 件、最多 60 件
  const stationCount = Math.max(1, line.stations.length);
  const total = Math.min(60, Math.max(12, stationCount * 3));
  const kind = line.kind;
  const parts: RenderPart[] = [];
  for (let i = 0; i < total; i++) {
    const col = i % 8;
    const row = Math.floor(i / 8);
    let cx: number;
    let cy: number;
    let half: Vec3;
    if (kind === 'cold-chain') {
      // 冷链线：稀疏规整（对齐服务端 cold-chain 稀疏布局语义：0 干涉观感）
      cx = col * 3.2;
      cy = row * 3.2;
      half = [0.7, 0.7, 0.7] as const;
    } else {
      // 分拣/净切线：紧凑行列，行错位制造真实装配叠放观感
      cx = col * 2.2 + (row % 2 === 0 ? 0.3 : 0);
      cy = row * 2.2;
      half = [0.8, 0.8, 0.8] as const;
    }
    // 轻微高度分层避免完全贴合，呈现"多排堆叠的装配体"
    const layer = Math.floor(i / 24);
    parts.push({
      partId: `${line.id}-${String(i).padStart(3, '0')}`,
      center: [cx, half[1] + layer * 1.6, cy] as Vec3,
      half,
    });
  }
  return parts;
}

/**
 * 从合成盒体零件派生一个与之**同源**的装配 BOM（S1 用）：
 * 让装配状态机（`NoopAssembler`）与渲染网格共享同一零件集与步骤序，
 * 使 `assembledPartIds` 能真正驱动分态摆位。每个合成盒 = 一个可动 `AssemblyPart`
 * （seat = 盒体中心），工艺 = 按零件序一步一件（0.3.x 接入真 BOM 端点后替换本合成）。
 */
function buildSyntheticBom(parts: readonly RenderPart[], lineId: string): AssemblyBom {
  const assemblyParts = parts.map((p, i) => ({
    id: p.partId,
    name: `部件 ${i + 1}`,
    assetId: p.partId,
    localPosition: p.center,
    localRotation: { x: 0, y: 0, z: 0, w: 1 } as const,
    isMovable: true,
    // 首个零件当"基座"（非可动锚点，贴合后不再散落），其余可动待装
    ...(i === 0 ? { isMovable: false } : {}),
  }));
  const steps = parts.map((p, i) => ({
    seq: i,
    partId: p.partId,
    constraintIds: [],
    durationSeconds: 1,
    description: `装配第 ${i + 1} 件`,
  }));
  return { lineId, parts: assemblyParts, constraints: [], steps };
}

/* ------------------------------------------------------------------ */
/* Interaction / Assembly / Clearance —— 复用 noop 真实逻辑            */
/* ------------------------------------------------------------------ */

/** 交互拾取/拖拽：S3c · 射线拾取 + 平面拖拽（方案A）。驱动纯逻辑 ManualDragSession，
 * 与 Noop 镜像共享同一裁决口径。落位后经 onStateChange（引擎 syncAssemblyState）同步渲染+clearance。 */
class BabylonInteraction implements InteractionManager {
  private scene: BabylonScene;
  private assembly: NoopAssembler;
  private clearance: NoopClearance;
  private session = new ManualDragSession();
  /** 拖拽候选当前世界中心（seat 平面 Y；随 dragTo/pointermove 累计，供落位决策） */
  private cursor: Vec3 = [0, 0, 0];
  /** 引擎注入的"同步分态渲染 + clearance 重登记"回调（构造函数传入，避免类间环引用） */
  private onStateChange: () => void;

  constructor(
    scene: BabylonScene,
    assembly: NoopAssembler,
    clearance: NoopClearance,
    onStateChange: () => void,
  ) {
    this.scene = scene;
    this.assembly = assembly;
    this.clearance = clearance;
    this.onStateChange = onStateChange;
  }

  /** 拖拽抓取点相对指针的偏移（世界 XZ），使零件跟随指针而不跳变到指针处 */
  private _grabX = 0;
  private _grabZ = 0;
  private _wired = false;

  /** 绑定视口 pointer 事件（真鼠标拖拽入口；门面程序化 beginDrag/dragTo 独立可用）。
   *  需在 scene.mount 后调用（此时 canvas 已就绪）。幂等。 */
  wirePointer(): void {
    if (this._wired) return;
    const canvas = this.scene.canvasEl;
    if (!canvas) return;
    this._wired = true;
    canvas.addEventListener('pointerdown', (e) => {
      const rect = canvas.getBoundingClientRect();
      const id = this.scene.pickPartId(e.clientX - rect.left, e.clientY - rect.top);
      if (!id || !this.beginDrag(id)) return;
      // 记录抓取偏移：零件中心 - 指针在 seat 平面的命中点
      const geo = this.scene.partSeatHalf(id);
      const cur = this.scene.meshCenterOf(id);
      const pz = this.scene.pointerXZAtPlane(e.clientX - rect.left, e.clientY - rect.top, geo ? geo.seat.y : 0);
      this._grabX = cur ? cur[0] - (pz ? pz.x : cur[0]) : 0;
      this._grabZ = cur ? cur[2] - (pz ? pz.z : cur[2]) : 0;
      canvas.setPointerCapture?.(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!this.session.dragging) return;
      const rect = canvas.getBoundingClientRect();
      const geo = this.scene.partSeatHalf(this.session.state.partId);
      if (!geo) return;
      const pz = this.scene.pointerXZAtPlane(e.clientX - rect.left, e.clientY - rect.top, geo.seat.y);
      if (pz) this.placeCandidate(this.session.state.partId, pz.x + this._grabX, pz.z + this._grabZ);
    });
    canvas.addEventListener('pointerup', (e) => {
      if (this.session.dragging) this.endDrag(this.session.state.partId);
      if (canvas.hasPointerCapture?.(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointercancel', () => {
      if (this.session.dragging) {
        this.session.abort();
        this.scene.setCameraControlEnabled(true);
        this.onStateChange();
      }
    });
  }

  get dragState(): DragLiveState {
    return this.session.state;
  }

  /** manual 模式且当前装配步下一步即 partId（未装配）→ 该件可拖 */
  private isNextPending(partId: string): boolean {
    if (this.assembly.mode !== 'manual') return false;
    const next = this.assembly.bom?.steps[this.assembly.currentStepSeq];
    if (!next || next.partId !== partId) return false;
    return !this.assembly.assembledPartIds.includes(partId);
  }

  private canDrag(partId: string): boolean {
    if (partId === '') return false;
    const part = this.assembly.bom?.parts.find((p) => p.id === partId);
    if (!part || part.isMovable === false) return false;
    if (this.assembly.assembledPartIds.includes(partId)) return false;
    return this.isNextPending(partId);
  }

  /** 把该件 mesh 移到 seat 平面给定 XZ（保持 planeY=seat.y），并做实时裁决/高亮 */
  private placeCandidate(partId: string, x: number, z: number): void {
    const geo = this.scene.partSeatHalf(partId);
    if (!geo) return;
    const center: Vec3 = [x, geo.seat.y, z];
    this.cursor = center;
    this.scene.setMeshWorldCenter(partId, center);
    const st = this.session.moveTo(center);
    this.scene.setMeshHighlight(partId, st.blocked ? 'blocked' : 'hover');
  }

  /** 落位决策回调（传给 ManualDragSession.finish）：干涉或非下一序 → 驳回，否则贴合。 */
  private decideLand(partId: string, candidate: Vec3): boolean {
    const geo = this.scene.partSeatHalf(partId);
    if (!geo) return false;
    if (this.clearance.queryInteractive({ partId, obb: boxObbAt(candidate, geo.half) }).length > 0) {
      return false; // 实时干涉 → 不落位
    }
    return this.assembly.assemble(partId); // 严格步骤序（canDrag 已保证是下一序）
  }

  pick(clientX: number, clientY: number): PickResult {
    const id = this.scene.pickPartId(clientX, clientY);
    return { partId: id, ok: id !== '' };
  }

  /** 点选散落件（manual）→ 进入拖拽：件降到 seat 高度（XZ 保持 scatter），相机轨道挂起。 */
  beginDrag(partId: string): boolean {
    if (!this.canDrag(partId)) {
      const reason: DragLiveState['reason'] = 'not-movable';
      this.session.state = { dragging: false, partId, blocked: false, hitPartId: '', nearSeat: false, canLand: false, reason };
      return false;
    }
    const geo = this.scene.partSeatHalf(partId);
    if (!geo) return false;
    const cur = this.scene.meshCenterOf(partId);
    const start: Vec3 = [cur ? cur[0] : geo.seat.x, geo.seat.y, cur ? cur[2] : geo.seat.z];
    this.scene.setMeshWorldCenter(partId, start);
    this.session.begin(
      { partId, seat: [geo.seat.x, geo.seat.y, geo.seat.z], half: geo.half },
      (m) => this.clearance.queryInteractive(m),
      (candidate) => this.decideLand(partId, candidate),
    );
    this.cursor = start;
    this.scene.setCameraControlEnabled(false);
    this.scene.setMeshHighlight(partId, 'hover');
    this.scene.requestRender();
    return true;
  }

  dragTo(partId: string, delta: Vec3): void {
    if (!this.session.dragging || this.session.state.partId !== partId) return;
    const next: Vec3 = [this.cursor[0] + delta[0], this.cursor[1], this.cursor[2] + delta[2]];
    this.placeCandidate(partId, next[0], next[2]);
    this.scene.requestRender();
  }

  endDrag(partId: string): { ok: boolean; hits: import('@assemble/domain').InterferenceHit[] } {
    const active = this.session.dragging && this.session.state.partId === partId;
    const geo = active ? this.scene.partSeatHalf(partId) : null;
    const hits = !geo
      ? []
      : this.clearance.queryInteractive({ partId, obb: boxObbAt(this.cursor, geo.half) });
    this.scene.setCameraControlEnabled(true);
    if (!active) return { ok: false, hits };
    const landed = this.session.finish();
    this.scene.setMeshHighlight(partId, 'none');
    // 无论贴合或回 scatter，均让引擎同步一次分态摆位 + clearance 集（land→青贴seat；否则回散落）
    this.onStateChange();
    this.scene.requestRender();
    return { ok: landed, hits };
  }
}

/* ------------------------------------------------------------------ */
/* 顶层 BabylonSimEngine + 工厂（WebGL 不可用时回落 Noop）             */
/* ------------------------------------------------------------------ */

export class BabylonSimEngine implements SimEngine {
  readonly backend = 'babylon' as const;
  readonly scene: BabylonScene;
  readonly assets: BabylonAssets;
  readonly interaction: InteractionManager;
  readonly assembly: AssemblyController;
  readonly clearance: ClearanceController;

  private _activeLineId: string | null = null;
  private _initialized = false;
  private _fps = 0;
  private _line: ProductionLine | null = null;
  /** S2 · 装配过程动画驱动器（纯逻辑，每帧由 scene.onFrame 推进） */
  private _animator: AssemblyAnimator | null = null;

  constructor() {
    this.clearance = new NoopClearance();
    this.scene = new BabylonScene();
    this.assets = new BabylonAssets(this.scene);
    this.assembly = new NoopAssembler(this.clearance);
    // S3c · 手动拖拽真拾取/落位交互，注入引擎分态同步（land→青贴seat / snap→回散落 + clearance 重登记）
    this.interaction = new BabylonInteraction(this.scene, this.assembly as NoopAssembler, this.clearance as NoopClearance, () => this.syncAssemblyState());
  }

  /** S2 · 读取当前动画播放态（供 HUD/断言） */
  get animPlaying(): boolean {
    return this._animator?.playing ?? false;
  }
  get animCursorSeq(): number {
    return this._animator?.cursorSeq ?? 0;
  }
  get animTotalSteps(): number {
    return this._animator?.totalSteps ?? 0;
  }
  get animDone(): boolean {
    const a = this._animator;
    return a ? a.cursorSeq >= a.totalSteps : false;
  }
  /** S2 · 门面契约：动画播放态聚合（供 HUD/无 WebGL 断言读取） */
  get animState(): SimEngine['animState'] {
    return {
      playing: this.animPlaying,
      cursorSeq: this.animCursorSeq,
      totalSteps: this.animTotalSteps,
      done: this.animDone,
    };
  }

  /**
   * S2 · 装载 BOM 后初始化动画驱动器：绑定每帧推进（scene.onFrame）与落集合回调。
   * 驱动器与装配状态机共享同一 BOM 步骤序；placements 来自 scene 缓存（seat/scatter）。
   */
  private _wireAnimator(): void {
    const bom = this.assets.synthesizedBom;
    const placements = this.scene.placements;
    if (!bom || placements.length === 0) return;
    const animator = new AssemblyAnimator({
      placements,
      getSteps: () => bom.steps,
      onAssemble: (partId) => this._landAnimatedPart(partId),
    });
    this._animator = animator;
    // 每帧：推进动画并结算"飞行中"零件的插值位；播放结束自动停。
    this.scene.onFrame = () => {
      if (!this._animator) return;
      this._animator.tick();
      // 飞行中的件 → 用插值位覆盖（视觉平滑滑向 seat）；无飞行件则保持 S1 seat/scatter 判定
      const fid = this._animator.flyingPartId;
      if (fid) {
        const pos = this._animator.pose(fid);
        if (pos) this.scene.applyFlightPose(fid, pos);
      }
    };
    // 让驱动器游标对齐状态机当前步（如初始 seekTo 到全贴合）
    this._animator.syncCursor(this.assembly.currentStepSeq);
  }

  /** S2 · 动画完成某件 → 落进装配状态机（factual）+ 渲染停驻青色 seat */
  private _landAnimatedPart(partId: string): void {
    if (!this.assembly.assemble(partId)) return;
    // 该件已视觉滑到 seat —— 用 S1 sync 把集合/tint 落定（含本次新贴合件）
    this.syncAssemblyState();
  }

  /** S2 · 自动播放（auto/replay）：从当前装配步起逐件播过渡到全贴合。返回是否开始 */
  playAssembly(): boolean {
    const animator = this._animator;
    if (!animator) return false;
    // 驱动器游标对齐状态机（手动步进/撤销后也能续播）
    if (animator.cursorSeq !== this.assembly.currentStepSeq) {
      animator.syncCursor(this.assembly.currentStepSeq);
    }
    return animator.play();
  }

  pauseAssembly(): boolean {
    return this._animator?.pause() ?? false;
  }

  /** S2 · 复位到初始（全部散落待装配）并停播放 —— auto/replay 从头演示用 */
  resetForPlay(): { seated: number; scattered: number } {
    const bom = this.assembly.bom;
    if (!bom) return this.scene.stateSnapshot;
    this.assembly.seekTo(0); // 集合清空
    this._animator?.seekTo(0);
    this.syncAssemblyState(); // 全部落散落位
    return this.scene.stateSnapshot;
  }

  init(opts: { container?: HTMLElement; line?: ProductionLine }): EngineHealth {
    this._initialized = true;
    this._line = opts.line ?? null;
    if (opts.line) this._activeLineId = opts.line.id;
    if (opts.container) {
      const mounted = this.scene.mount(opts.container);
      // S3c · 视口就绪后绑定 pointer 拖拽监听（canvas 已创建）
      if (mounted) (this.interaction as BabylonInteraction).wirePointer();
      // 视口渲染循环由 Scene 管理；fps 通过帧计数近似（取整数）
      if (mounted && opts.line) {
        void this.assets.loadLine(opts.line).then(() => {
          // S1：把与盒体同源的合成 BOM 装进状态机，让 assembledPartIds 可驱动分态；
          // 默认保持"整机完整贴合"（0.2 观感延续），装配/撤销由 UI 经 syncAssemblyState 驱动。
          const bom = this.assets.synthesizedBom;
          if (bom) {
            this.assembly.load(bom);
            this.assembly.seekTo(bom.steps.length); // 全贴合起始
            this._wireAnimator(); // S2：装配动画驱动器绑定（每帧推进 + 落集合回调）
            this.syncAssemblyState();
          }
          if (this.scene.isMounted) this.scene.requestRender();
        });
      }
    }
    return this.health();
  }

  dispose(): void {
    this.scene.unmount(); // unmount 内清 onFrame + _placements
    this._animator = null;
    this.assets.dispose();
    this._activeLineId = null;
    this._initialized = false;
    this._line = null;
  }

  /**
   * S1 · 门面驱动口：读取装配状态机的单一事实 `assembly.assembledPartIds`，
   * 同步到 BabylonScene 的「已贴合/散落」两态摆位。
   * 由 UI / S2-S3 动画驱动器在每次 `assembly.assemble/undo/seekTo` 后调用。
   * 返回应用后的 {seated, scattered}，供 HUD/断言读取。
   */
  syncAssemblyState(): { seated: number; scattered: number } {
    // 非播放时（手动 assemble/undo/seek/复位）让动画游标对齐装配状态机步进，
    // 保证后续 play 能从当前步续播。播放中（onAssemble 回调触发本方法）跳过，
    // 避免 syncCursor 清飞行打断正在进行的动画。
    if (!this._animator?.playing) {
      this._animator?.syncCursor(this.assembly.currentStepSeq);
    }
    // S3b · 把"已装配集合"的 seat OBB 对齐进 clearance 静态集，使拖拽实时干涉
    //       能看到当前已贴合件。被拖拽的散落件不在 assembledPartIds → 天然排除，
    //       不会把自己误判为障碍。
    this._syncClearanceSeated();
    if (!this.scene.isMounted) return this.scene.stateSnapshot;
    return this.scene.setAssemblyState(new Set(this.assembly.assembledPartIds));
  }

  /** S3b · 注册"已装配零件在 seat 处"的世界 OBB 为 clearance 静态集（覆盖式） */
  private _syncClearanceSeated(): void {
    const seated = new Set(this.assembly.assembledPartIds);
    this.clearance.registerAssembled(this.scene.seatObbsOf(seated));
  }

  health(): EngineHealth {
    return {
      ok: this._initialized && (this.scene.isMounted || !this.scene.isMounted),
      backend: 'babylon',
      activeLineId: this._activeLineId,
      fps: this._fps,
      assembledParts: this.assembly.assembledPartIds.length,
      totalParts: this._line ? Math.min(60, Math.max(12, Math.max(1, this._line.stations.length) * 3)) : 0,
      rendering: this.scene.isMounted,
    };
  }
}

/**
 * 门面工厂 —— 唯一构造入口（业务不感知后端切换）。
 * 返回优先级：真 Babylon（WebGL 可用）> Noop 替身（无 WebGL / 测试环境）。
 */
export function createSimEngine(): SimEngine {
  if (detectWebGL()) {
    return new BabylonSimEngine();
  }
  // 无 WebGL（vitest/jsdom/CI/无头）→ 回落 Noop，业务代码零改动
  return new NoopSimEngine();
}
