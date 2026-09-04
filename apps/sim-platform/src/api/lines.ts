/**
 * assembly-svc(7101) 产线接口客户端 —— 类型源自 @assemble/domain，不 any。
 */
import type { AssemblyBom, ProductionLine } from '@assemble/domain';
import { http } from './http.js';

/** 拉取全部产线（含工位/节拍/启用态），后端信封 ok(data) → data 为 ProductionLine[] */
export async function fetchLines(): Promise<ProductionLine[]> {
  return http.get<ProductionLine[]>('/lines');
}

/** 拉取单条产线详情（工作台进入时取所选产线，供引擎真渲染用） */
export async function fetchLine(id: string): Promise<ProductionLine> {
  return http.get<ProductionLine>(`/lines/${encodeURIComponent(id)}`);
}

/** 获取所选流水线的真实装配 BOM；零件、步骤与工位归属由 assembly-svc 决定。 */
export async function fetchLineBom(id: string): Promise<AssemblyBom> {
  return http.get<AssemblyBom>(`/lines/${encodeURIComponent(id)}/bom`);
}

export type LineWriteInput = Omit<ProductionLine, 'createdAt' | 'updatedAt'>;

/** 保存一条产线配置；BOM 会由 assembly-svc 按最新工位配置重新生成。 */
export async function updateLine(id: string, input: Partial<LineWriteInput>): Promise<ProductionLine> {
  return http.patch<ProductionLine>(`/lines/${encodeURIComponent(id)}`, input);
}

/** 创建一条产线配置。 */
export async function createLine(input: LineWriteInput): Promise<ProductionLine> {
  return http.post<ProductionLine>('/lines', input);
}
