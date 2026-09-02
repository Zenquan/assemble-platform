/**
 * @assemble/clearance-core —— 干涉分析核心算法（Broad Phase BVH + Narrow Phase OBB-SAT）
 *
 * 同一套纯算法被前端 SimEngine（实时交互检测）与后端 interference-svc（离线整线批量预检）
 * 复用，保证前后端判定一致 —— 对应方案 3.3「同算法核心双端复用」架构亮点。
 *
 * 无任何 DOM / Babylon / Node 专属依赖，可在浏览器与 Node 中一致运行，可被 vitest 单测。
 */
export * from './aabb.js';
export * from './bvh.js';
export * from './obbSat.js';
export * from './obb.js';
export * from './detector.js';
