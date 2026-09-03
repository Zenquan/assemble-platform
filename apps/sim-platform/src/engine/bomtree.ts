/**
 * S4 · BOM 树 —— 纯逻辑：把 BOM 零件/步骤按工位归组成「树 + 装配态」视图模型。
 *
 * 架构红线延续 S1/S2/S3：本模块**无 Babylon / DOM**，只消费 @assemble/domain 的
 * 值类型，产出 UI 无关的可测模型 —— 让 BOM 树的分组与状态标注可被 vitest 锁定。
 *
 * 语义（对齐 FEAT-20260903-003 S4 / 任务 #38）：
 *   侧栏「BOM 树」= 以产线 stations 为一级节点，按 AssemblyStep.stationId 把 BOM
 *   零件归到后端声明的所属工位；每行标注该零件在装配工艺序里的状态：
 *     - done     已完成贴合（stepSeq < currentStepSeq 或已入 assembledPartIds）
 *     - current  当前待装配步骤（stepSeq === currentStepSeq，工艺"下一步"）
 *     - pending  尚未轮到
 *   不存在的工位或零件视为无效步骤并跳过，不做位置猜测。选中零件供联动视口。
 */

import type { AssemblyBom, ProductionLine, Station } from '@assemble/domain';

/** 一行零件（BOM 树叶子）的状态标注 */
export interface BomPartRow {
  partId: string;
  /** 显示名（缺省回退到 id 末段） */
  name: string;
  /** 在装配工艺里的步骤序（0 起点） */
  stepSeq: number;
  /** 是否基座（isMovable=false 锚点件） */
  isBase: boolean;
  /** 是否可动装配件 */
  isMovable: boolean;
  /** 已完成贴合（该 step 已装配） */
  done: boolean;
  /** 是否当前待装配步骤（工艺"下一步"） */
  current: boolean;
}

/** 一个工位下的零件分组（BOM 树一级节点） */
export interface StationBomGroup {
  station: Station;
  /** 归到本工位的零件（按其工艺 stepSeq 升序） */
  parts: BomPartRow[];
  /** 该工位已完成的零件数（供进度小条） */
  doneCount: number;
}

/** BOM 树的完整视图模型（含装配态快照，供组件一次消费） */
export interface BomTreeModel {
  lineId: string;
  /** 树的一级节点（按产线 stations 原始顺序） */
  groups: StationBomGroup[];
  totalSteps: number;
  assembledCount: number;
  /** 当前工艺步骤序（用于顶部"下一步"提示） */
  currentStepSeq: number;
  /** 是否全部装配完成 */
  allDone: boolean;
  /** 当前选中零件（联动视口定位；可为空） */
  selectedPartId?: string;
}

/**
 * 把 BOM 的装配步骤确定性归到各工位。
 * 纯函数：同一 (bom, stations) 恒同输出（可快照单测）。
 *
 * 遍历 steps（工艺顺序），以 step.stationId 解析明确工位；
 * 每个 step 对应的零件从 bom.parts 解析，落到后端声明的工位。
 * 返回按工位原始顺序、工位内按 stepSeq 升序的结构。
 */
export function groupStepsByStation(
  bom: AssemblyBom,
  stations: readonly Station[],
): Array<{ station: Station; step: (typeof bom.steps)[number] }> {
  const byPart = new Map(bom.parts.map((p) => [p.id, p] as const));
  const byStation = new Map(stations.map((station) => [station.id, station] as const));
  const out: Array<{ station: Station; step: (typeof bom.steps)[number] }> = [];
  bom.steps.forEach((step) => {
    if (!byPart.has(step.partId)) return;
    const station = byStation.get(step.stationId);
    if (!station) return;
    out.push({ station, step });
  });
  // 组内按工艺 seq 稳定升序（本就按 seq 遍历，此处显式保证排序语义可测）
  return out.sort(
    (a, b) =>
      a.station.seq - b.station.seq ||
      a.step.seq - b.step.seq,
  );
}

/**
 * 从 BOM + 产线工位 + 装配态推导「BOM 树 + 状态标注」的视图模型。
 * 供侧栏 BOM 树面板一次消费；引擎无关、可单测。
 *
 * @param bom 产线 BOM（Engine.assembly.bom）
 * @param stations 产线工位（ProductionLine.stations）
 * @param state { assembledIds, currentStepSeq, selectedPartId? }
 */
export function deriveBomTreeState(
  bom: AssemblyBom,
  stations: readonly Station[],
  state: {
    assembledIds: ReadonlySet<string> | readonly string[];
    currentStepSeq: number;
    selectedPartId?: string;
  },
): BomTreeModel {
  const assembled = new Set(state.assembledIds);
  const cur = state.currentStepSeq;
  const assigned = groupStepsByStation(bom, stations);

  // 以工位 id 聚合行；工位内按 stepSeq 升序
  const groupsMap = new Map<string, StationBomGroup>();
  for (const st of stations) {
    groupsMap.set(st.id, { station: st, parts: [], doneCount: 0 });
  }
  for (const { station, step } of assigned) {
    const part = bom.parts.find((p) => p.id === step.partId);
    if (!part) continue;
    const done = assembled.has(part.id) || step.seq < cur;
    const isCurrent = step.seq === cur;
    const row: BomPartRow = {
      partId: part.id,
      name: part.name || part.id.split('-').pop() || part.id,
      stepSeq: step.seq,
      isBase: !part.isMovable,
      isMovable: part.isMovable,
      done,
      current: isCurrent,
    };
    const g = groupsMap.get(station.id)!;
    g.parts.push(row);
    if (done) g.doneCount += 1;
  }
  // 工位内按 stepSeq 升序（assigned 已按组排，此处兜底稳定排序）
  for (const g of groupsMap.values()) {
    g.parts.sort((a, b) => a.stepSeq - b.stepSeq);
  }

  const groups = stations
    .map((st) => groupsMap.get(st.id))
    .filter((g): g is StationBomGroup => !!g && g.parts.length > 0);

  const totalSteps = bom.steps.length;
  const assembledCount = assembled.size;

  return {
    lineId: bom.lineId,
    groups,
    totalSteps,
    assembledCount,
    currentStepSeq: cur,
    allDone: cur >= totalSteps,
    ...(state.selectedPartId ? { selectedPartId: state.selectedPartId } : {}),
  };
}

/** 便捷别名：直接从产线抽取工位（含空线兜底），供 Workbench 传参语义清晰 */
export function stationsOf(line: ProductionLine): readonly Station[] {
  return line.stations;
}
