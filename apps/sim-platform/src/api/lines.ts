/**
 * assembly-svc(7101) 产线接口客户端 —— 类型源自 @assemble/domain，不 any。
 */
import type { ProductionLine } from '@assemble/domain';
import { http } from './http.js';

/** 拉取全部产线（含工位/节拍/启用态），后端信封 ok(data) → data 为 ProductionLine[] */
export async function fetchLines(): Promise<ProductionLine[]> {
  return http.get<ProductionLine[]>('/lines');
}
