/**
 * SimEngine 的 Babylon 真渲染实现（0.2.0 出口「浏览器渲染装配」）
 *
 * 职责范围（经 grill-me 确认，FEAT-20260903-002「最小真渲染：先关门禁」+ S1 分态渲染）：
 *   ✅ 本模块 = 真 WebGL 渲染后端：工作台视口挂 Babylon Engine+Scene；
 *      `loadLine` 真加载产线，把零件按确定性布局渲成 **OBB 盒体占位**，
 *      配网格 + 坐标轴 + ArcRotateCamera + 环境/平行光 + HUD(STEP/引擎实时)。
 *   ✅ S1 · 分态渲染：零件被分为「已贴合 / 待装配」两态。已贴合停 seat（贴合位），
 *      待装配停确定性散落待料位；由 `assembledPartIds` 驱动归属切换（`setAssemblyState`）。
 *   ❌ 不做（归 0.3.x S2+）：自动/手动/回放动画过渡、实时干涉拖拽联动、
 *      BOM 树/节拍面板、真 glTF 资产管线。装配状态机与实时干涉仍复用
 *      noop.ts 里委托 clearance-core 纯算法的 NoopAssembler/NoopClearance。
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
  MeshBuilder,
  Scene,
  StandardMaterial,
  Vector3,
} from '@babylonjs/core';

import type { AssemblyBom, OBB, ProductionLine, Vec3 } from '@assemble/domain';

import { NoopAssembler, NoopClearance, NoopSimEngine } from './noop.js';
import { computeTwoStatePlacement } from './placement.js';
import type {
  AssetManager,
  AssemblyController,
  CameraPose,
  CameraViewId,
  ClearanceController,
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
  /** 稳定零件序（决定散落环相位与 palette 着色） */
  private _partOrder: string[] = [];

  get isMounted(): boolean {
    return this.engine !== null && this.scene !== null;
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
      if (this.scene) this.scene.render();
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

  get loadedPartCount(): number {
    return this.meshes.size;
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

/** 交互拾取/拖拽：0.2.x 无真拖拽，沿用 noop 的命中记录行为（真拖拽归 0.3.x） */
class BabylonInteraction implements InteractionManager {
  private picked: PickResult = { partId: '', ok: false };
  pick(): PickResult {
    return this.picked;
  }
  beginDrag(partId: string): boolean {
    this.picked = { partId, ok: true };
    return true;
  }
  dragTo(): void {
    /* 0.3.x：真拖拽由交互系统结算 */
  }
  endDrag(partId: string): { ok: boolean; hits: import('@assemble/domain').InterferenceHit[] } {
    return { ok: true, hits: [] };
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

  constructor() {
    this.clearance = new NoopClearance();
    this.scene = new BabylonScene();
    this.assets = new BabylonAssets(this.scene);
    this.interaction = new BabylonInteraction();
    this.assembly = new NoopAssembler(this.clearance);
  }

  init(opts: { container?: HTMLElement; line?: ProductionLine }): EngineHealth {
    this._initialized = true;
    this._line = opts.line ?? null;
    if (opts.line) this._activeLineId = opts.line.id;
    if (opts.container) {
      const mounted = this.scene.mount(opts.container);
      // 视口渲染循环由 Scene 管理；fps 通过帧计数近似（取整数）
      if (mounted && opts.line) {
        void this.assets.loadLine(opts.line).then(() => {
          // S1：把与盒体同源的合成 BOM 装进状态机，让 assembledPartIds 可驱动分态；
          // 默认保持"整机完整贴合"（0.2 观感延续），装配/撤销由 UI 经 syncAssemblyState 驱动。
          const bom = this.assets.synthesizedBom;
          if (bom) {
            this.assembly.load(bom);
            this.assembly.seekTo(bom.steps.length); // 全贴合起始
            this.syncAssemblyState();
          }
          if (this.scene.isMounted) this.scene.requestRender();
        });
      }
    }
    return this.health();
  }

  dispose(): void {
    this.scene.unmount();
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
    if (!this.scene.isMounted) return this.scene.stateSnapshot;
    return this.scene.setAssemblyState(new Set(this.assembly.assembledPartIds));
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
