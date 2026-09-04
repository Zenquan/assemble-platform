<script setup lang="ts">
/**
 * 产线卡片 —— 产线选择页核心展示单元（复刻 design 稿 B1/B2 卡片）。
 * 输入：一条产线的目录态（含离线预检快照），纯展示 + 路由跳转，无取数逻辑。
 */
import { computed } from 'vue';
import { useRouter } from 'vue-router';

import type { InterferenceReport } from '@assemble/domain';
import type { LineCatalogEntry } from '@/composables/useLineCatalog';

const props = defineProps<{ entry: LineCatalogEntry }>();
const router = useRouter();

/** 缩写代号：取 kind 首个词元大写，如 sorting->SORT / fresh-cut->FC */
const code = computed(() => {
  const segs = props.entry.line.kind.split('-');
  return segs.map((s) => s.slice(0, 1).toUpperCase()).join('');
});

/** 状态徽标文案与色 */
const badge = computed(() => {
  const h = props.entry.health;
  if (h === 'disabled') return { text: '停用', tone: 'mute', cls: 'mute' };
  if (props.entry.status === 'loading') return { text: '预检中…', tone: 'amber', cls: 'amber' };
  if (props.entry.status === 'error') return { text: '预检异常', tone: 'amber', cls: 'amber' };
  const hit = props.entry.report?.hitCount;
  if (props.entry.status === 'idle') return { text: '待预检', tone: 'amber', cls: 'amber' };
  if (h === 'ready' || hit === 0) return { text: '就绪 · 无干涉', tone: 'green', cls: 'green' };
  return { text: `待检修 · ${hit ?? '—'} 干涉`, tone: 'amber', cls: 'amber' };
});

const report = computed<InterferenceReport | null>(() =>
  props.entry.status === 'ok' ? props.entry.report : null,
);
/** 零部件数只展示后端预检报告，未返回时保持加载态。 */
const partCount = computed(() => report.value?.totalPartCount ?? null);
const interference = computed(() => report.value?.hitCount ?? null);
const elapsedMs = computed(() => report.value?.elapsedMs ?? null);
/** 节拍 = 工位最大理论节拍（作为产线标准节拍展示，源自 Station.taktSeconds） */
const maxTakt = computed(() =>
  props.entry.line.stations.reduce((m, s) => Math.max(m, s.taktSeconds), 0),
);
/** 就绪/可进入 */
const canEnter = computed(() => props.entry.health === 'ready');

function onPrimary(): void {
  if (props.entry.health === 'disabled') return;
  if (canEnter.value) {
    void router.push({ name: 'workbench', params: { lineId: props.entry.line.id } });
  }
  // health=attention 时本轮仅提示，处理干涉入口留待装配工作台
}
</script>

<template>
  <article class="card" :class="entry.health === 'disabled' ? 'is-disabled' : ''">
    <div class="card-head">
      <div class="thumb">{{ code }}</div>
      <div class="meta">
        <div class="badge-row" :class="badge.cls">
          <i class="dot"></i>{{ badge.text }}
        </div>
        <div class="name">{{ entry.line.name }}</div>
        <div class="desc">{{ entry.line.stations.length }} 工位 · 标准节拍 {{ maxTakt.toFixed(1) }}s</div>
      </div>
    </div>

    <div class="card-body">
      <div class="kpis">
        <div class="kpi">
          <div class="lb"><i class="ic"></i>零部件</div>
          <div class="num mono">{{ partCount ?? '—' }}</div>
        </div>
        <div class="kpi" :class="interference !== null && interference > 0 ? 'danger' : 'good'">
          <div class="lb"><i class="ic"></i>干涉预检</div>
          <div class="num mono">
            <template v-if="entry.status === 'loading'">…</template>
            <template v-else>{{ interference ?? '—' }}</template>
          </div>
        </div>
        <div class="kpi">
          <div class="lb"><i class="ic"></i>预检耗时</div>
          <div class="num mono">
            <template v-if="elapsedMs !== null">{{ Math.round(elapsedMs) }}<small> ms</small></template>
            <template v-else>—</template>
          </div>
        </div>
      </div>
    </div>

    <footer class="card-foot">
      <span class="link" title="详情（规划中）">查看详情</span>
      <button
        class="cta"
        type="button"
        :disabled="entry.health === 'disabled'"
        @click="onPrimary"
      >
        {{ canEnter ? '进入装配工作台 →' : entry.health === 'attention' ? '处理干涉 →' : '停用不可进入' }}
      </button>
    </footer>
  </article>
</template>

<style scoped>
.card {
  border: 1px solid var(--line-2);
  border-radius: 12px;
  background: var(--bg-3);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.card.is-disabled {
  opacity: 0.55;
}
.card-head {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  border-bottom: 1px solid #1b2942;
}
.thumb {
  width: 52px;
  height: 44px;
  border-radius: 8px;
  background: linear-gradient(180deg, #14233f, #0c1424);
  border: 1px solid #263a5e;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  letter-spacing: 0.04em;
  color: #5b7bb0;
  font-weight: 600;
}
.meta {
  min-width: 0;
}
.badge-row {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: 12px;
}
.badge-row .dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}
.badge-row.green {
  color: #5eead4;
}
.badge-row.green .dot {
  background: var(--green);
  box-shadow: 0 0 0 3px rgba(52, 211, 153, 0.15);
}
.badge-row.amber {
  color: var(--amber);
}
.badge-row.amber .dot {
  background: var(--amber);
  box-shadow: 0 0 0 3px rgba(251, 191, 36, 0.15);
}
.badge-row.mute {
  color: var(--mute);
}
.badge-row.mute .dot {
  background: var(--ghost);
}
.name {
  font-size: 14px;
  color: var(--ink);
  margin-top: 4px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.desc {
  font-size: 11px;
  color: var(--mute);
  margin-top: 2px;
}
.card-body {
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.kpis {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}
.kpi .lb {
  font-size: 11px;
  color: var(--mute);
  display: flex;
  align-items: center;
  gap: 6px;
}
.kpi .lb .ic {
  width: 6px;
  height: 6px;
  border-radius: 2px;
  background: var(--blue);
}
.kpi.good .lb .ic {
  background: var(--green);
}
.kpi.danger .lb .ic {
  background: var(--red);
}
.kpi .num {
  font-family: var(--mono);
  font-size: 19px;
  color: #dbeafe;
  margin-top: 6px;
  letter-spacing: 0.02em;
  font-variant-numeric: tabular-nums;
}
.kpi .num small {
  font-size: 10px;
  color: var(--mute);
}
.kpi.danger .num {
  color: #fda4af;
}
.kpi.good .num {
  color: #86efac;
}
.track {
  margin-top: 2px;
  height: 3px;
  border-radius: 2px;
  background: #1c2c4a;
  overflow: hidden;
}
.fill {
  display: block;
  height: 100%;
  background: var(--grad);
  border-radius: 2px;
}
.card-foot {
  margin-top: auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-top: 1px solid #1b2942;
}
.link {
  font-size: 12px;
  color: var(--cyan);
  cursor: pointer;
}
.cta {
  font-size: 12px;
  color: #04121f;
  background: var(--grad);
  padding: 8px 14px;
  border-radius: 7px;
  font-weight: 500;
  border: none;
}
.cta:disabled {
  background: #223352;
  color: var(--mute);
  cursor: not-allowed;
}
</style>
