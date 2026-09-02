/**
 * @assemble/sim-platform · SimEngine 门面 —— 唯一对外入口
 *
 * 用法（业务组件/装配控制器注入）：
 *   import { createSimEngine, type SimEngine } from '@/engine';
 *   const engine = createSimEngine();          // 本轮返回 Noop 测试替身
 *   engine.init({ container: canvasRef.value });
 *
 * 业务代码不得 import '@babylonjs/core'，只能 import 本入口的类型与工厂。
 * 类型契约见 './types.js'；实现见 './noop.js'（替身）。
 */
export { createSimEngine, NoopSimEngine, NoopClearance, NoopAssembler } from './noop.js';
export type {
  SimEngine,
  SceneManager,
  AssetManager,
  InteractionManager,
  AssemblyController,
  ClearanceController,
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
