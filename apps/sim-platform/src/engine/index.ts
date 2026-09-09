/**
 * @assemble/sim-platform · SimEngine 门面 —— 唯一对外入口
 *
 * 用法（业务组件/装配控制器注入）：
 *   import { createSimEngine, type SimEngine } from '@/engine';
 *   const engine = createSimEngine();          // WebGL 可用→Babylon；否则 Noop 替身
 *   await engine.init({ container: canvasRef.value, line, bom });
 *
 * 业务代码不得 import '@babylonjs/core'，只能 import 本入口的类型与工厂。
 * 类型契约见 './types.js'；实现见 './noop.js'（替身）与 './babylon.js'（真 WebGL）。
 * 无 WebGL（vitest/jsdom/CI）时 createSimEngine() 自动回落 Noop，单测不启真渲染。
 */
import type { SimEngine } from './types.js';

export { NoopSimEngine, NoopClearance, NoopAssembler } from './noop.js';
export type {
  SimEngine,
  SceneManager,
  AssetManager,
  InteractionManager,
  AssemblyController,
  ClearanceController,
  RuntimeAnimationController,
  EngineHealth,
  CameraPose,
  CameraViewId,
  PickResult,
  SnapProgress,
  ModeSwitchResult,
} from './types.js';
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
} from './types.js';
export { createSimEngine, BabylonSimEngine } from './babylon.js';

/* ------------------------------------------------------------------ */
/* 活跃引擎注册（跨页读取渲染健康快照，供性能页/诊断面板；不改变引擎所有权） */
/* ------------------------------------------------------------------ */

let activeEngine: SimEngine | null = null;

/** 注册/注销当前活跃引擎（工作台 init 后注册、卸载前传 null 注销） */
export function registerActiveEngine(engine: SimEngine | null): void {
  activeEngine = engine;
}

/** 读取当前活跃引擎（无活跃渲染场景时返回 null） */
export function getActiveEngine(): SimEngine | null {
  return activeEngine;
}
