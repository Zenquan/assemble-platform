<script setup lang="ts">
/**
 * S4 · 节拍面板（工作台右栏）
 *
 * 纯展示组件：收 `TaktPanelModel | null`（由 taktpanel.ts 纯逻辑算好），渲染
 * 瓶颈工位 / 理论 CT / 理论小时产能 / 达产态 + 每工位负荷条（按 loadClass 着色）。
 * 只读展示，不写场景、不发请求；加载/错误态由父级传入状态字符串。
 */
import type { TaktPanelModel } from '@/engine/taktpanel';

defineProps<{
  model: TaktPanelModel | null;
  /** 'loading' | 'error' | 'ready' | 'idle' */
  state: string;
  error?: string;
}>();

/** 负荷条百分比上限（>1 截断到 100%，标注真实 load） */
function barWidth(load: number): string {
  return `${Math.min(100, Math.round(load * 100))}%`;
}
</script>

<template>
  <div class="takt-panel">
    <div class="tp-head">
      <span class="tp-title">节拍 · Takt</span>
      <span class="tp-avail mono" title="OEE 时间开动率">A{{ model?.availability ?? '–' }}</span>
    </div>

    <template v-if="model">
      <div class="tp-summary mono" :class="{ bad: !model.meetsTarget }">{{ model.summary }}</div>

      <div class="tp-grid">
        <div class="tp-cell">
          <span class="tp-k">理论 CT</span>
          <span class="tp-v mono">{{ model.cycleTimeSeconds.toFixed(1) }}s</span>
        </div>
        <div class="tp-cell">
          <span class="tp-k">小时产能</span>
          <span class="tp-v mono">{{ model.theoreticalThroughputPerHour.toFixed(0) }}</span>
        </div>
        <div class="tp-cell">
          <span class="tp-k">目标</span>
          <span class="tp-v mono">{{ model.targetUnitsPerHour }} P/H</span>
        </div>
      </div>

      <div class="tp-bn">
        <span class="tp-k">瓶颈</span>
        <span class="tp-bn-name">{{ model.bottleneckStationName }}</span>
        <span class="tp-bn-takt mono">{{ model.bottleneckTaktSeconds.toFixed(1) }}s</span>
      </div>

      <ul class="tp-loads">
        <li
          v-for="s in model.stationLoads"
          :key="s.stationId"
          class="tp-load"
          :class="s.loadClass"
        >
          <div class="tp-load-row">
            <span class="tp-load-name">{{ s.name }}</span>
            <span v-if="s.isBottleneck" class="tp-badge">瓶颈</span>
            <span class="tp-load-val mono">{{ s.load.toFixed(2) }}</span>
          </div>
          <div class="tp-bar">
            <div class="tp-bar-fill" :style="{ width: barWidth(s.load) }"></div>
          </div>
        </li>
      </ul>
    </template>
    <div v-else class="tp-state">
      <template v-if="state === 'loading'">节拍计算中…</template>
      <template v-else-if="state === 'error'">节拍服务不可用{{ error ? `（${error}）` : '' }}</template>
      <template v-else>等待节拍数据</template>
    </div>
  </div>
</template>

<style scoped>
.takt-panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.tp-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--line-3);
}
.tp-title {
  color: var(--cyan);
  font-size: 11px;
  letter-spacing: 0.12em;
}
.tp-avail {
  font-size: 10px;
  color: var(--mute);
}
.tp-summary {
  font-size: 10px;
  line-height: 1.6;
  color: var(--green);
  padding: 7px 9px;
  border-radius: 6px;
  background: rgba(52, 211, 153, 0.08);
  border: 1px solid rgba(52, 211, 153, 0.22);
}
.tp-summary.bad {
  color: var(--red);
  background: rgba(244, 63, 94, 0.08);
  border-color: rgba(244, 63, 94, 0.28);
}
.tp-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
}
.tp-cell {
  border: 1px solid var(--line-3);
  border-radius: 6px;
  background: rgba(13, 22, 38, 0.5);
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.tp-k {
  color: var(--ghost);
  font-size: 9px;
}
.tp-v {
  color: var(--ink-2);
  font-size: 13px;
}
.tp-bn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 9px;
  border-radius: 6px;
  background: rgba(244, 63, 94, 0.08);
  border: 1px solid rgba(244, 63, 94, 0.25);
}
.tp-bn-name {
  color: var(--ink-2);
  font-size: 11px;
  font-weight: 600;
}
.tp-bn-takt {
  margin-left: auto;
  color: var(--red);
  font-size: 11px;
}
.tp-loads {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.tp-load-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 3px;
}
.tp-load-name {
  color: var(--ink-3);
  font-size: 10px;
}
.tp-badge {
  font-size: 8px;
  color: var(--red);
  border: 1px solid rgba(244, 63, 94, 0.35);
  padding: 0 4px;
  border-radius: 3px;
}
.tp-load-val {
  margin-left: auto;
  color: var(--mute);
  font-size: 10px;
}
.tp-bar {
  height: 5px;
  border-radius: 3px;
  background: var(--line-3);
  overflow: hidden;
}
.tp-bar-fill {
  height: 100%;
  border-radius: 3px;
  background: var(--green);
  transition: width 0.3s;
}
.tp-load.overload .tp-bar-fill {
  background: var(--red);
}
.tp-load.busy .tp-bar-fill {
  background: var(--amber);
}
.tp-state {
  color: var(--faint);
  font-size: 11px;
}
</style>
