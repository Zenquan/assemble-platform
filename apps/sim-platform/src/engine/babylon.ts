/**
 * SimEngine 的 Babylon 真渲染实现（0.2.0 出口「浏览器渲染装配」）
 *
 * 职责范围（经 grill-me 确认，FEAT-20260903-002「最小真渲染：先关门禁」+ S1 分态渲染）：
 *   ✅ 本模块 = 真 WebGL 渲染后端：工作台视口挂 Babylon Engine+Scene；
 *      `loadLine` 按 assembly-svc BOM 从 model-svc 加载真实 GLB，
 *      配网格 + 坐标轴 + ArcRotateCamera + 环境/平行光 + HUD(STEP/引擎实时)。
 *   ✅ S1 · 分态渲染：零件被分为「已贴合 / 待装配」两态。已贴合停 seat（贴合位），
 *      待装配停确定性散落待料位；由 `assembledPartIds` 驱动归属切换（`setAssemblyState`）。
 *   ✅ S2 · 装配过程动画：门面经 `AssemblyAnimator`（纯逻辑驱动器）在每帧（scene.onFrame）
 *      推进 auto/replay 播放，零件从散落位平滑滑向贴合位；seek/undo 仍走瞬时跳变。
 *   ✅ 可见模型只使用 GLB；不可见代理仅用于拾取与 OBB 干涉，不参与视觉呈现。
 *
 * 架构红线（ARCHITECTURE §2）：
 *   1. 本文件是本仓**唯一** import '@babylonjs/core' 的渲染实现边界；
 *   2. 业务组件/视图只经 `SimEngine` 门面（types.ts）拿到本实现的窄接口，
 *      绝不直接 import 本文件或 Babylon；
 *   3. `createSimEngine()` 在无 WebGL（vitest/jsdom/CI）时回落 Noop 替身，
 *      保证单测不启真渲染、契约仍可被无 WebGL 验证。
 */

import {
  AbstractMesh,
  ArcRotateCamera,
  Color3,
  Color4,
  DirectionalLight,
  Engine,
  HemisphericLight,
  Matrix,
  Mesh,
  MeshBuilder,
  PBRMaterial,
  Quaternion,
  Scene,
  SceneLoader,
  StandardMaterial,
  TransformNode,
  Vector3,
} from '@babylonjs/core';
import '@babylonjs/loaders/glTF'; // side-effect: register glTF loader plugin (Babylon 9 split)

import type { AssemblyBom, OBB, ProductionLine, Vec3 } from '@assemble/domain';
import { obbFromCenterHalfExtents } from '@assemble/clearance-core';

import { modelGlbUrl } from '../api/model.js';

import { NoopAssembler, NoopClearance, NoopSimEngine } from './noop.js';
import { AssemblyAnimator } from './animator.js';
import { computeTwoStatePlacement, type PartPlacement } from './placement.js';
import { ManualDragSession, boxObbAt, rayPlaneYIntersect, type DragGeometry } from './drag.js';
import { fitSphereCameraRadius } from './framing.js';
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
const NO_IBL_MIN_ROUGHNESS = 0.7;
const PART_FRAME_MIN_RADIUS = 8;
const PART_FRAME_PADDING = 1.15;

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
  /** partId -> 不可见拾取/碰撞代理；可见模型只存在于 visualRoots。 */
  private meshes = new Map<string, Mesh>();
  /** partId -> GLB 可见根节点。 */
  private visualRoots = new Map<string, TransformNode>();
  /** partId -> GLB 中实际有顶点的 mesh，用于状态 overlay。 */
  private visualMeshes = new Map<string, AbstractMesh[]>();
  /** partId -> 可见根节点到代理中心的世界偏移。 */
  private visualCenterOffsets = new Map<string, Vector3>();
  /** 不可动基座始终停在 seat，不随 assembledPartIds 散落。 */
  private immovablePartIds = new Set<string>();
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
      // 0.4.x · 设备 PBR 金属需要强方向光 + 一定环境填光才可见（glb 大量 metal* 材质
      // 在无 IBL/环境贴图时接近全黑）。三方向光照 + 半球填光，强度分别调高，让
      // 设备外壳高光区域/暗部都能在深色背景里分辨。
      const dirA = new DirectionalLight('dirA', new Vector3(-0.5, -1, -0.6), this.scene);
      dirA.intensity = 1.4;
      dirA.diffuse = new Color3(1.0, 0.96, 0.86); // 暖白主光
      const dirB = new DirectionalLight('dirB', new Vector3(0.7, -0.6, 0.5), this.scene);
      dirB.intensity = 0.7;
      dirB.diffuse = new Color3(0.7, 0.85, 1.0); // 冷蓝辅光（另一侧补形）
      // 提亮半球光强度，强化暗部填充（让金属背光面有底色）
      if (hemi && 'intensity' in hemi) hemi.intensity = 1.1;
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
    if (!this.camera || partIds.length === 0) return;
    let cx = 0;
    let cy = 0;
    let cz = 0;
    const selectedParts: Array<{ center: Vector3; half: Vec3 }> = [];
    for (const id of partIds) {
      const mesh = this.meshes.get(id);
      const half = this.halfSize.get(id);
      if (!mesh || !half) continue;
      selectedParts.push({ center: mesh.position, half });
      cx += mesh.position.x;
      cy += mesh.position.y;
      cz += mesh.position.z;
    }
    if (selectedParts.length === 0) return;
    const target = new Vector3(
      cx / selectedParts.length,
      cy / selectedParts.length,
      cz / selectedParts.length,
    );
    let boundingRadius = 0;
    for (const part of selectedParts) {
      boundingRadius = Math.max(
        boundingRadius,
        Vector3.Distance(part.center, target) + Math.max(...part.half),
      );
    }
    this.camera.setTarget(target);
    this.camera.radius = fitSphereCameraRadius({
      boundingRadius,
      verticalFovRadians: this.camera.fov,
      aspectRatio: this.engine?.getAspectRatio(this.camera) ?? 1,
      minRadius: PART_FRAME_MIN_RADIUS,
      padding: PART_FRAME_PADDING,
    });
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

  private _clearParts(): void {
    for (const mesh of this.meshes.values()) mesh.dispose(false, true);
    for (const root of this.visualRoots.values()) root.dispose(false, true);
    this.meshes.clear();
    this.visualRoots.clear();
    this.visualMeshes.clear();
    this.visualCenterOffsets.clear();
    this.immovablePartIds.clear();
    this.seatPos.clear();
    this.scatterPos.clear();
    this.halfSize.clear();
    this._partOrder = [];
    this._placements = [];
  }

  private _boundsOf(meshes: readonly AbstractMesh[]): {
    min: Vector3;
    max: Vector3;
  } | null {
    let min: Vector3 | null = null;
    let max: Vector3 | null = null;
    for (const mesh of meshes) {
      mesh.computeWorldMatrix(true);
      mesh.refreshBoundingInfo({});
      const box = mesh.getBoundingInfo().boundingBox;
      min = min ? Vector3.Minimize(min, box.minimumWorld) : box.minimumWorld.clone();
      max = max ? Vector3.Maximize(max, box.maximumWorld) : box.maximumWorld.clone();
    }
    return min && max ? { min, max } : null;
  }

  private _setPartCenter(partId: string, center: Vector3): void {
    const proxy = this.meshes.get(partId);
    if (proxy) proxy.position.copyFrom(center);
    const root = this.visualRoots.get(partId);
    const offset = this.visualCenterOffsets.get(partId);
    if (root && offset) root.position.copyFrom(center.subtract(offset));
  }

  private _setPartOverlay(partId: string, color: Color3 | null, alpha = 0): void {
    for (const mesh of this.visualMeshes.get(partId) ?? []) {
      mesh.renderOverlay = color !== null;
      if (color) mesh.overlayColor = color;
      mesh.overlayAlpha = alpha;
    }
  }

  private _restorePartStateOverlay(partId: string): void {
    if (this.immovablePartIds.has(partId) || this._assembledIds.has(partId)) {
      this._setPartOverlay(partId, null);
      return;
    }
    this._setPartOverlay(partId, new Color3(0.95, 0.62, 0.18), 0.28);
  }

  /**
   * 按后端 BOM 加载真实 GLB。GLB 是唯一可见零件；透明 box 仅承载拾取与 OBB。
   * 任一资产失败即清理本轮已加载内容并抛错，不回退到可见模拟盒。
   */
  async renderParts(bom: AssemblyBom): Promise<void> {
    const scene = this.scene;
    if (!scene) throw new Error('Babylon 场景尚未挂载');
    this._clearParts();

    const renderParts: RenderPart[] = [];
    try {
      for (const part of bom.parts) {
        const container = await SceneLoader.LoadAssetContainerAsync('', modelGlbUrl(part.assetId), scene);
        const visualRoot = new TransformNode(`visual-${part.id}`, scene);
        const contentRoot = new TransformNode(`content-${part.id}`, scene);
        contentRoot.parent = visualRoot;
        container.addAllToScene();
        for (const node of container.rootNodes) node.parent = contentRoot;

        const meshes = container.meshes.filter((mesh) => mesh.getTotalVertices() > 0);
        if (meshes.length === 0) {
          container.dispose();
          throw new Error(`资产 ${part.assetId} 不包含可渲染 mesh`);
        }
        for (const mesh of meshes) {
          mesh.isPickable = false;
          mesh.alwaysSelectAsActiveMesh = true;
          if (!scene.environmentTexture && mesh.material instanceof PBRMaterial) {
            mesh.material.metallic = 0;
            mesh.material.roughness = Math.max(
              mesh.material.roughness ?? NO_IBL_MIN_ROUGHNESS,
              NO_IBL_MIN_ROUGHNESS,
            );
          }
        }

        const initialBounds = this._boundsOf(meshes);
        if (!initialBounds) throw new Error(`资产 ${part.assetId} 无有效包围盒`);
        const initialCenter = initialBounds.min.add(initialBounds.max).scale(0.5);
        contentRoot.position.set(-initialCenter.x, -initialBounds.min.y, -initialCenter.z);
        visualRoot.rotationQuaternion = new Quaternion(
          part.localRotation.x,
          part.localRotation.y,
          part.localRotation.z,
          part.localRotation.w,
        );
        visualRoot.position.set(
          part.localPosition[0],
          part.localPosition[1],
          part.localPosition[2],
        );

        const finalBounds = this._boundsOf(meshes);
        if (!finalBounds) throw new Error(`资产 ${part.assetId} 无有效世界包围盒`);
        const center = finalBounds.min.add(finalBounds.max).scale(0.5);
        const halfVector = finalBounds.max.subtract(finalBounds.min).scale(0.5);
        const half: Vec3 = [
          Math.max(halfVector.x, 0.01),
          Math.max(halfVector.y, 0.01),
          Math.max(halfVector.z, 0.01),
        ];
        const proxy = MeshBuilder.CreateBox(
          `part-${part.id}`,
          { width: half[0] * 2, height: half[1] * 2, depth: half[2] * 2 },
          scene,
        );
        proxy.position.copyFrom(center);
        proxy.visibility = 0;
        proxy.isPickable = part.isMovable;
        proxy.metadata = { partId: part.id, role: 'interaction-proxy' };

        this.meshes.set(part.id, proxy);
        this.visualRoots.set(part.id, visualRoot);
        this.visualMeshes.set(part.id, meshes);
        this.visualCenterOffsets.set(part.id, center.subtract(visualRoot.position));
        if (!part.isMovable) this.immovablePartIds.add(part.id);
        renderParts.push({
          partId: part.id,
          center: [center.x, center.y, center.z],
          half,
        });
      }
    } catch (error) {
      this._clearParts();
      throw error instanceof Error ? error : new Error('GLB 装配资产加载失败');
    }

    const placements = computeTwoStatePlacement(renderParts);
    this._placements = placements;
    this._partOrder = renderParts.map((part) => part.partId);
    for (const [index, placement] of placements.entries()) {
      const part = renderParts[index];
      if (!part) continue;
      const seat = new Vector3(placement.seat[0], placement.seat[1], placement.seat[2]);
      this.seatPos.set(part.partId, seat);
      this.scatterPos.set(
        part.partId,
        new Vector3(placement.scatter[0], placement.scatter[1], placement.scatter[2]),
      );
      this.halfSize.set(part.partId, part.half);
      this._setPartCenter(part.partId, seat);
    }
    this._frameWholeAssembly(renderParts);
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
    this.camera.radius = fitSphereCameraRadius({
      boundingRadius: maxR,
      verticalFovRadians: this.camera.fov,
      aspectRatio: this.engine?.getAspectRatio(this.camera) ?? 1,
    });
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
      const halfExtents = this.halfSize.get(id) ?? [0.8, 0.8, 0.8];
      const half = Math.max(halfExtents[0], halfExtents[1], halfExtents[2]);
      const dx = Math.abs(mesh.position.x - cx) + half;
      const dy = Math.abs(mesh.position.y - cy) + half;
      const dz = Math.abs(mesh.position.z - cz) + half;
      const r = Math.hypot(dx, dy, dz);
      if (r > maxR) maxR = r;
    }
    this.camera.setTarget(new Vector3(cx, cy, cz));
    this.camera.radius = fitSphereCameraRadius({
      boundingRadius: maxR,
      verticalFovRadians: this.camera.fov,
      aspectRatio: this.engine?.getAspectRatio(this.camera) ?? 1,
    });
  }

  /**
   * S1 · 分态渲染核心：把零件按「已贴合 / 待装配」两态摆位。
   * - `assembledIds` 中的零件 → 停 seat（贴合位）；
   * - 其余零件 → 停 scatter（确定性散落待料位）。
   * 归属由外部单一事实 `assembly.assembledPartIds` 驱动（本方法不私有持有集合）。
   * 返回本次应用后的 {seated, scattered} 供调用方/门面断言与 HUD 展示。
   */
  setAssemblyState(assembledIds: ReadonlySet<string>): { seated: number; scattered: number } {
    if (!this.scene) return this.stateSnapshot;
    this._assembledIds = new Set(assembledIds);
    const pendingTint = new Color3(0.95, 0.62, 0.18);
    for (const id of this.meshes.keys()) {
      const seat = this.seatPos.get(id);
      const scatter = this.scatterPos.get(id);
      if (!seat || !scatter) continue;
      const assembled = this.immovablePartIds.has(id) || assembledIds.has(id);
      this._setPartCenter(id, assembled ? seat : scatter);
      this._setPartOverlay(id, assembled ? null : pendingTint, assembled ? 0 : 0.28);
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
    if (!this.meshes.has(partId)) return;
    const seat = this.seatPos.get(partId);
    if (this.immovablePartIds.has(partId)) {
      if (seat) this._setPartCenter(partId, seat);
      return;
    }
    if (pos) {
      this._setPartCenter(partId, new Vector3(pos[0], pos[1], pos[2]));
      return;
    }
    const scatter = this.scatterPos.get(partId);
    if (this._assembledIds.has(partId) && seat) this._setPartCenter(partId, seat);
    else if (scatter) this._setPartCenter(partId, scatter);
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
    if (!this.meshes.has(partId)) return;
    this._setPartCenter(partId, new Vector3(center[0], center[1], center[2]));
  }

  /** 取某件 mesh 当前世界中心（拖拽起点/复位用）；无该件返回 null。 */
  meshCenterOf(partId: string): Vec3 | null {
    const mesh = this.meshes.get(partId);
    if (!mesh) return null;
    return [mesh.position.x, mesh.position.y, mesh.position.z];
  }

  /** 临时高亮某件 mesh（拖拽 hover / 干涉变红）。'none' 还原材质原色（琥珀散落/青贴合由 setAssemblyState 统一） */
  setMeshHighlight(partId: string, kind: 'none' | 'hover' | 'blocked'): void {
    if (!this.meshes.has(partId)) return;
    if (kind === 'blocked') this._setPartOverlay(partId, new Color3(0.95, 0.2, 0.2), 0.55);
    else if (kind === 'hover') this._setPartOverlay(partId, new Color3(0.4, 0.7, 1.0), 0.4);
    else this._restorePartStateOverlay(partId);
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
/* AssetManager —— 按后端 BOM 加载真实 GLB                           */
/* ------------------------------------------------------------------ */

class BabylonAssets implements AssetManager {
  private sceneMgr: BabylonScene;
  private _loaded = 0;
  private _partIds: string[] = [];

  constructor(sceneMgr: BabylonScene) {
    this.sceneMgr = sceneMgr;
  }

  get loadedPartCount(): number {
    return this._loaded;
  }

  async loadLine(line: ProductionLine, bom: AssemblyBom): Promise<readonly string[]> {
    if (line.id !== bom.lineId) throw new Error('产线与 BOM 不匹配');
    await this.sceneMgr.renderParts(bom);
    this._partIds = bom.parts.map((part) => part.id);
    this._loaded = this._partIds.length;
    return this._partIds;
  }

  dispose(): void {
    // 场景卸载由 SceneManager.unmount 统一清理网格；这里仅清登记
    this._loaded = 0;
    this._partIds = [];
  }
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

  private blockingHits(partId: string, obb: OBB): import('@assemble/domain').InterferenceHit[] {
    const parentId = this.assembly.bom?.parts.find((part) => part.id === partId)?.parentId;
    return this.clearance.queryInteractive({ partId, obb }).filter((hit) => {
      if (!parentId) return true;
      const counterpart = hit.firstPartId === partId ? hit.secondPartId : hit.firstPartId;
      return counterpart !== parentId;
    });
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
    if (this.blockingHits(partId, boxObbAt(candidate, geo.half)).length > 0) {
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
      (moving) => this.blockingHits(partId, moving.obb),
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
      : this.blockingHits(partId, boxObbAt(this.cursor, geo.half));
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
    const bom = this.assembly.bom;
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
    const firstMovableStep = bom.steps.findIndex((step) =>
      bom.parts.find((part) => part.id === step.partId)?.isMovable !== false,
    );
    const initialStepSeq = firstMovableStep < 0 ? bom.steps.length : firstMovableStep;
    this.assembly.seekTo(initialStepSeq);
    this._animator?.seekTo(initialStepSeq);
    this.syncAssemblyState(); // 全部落散落位
    return this.scene.stateSnapshot;
  }

  async init(opts: {
    container?: HTMLElement;
    line: ProductionLine;
    bom: AssemblyBom;
  }): Promise<EngineHealth> {
    if (opts.line.id !== opts.bom.lineId) throw new Error('产线与 BOM 不匹配');
    this._activeLineId = opts.line.id;
    try {
      if (opts.container) {
        const mounted = this.scene.mount(opts.container);
        if (!mounted) throw new Error('WebGL 场景初始化失败');
        (this.interaction as BabylonInteraction).wirePointer();
        await this.assets.loadLine(opts.line, opts.bom);
      }
      this.assembly.load(opts.bom);
      this.assembly.seekTo(opts.bom.steps.length);
      this._wireAnimator();
      this._initialized = true;
      this.syncAssemblyState();
      if (this.scene.isMounted) this.scene.requestRender();
      return this.health();
    } catch (error) {
      this.dispose();
      throw error;
    }
  }

  dispose(): void {
    this.scene.unmount(); // unmount 内清 onFrame + _placements
    this._animator = null;
    this.assets.dispose();
    this._activeLineId = null;
    this._initialized = false;
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
      totalParts: this.assembly.bom?.parts.length ?? 0,
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
