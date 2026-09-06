<script setup lang="ts">
/**
 * 干涉处理面板（工作台右栏）
 *
 * 只接收领域报告 + BOM 零件名映射，渲染离线/实时预检命中：
 * - 点击「定位」→ 父级调引擎 frameToParts + highlightParts；
 * - 点击「调整布局」→ 父级跳产线配置中心，命中工位改完保存后回来复检；
 * - 「重新预检」→ 父级重新调 interference-svc。
 * 本组件不 import Babylon、不写场景、不发请求。
 */
import type { InterferenceHit, InterferenceReport } from '@assemble/domain';

export type InterferencePanelState = 'idle' | 'loading' | 'ok' | 'error';

const props = defineProps<{
  report: InterferenceReport | null;
  state: InterferencePanelState;
  error?: string;
  /** BOM 零件 id → 名称（用于把领域 id 翻译成工位/设备可读名） */
  partNameById: Readonly<Record<string, string>>;
  /** 当前已定位命中的稳定 key，用于行选中反馈。 */
  activeHitKey?: string;
}>();

const emit = defineEmits<{
  (e: 'select', hit: InterferenceHit): void;
  (e: 'adjust', hit: InterferenceHit): void;
  (e: 'recheck'): void;
}>();

function nameOf(partId: string): string {
  return props.partNameById[partId] ?? partId;
}

function hitKey(hit: InterferenceHit): string {
  return `${hit.firstPartId}->${hit.secondPartId}`;
}
</script>

<template>
  <section class="ipanel" :class="{ busy: report && report.hitCount > 0 }">
    <header class="ip-head">
      <span class="ip-title">干涉处理 · Interference</span>
      <button
        type="button"
        class="ip-recheck"
        :disabled="state === 'loading'"
        title="重新运行离线整线预检"
        @click="emit('recheck')"
      >
        {{ state === 'loading' ? '预检中…' : '重新预检' }}
      </button>
    </header>

    <template v-if="report">
      <div class="ip-summary" :class="report.hitCount > 0 ? 'bad' : 'good'">
        <template v-if="report.hitCount > 0">
          {{ report.hitCount }} 处干涉待处理 · {{ report.totalPartCount }} 个零件
        </template>
        <template v-else>无干涉 · 预检通过（{{ report.totalPartCount }} 个零件）</template>
      </div>

      <ul v-if="report.hitCount > 0" class="ip-hits">
        <li
          v-for="(hit, index) in report.hits"
          :key="`${hit.firstPartId}-${hit.secondPartId}`"
          class="ip-hit"
          :class="{ on: activeHitKey === hitKey(hit) }"
        >
          <div class="ip-hit-head">
            <span class="ip-hit-no mono">{{ String(index + 1).padStart(2, '0') }}</span>
            <span class="ip-hit-sev">{{ hit.severity === 'error' ? 'ERROR' : 'WARN' }}</span>
          </div>
          <div class="ip-hit-pair" :title="`${hit.firstPartId} ↔ ${hit.secondPartId}`">
            <span class="ip-hit-name">{{ nameOf(hit.firstPartId) }}</span>
            <span class="ip-hit-vs">↔</span>
            <span class="ip-hit-name">{{ nameOf(hit.secondPartId) }}</span>
          </div>
          <div class="ip-hit-actions">
            <button type="button" class="ip-btn" @click="emit('select', hit)">定位</button>
            <button type="button" class="ip-btn alt" @click="emit('adjust', hit)">调整布局</button>
          </div>
        </li>
      </ul>
      <p v-else-if="report.hitCount === 0" class="ip-pass mono">
        已复检通过，可返回产线列表确认健康态
      </p>
    </template>

    <div v-else class="ip-state">
      <template v-if="state === 'loading'">正在运行离线预检…</template>
      <template v-else-if="state === 'error'">预检不可用{{ error ? `（${error}）` : '' }}</template>
      <template v-else>等待预检数据</template>
    </div>
  </section>
</template>

<style scoped>
.ipanel {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 16px;
}
.ip-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--line-3);
}
.ip-title {
  color: var(--cyan);
  font-size: 11px;
  letter-spacing: 0.12em;
}
.ip-recheck,
.ip-btn {
  appearance: none;
  cursor: pointer;
  border: 1px solid var(--line-3);
  background: rgba(13, 22, 38, 0.75);
  color: var(--ink-2);
  border-radius: 5px;
  font-size: 10px;
  padding: 4px 8px;
}
.ip-recheck:hover:not(:disabled),
.ip-btn:hover {
  border-color: var(--cyan);
  color: var(--cyan);
}
.ip-recheck:disabled {
  opacity: 0.45;
  cursor: wait;
}
.ip-summary {
  font-size: 10px;
  line-height: 1.6;
  padding: 7px 9px;
  border-radius: 6px;
}
.ip-summary.good {
  color: var(--green);
  background: rgba(52, 211, 153, 0.08);
  border: 1px solid rgba(52, 211, 153, 0.22);
}
.ip-summary.bad {
  color: var(--red);
  background: rgba(244, 63, 94, 0.08);
  border: 1px solid rgba(244, 63, 94, 0.28);
}
.ip-hits {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 7px;
  max-height: 320px;
  overflow-y: auto;
}
.ip-hit {
  border: 1px solid rgba(244, 63, 94, 0.28);
  border-radius: 7px;
  background: rgba(13, 22, 38, 0.6);
  padding: 7px 9px;
  transition: background 0.12s, border-color 0.12s;
}
.ip-hit.on {
  border-color: var(--red);
  background: rgba(244, 63, 94, 0.16);
}
.ip-hit-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 5px;
}
.ip-hit-no {
  color: var(--ghost);
  font-size: 9px;
}
.ip-hit-sev {
  color: var(--red);
  font-size: 8px;
  letter-spacing: 0.12em;
}
.ip-hit-pair {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 10px;
  color: var(--ink);
  min-width: 0;
}
.ip-hit-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ip-hit-vs {
  color: var(--red);
  flex: none;
}
.ip-hit-actions {
  display: flex;
  gap: 6px;
  margin-top: 7px;
}
.ip-btn.alt {
  border-color: rgba(251, 191, 36, 0.35);
  color: var(--amber);
}
.ip-btn.alt:hover {
  border-color: var(--amber);
  color: var(--amber);
}
.ip-pass {
  color: var(--green);
  font-size: 10px;
  margin: 0;
}
.ip-state {
  color: var(--ghost);
  font-size: 11px;
}
</style>
