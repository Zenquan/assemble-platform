/**
 * @assemble/sim-platform —— SimEngine 门面公开契约
 *
 * 架构红线（ARCHITECTURE §2）：业务组件（views/stores/components）**禁止直接
 * import '@babylonjs/core'**，一律只经本门面访问渲染与装配能力。
 * 本文件仅定义**引擎无关的窄接口**，返回可序列化轻量值类型（可进 Pinia / 组件状态）。
 *
 * 三能力（对应 ARCHITECTURE §2 表格）：
 *   1. 实时装配  —— AssemblyController（auto/manual/replay 三模式 + 约束贴合）
 *   2. 实时干涉  —— ClearanceController（委托 @assemble/clearance-core 纯算法）
 *   3. 节拍可视  —— SceneManager / AssetManager / InteractionManager（动画/视口）
 *
 * 依赖方向：本目录只 import '@assemble/domain' / '@assemble/clearance-core' 的类型与
 * 纯算法，不 import 任何 WebGL / Babylon 实现。渲染实现隔离在 engine/noop.ts（测试替身）
 * 与未来的 engine/babylon.ts，由 `createSimEngine()` 工厂返回当前实现。
 */

import type {
  AssemblyBom,
  AssemblyMode,
  AssemblyPart,
  AssemblyStep,
  InterferenceHit,
  InterferenceReport,
  OBB,
  ProductionLine,
  Vec3,
} from '@assemble/domain';

/* ------------------------------------------------------------------ */
/* 通用值类型（引擎无关，可序列化）                                    */
/* ------------------------------------------------------------------ */

/** 相机预设视角 */
export type CameraViewId = 'iso' | 'front' | 'top' | 'side' | 'free';

/** 相机位姿快照（mm / 欧拉角或朝向向量，由实现映射到引擎相机） */
export interface CameraPose {
  viewId: CameraViewId;
  position: Vec3;
  target: Vec3;
  /** 是否正交轴测（true=工程轴测，false=透视） */
  orthographic: boolean;
}

/** 拾取/拖拽命中结果 */
export interface PickResult {
  partId: string;
  ok: boolean;
  /** 命中点在零件局部系下的坐标 */
  hitPointLocal?: Vec3;
}

/** 装配约束贴合动画的进度回调载荷 */
export interface SnapProgress {
  /** 移动中的零件 id */
  partId: string;
  /** 进度 0-1 */
  t: number;
  /** 当前贴合中的约束类型（人工装配时逐步贴合多个约束） */
  constraintStep: number;
}

/** 装配模式切换的即时状态（供组件驱动 UI 高亮） */
export interface ModeSwitchResult {
  from: AssemblyMode;
  to: AssemblyMode;
  ok: boolean;
  /** 切换失败/被拒原因（如手动模式下有未落位零件） */
  reason?: string;
}

/** 引擎运行状态（顶栏"引擎实时/引擎在线"徽标 + 性能页数据源） */
export interface EngineHealth {
  ok: boolean;
  /** 渲染后端标识：本轮 'noop'，接入 Babylon 后为 'babylon' */
  backend: 'noop' | 'babylon';
  /** 已初始化的产线 id（未加载则为 null） */
  activeLineId: string | null;
  fps: number;
  /** 上一帧 draw call 数（Babylon 内部计数；noop 恒 0） */
  drawCalls: number;
  /** 场景活动网格数（渲染对象规模，noop 恒 0） */
  activeMeshes: number;
  /** 上一帧渲染顶点总数（noop 恒 0） */
  totalVertices: number;
  /** 已装配零件数 / 总数 */
  assembledParts: number;
  totalParts: number;
  /** 是否处于渲染循环中 */
  rendering: boolean;
}

/* ------------------------------------------------------------------ */
/* 门面能力管理器（窄接口）                                            */
/* ------------------------------------------------------------------ */

/** 场景与视口生命周期（节拍可视 · 基础层） */
export interface SceneManager {
  /** 挂载渲染视口到指定 DOM 容器，返回挂载是否成功（noop 恒 true，占位 canvas） */
  mount(container: HTMLElement): boolean;
  /** 卸载并释放视口资源 */
  unmount(): void;
  /** 设置当前相机视角（轴测/前/顶/侧），返回最新位姿 */
  setCamera(viewId: CameraViewId): CameraPose;
  /** 以给定零件包围盒适配视野（"适配/聚焦"） */
  frameToPart(partIds: readonly string[]): void;
  /** 高亮/清除一组零件的干涉命中外观；由引擎层统一消费，业务不 touch 场景。 */
  highlightParts(partIds: readonly string[], on: boolean): void;
  /** 恢复初始化轴测方向，并按整条真实装配体重新适配视野 */
  frameToAssembly(): void;
  /** 请求一次渲染（手动重绘 / 测试用）；返回当前帧渲染是否成功 */
  requestRender(): boolean;
  /** 开始/停止渲染循环 */
  setRendering(on: boolean): void;
}

/** 模型资产加载（BOM 给出资产 id，由 ModelSvc 返回真实 GLB） */
export interface AssetManager {
  /**
   * 加载一条产线的装配资产，成功返回零件 id 列表。
   * 可见几何只能来自 BOM 指向的后端 GLB；实现不得生成可见占位盒。
   */
  loadLine(line: ProductionLine, bom: AssemblyBom): Promise<readonly string[]>;
  /** 卸载当前产线资源，释放内存 */
  dispose(): void;
  /** 当前已加载零件总数 */
  readonly loadedPartCount: number;
}

/** 手动拖拽会话的实时状态（供 HUD / 无 WebGL 断言读取，引擎无关值类型） */
export interface DragLiveState {
  /** 是否正处于拖拽会话中 */
  dragging: boolean;
  /** 当前被拖拽的零件 id（未拖拽为空串） */
  partId: string;
  /** 当前候选是否与已装配件干涉（命中→拦截/变红） */
  blocked: boolean;
  /** 命中并拦截的已装配件 id（供提示；无命中为空串） */
  hitPartId: string;
  /** XZ 是否已贴近该件 seat（吸附半径内） */
  nearSeat: boolean;
  /** 综合结算：可落位 = 贴近 seat 且无干涉 */
  canLand: boolean;
  /** 会话阶段/原因（供 UI 文案与测试断言） */
  reason:
    | 'idle' // 未拖拽
    | 'not-movable' // 目标不可拖（非散落待装件 / 非下一步件）
    | 'dragging' // 拖拽进行中
    | 'blocked' // 拖拽中且当前干涉（拦截）
    | 'landed' // 本次成功贴合
    | 'snapped-back'; // 本次未能落位，回散落位
}

/** GLB `extras.motion` 节点的运行态动画控制。 */
export interface RuntimeAnimationController {
  /** 当前是否在逐帧采样运行态位姿 */
  readonly playing: boolean;
  /** 已从当前产线 GLB 绑定的运动节点数 */
  readonly boundNodeCount: number;
  /** 启动运行态动画；没有运动节点时返回 false */
  start(): boolean;
  /** 暂停并保持当前设备位姿 */
  pause(): boolean;
  /** 清除运行态时间并恢复 GLB 初始位姿 */
  reset(): void;
  /** 当前随产线传送路径运动的物料件数 */
  readonly materialItemCount: number;
  /** 物料流转已完成件数 */
  readonly materialCompletedUnits: number;
  /** 当前有物料经过的工位 id */
  readonly activeStationIds: readonly string[];
}

/** 交互拾取/拖拽（手动装配入口） */
export interface InteractionManager {
  /** 屏幕坐标拾取零件；返回命中零件（noop 未接真实射线时按命中表 mock 返回） */
  pick(clientX: number, clientY: number): PickResult;
  /** 开始拖拽某零件（进入手动自由移动）；仅散落待装且为下一步序的件可拖 */
  beginDrag(partId: string): boolean;
  /** 拖拽过程中更新零件位置（delta，mm 世界位移）；内部逐帧做实时干涉判定并更新 dragState */
  dragTo(partId: string, delta: Vec3): void;
  /**
   * 结束拖拽，请求实时干涉校验并结算：可落位（贴近 seat 且无干涉）→贴合，
   * 否则回 scatter。返回是否允许落位及其命中。
   */
  endDrag(partId: string): { ok: boolean; hits: InterferenceHit[] };
  /** 读取当前手动拖拽会话的实时状态（供 HUD/断言；引擎内部随会话更新） */
  readonly dragState: DragLiveState;
}

/* ------------------------------------------------------------------ */
/* 装配与干涉控制器（三能力核心，驱动中栏视口）                        */
/* ------------------------------------------------------------------ */

/** 装配控制器 —— auto/manual/replay 三模式（对应 SimEngine 能力 1） */
export interface AssemblyController {
  /** 当前模式（Pinia/组件状态源，勿本地重复存一份造成失配） */
  readonly mode: AssemblyMode;
  /** 已装配零件 id（有序） */
  readonly assembledPartIds: readonly string[];
  /** 当前步骤序号 */
  readonly currentStepSeq: number;
  /** 产线 BOM（单一装配定义源） */
  readonly bom: AssemblyBom | null;

  /** 装载一条产线的 BOM 并复位到初始态（mode 保持，步骤清 0） */
  load(bom: AssemblyBom): void;
  /** 切换装配模式；非法切换（如手动中正拖拽）返回拒绝原因 */
  switchMode(to: AssemblyMode): ModeSwitchResult;
  /** 装配单个零件（auto/replay 由引擎触发；manual 由交互触发），返回是否成功 */
  assemble(partId: string): boolean;
  /** 撤销最近一次装配 */
  undo(): boolean;
  /** 播放/暂停当前装配动画（仅 auto/replay 有效） */
  play(): boolean;
  pause(): boolean;
  /** 跳到指定步骤 */
  seekTo(stepSeq: number): boolean;
  /** 手动模式下通知"零件将移至此位姿"，控制器调用 ClearanceController 做实时校验；
   *  返回 null=可落位，否则返回命中（供 UI 高亮/拦截）。 */
  checkPlacement(partId: string, targetObb: OBB): InterferenceHit[] | null;
}

/** 干涉控制器 —— 实时干涉（对应 SimEngine 能力 2），委托 clearance-core 纯算法 */
export interface ClearanceController {
  /** 装载"已装配集合"（构建静态 BVH），返回零件数 */
  registerAssembled(parts: ReadonlyArray<{ partId: string; obb: OBB }>): number;
  /** 拖拽单件 vs 已装配集合的实时校验；返回命中零件（空=可落位） */
  queryInteractive(moving: { partId: string; obb: OBB }): InterferenceHit[];
  /** 对给定集合跑一次完整自交（离线/出报告），返回领域标准报告（含 hits/耗时/剔除率） */
  runFull(parts: ReadonlyArray<{ partId: string; obb: OBB }>): InterferenceReport;
}

/* ------------------------------------------------------------------ */
/* 顶层门面                                                            */
/* ------------------------------------------------------------------ */

/** SimEngine 门面 —— 业务组件唯一依赖的渲染/仿真入口 */
export interface SimEngine {
  /** 当前渲染后端标识 */
  readonly backend: 'noop' | 'babylon';

  /** 初始化（装载后端 BOM + 挂载视口 + 加载 GLB）；资产失败时拒绝，不做可见盒子降级。 */
  init(opts: { container?: HTMLElement; line: ProductionLine; bom: AssemblyBom }): Promise<EngineHealth>;
  /** 销毁并释放全部资源（切页/卸载时必调，避免泄漏） */
  dispose(): void;
  /** 读取引擎健康快照（顶栏徽标 / 性能监视） */
  health(): EngineHealth;

  readonly scene: SceneManager;
  readonly assets: AssetManager;
  readonly interaction: InteractionManager;
  readonly assembly: AssemblyController;
  readonly clearance: ClearanceController;
  readonly runtime: RuntimeAnimationController;

  /**
   * S1 · 把渲染同步到装配状态机的 `assembledPartIds`：
   * 已贴合件停 seat、其余停散落待料位。业务在每次 `assembly` 状态变更后调用。
   * 返回 {seated, scattered}（Noop 无网格，返回当前占位计数语义的镜像）。
   */
  syncAssemblyState(): { seated: number; scattered: number };

  /**
   * S2 · 装配过程动画（auto/replay）：从当前装配步起，按 BOM 步骤序 +
   * `AssemblyStep.durationSeconds` 逐件播"散落→贴合"过渡直到全贴合。
   * - Babylon：经纯逻辑驱动器每帧推进（scene render loop 消费飞行插值位）；
   * - Noop：镜像计数，供无 WebGL 单测/占位 UI 断言"播放推进到全贴合"。
   * 返回是否成功开始播放。
   */
  playAssembly(): boolean;
  /** S2 · 暂停播放（飞行中零件停在当前插值位；seek/undo 仍走跳变）。 */
  pauseAssembly(): boolean;
  /**
   * S2 · 复位到"全部待装配散落"并停止播放（auto/replay 从头演示前调用）。
   * 返回复位后的 {seated, scattered}（通常 seated=0，除基座外全散落）。
   */
  resetForPlay(): { seated: number; scattered: number };
  /** S2 · 当前装配动画播放状态（供 HUD/断言读取；无驱动时恒不播放） */
  readonly animState: {
    playing: boolean;
    cursorSeq: number;
    totalSteps: number;
    done: boolean;
  };
}

/* 供外部引用的领域形状再导出（组件薄、只在门面口统一 type） */
export type {
  AssemblyMode,
  AssemblyBom,
  AssemblyPart,
  AssemblyStep,
  InterferenceHit,
  InterferenceReport,
  OBB,
  ProductionLine,
  Vec3,
};
