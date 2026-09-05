/**
 * 产线目录组合式逻辑 —— 产线选择页数据源。
 *
 * 职责：拉产线(assembly-svc) + 逐条启用产线跑离线预检(interference-svc)，
 * 聚合成「卡片展示态」（含就绪/待检修派生、装载中/失败态）。
 * 组件保持薄，仅渲染本对象；逻辑可被单测。
 *
 * 状态语义（sim-platform-design.md）：
 *   - 就绪：hitCount === 0（绿）
 *   - 待检修：hitCount > 0（琥珀/红告警数字），CTA 引导「处理干涉」
 *   - 失败：后端不可达或预检出错（琥珀灰，提示重试）
 */
import { computed, reactive } from 'vue';

import type { ProductionLine, InterferenceReport } from '@assemble/domain';
import { runOfflinePrecheck } from '@/api/interference';
import { fetchLines } from '@/api/lines';

export type PrecheckStatus = 'idle' | 'loading' | 'ok' | 'error';

export interface LineCatalogEntry {
  line: ProductionLine;
  status: PrecheckStatus;
  /** 离线预检报告（status=ok 后非空） */
  report: InterferenceReport | null;
  /** 派生健康态：就绪 / 待检修 / 不可用（停用线不进入工作台） */
  health: 'ready' | 'attention' | 'disabled';
  errorMessage?: string;
}

export interface LineCatalogState {
  loading: boolean;
  lines: LineCatalogEntry[];
  /** 整表加载失败时的错误描述（列表为空时展示） */
  error?: string;
}

/**
 * 派生产线健康态（纯函数，便于单测锁定语义）：
 *   - 停用线 → disabled
 *   - 预检命中 0 → ready（就绪绿）
 *   - 预检命中 > 0 → attention（待检修，干涉告警红）
 *   - 未成功预检（loading/error/idle）默认 ready，不阻塞进入
 */
export function deriveHealth(
  enabled: boolean,
  status: PrecheckStatus,
  hitCount: number | null,
): LineCatalogEntry['health'] {
  if (!enabled) return 'disabled';
  if (status === 'ok' && hitCount !== null && hitCount > 0) return 'attention';
  return 'ready';
}

export function useLineCatalog() {
  const state = reactive<LineCatalogState>({ loading: false, lines: [] });

  const enabledEntries = computed(() => state.lines.filter((e) => e.line.enabled));
  const readyCount = computed(() => enabledEntries.value.filter((e) => e.health === 'ready').length);
  const attentionCount = computed(() => enabledEntries.value.filter((e) => e.health === 'attention').length);

  async function refresh(): Promise<void> {
    state.loading = true;
    try {
      const lines = await fetchLines();
      state.lines = lines.map((line) => ({
        line,
        status: 'idle',
        report: null,
        health: deriveHealth(line.enabled, 'idle', null),
      }));
    } catch (err) {
      state.lines = [];
      state.error = err instanceof Error ? err.message : '产线加载失败';
      return;
    } finally {
      state.loading = false;
    }
    // 已载列表后再逐条预检（启用线）
    await Promise.all(state.lines.filter((e) => e.line.enabled).map(precheckOne));
  }

  async function precheckOne(entry: LineCatalogEntry): Promise<void> {
    entry.status = 'loading';
    try {
      const report = await runOfflinePrecheck(entry.line.id);
      entry.report = report;
      entry.status = 'ok';
      entry.health = deriveHealth(entry.line.enabled, 'ok', report.hitCount);
    } catch (err) {
      entry.status = 'error';
      entry.errorMessage = err instanceof Error ? err.message : '预检失败';
      entry.health = deriveHealth(entry.line.enabled, 'error', null);
    }
  }

  return { state, enabledEntries, readyCount, attentionCount, refresh };
}
