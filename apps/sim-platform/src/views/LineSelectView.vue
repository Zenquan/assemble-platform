<script setup lang="ts">
/**
 * 产线选择页（design 稿页面 A）—— 进入装配工作台前的入口。
 * 数据来自 assembly-svc 产线 + interference-svc 离线预检快照；
 * 卡片纯展示（LineCard），取数聚合在 useLineCatalog，组件保持薄。
 */
import { computed, onMounted, ref } from 'vue';
import AppHeader from '@/components/AppHeader.vue';
import LineCard from '@/components/LineCard.vue';
import { useLineCatalog } from '@/composables/useLineCatalog';

type Filter = 'all' | 'ready' | 'attention';

const filter = ref<Filter>('all');
const { state, readyCount, attentionCount, refresh } = useLineCatalog();

const chips = computed(() => [
  { key: 'all' as const, label: '全部' },
  { key: 'ready' as const, label: '就绪', count: readyCount.value },
  { key: 'attention' as const, label: '待检修', count: attentionCount.value },
]);

const enabledEntriesCount = computed(() => state.lines.filter((e) => e.line.enabled).length);

const shownEntries = computed(() => {
  const enabled = state.lines.filter((e) => e.line.enabled);
  if (filter.value === 'all') return enabled;
  if (filter.value === 'ready') return enabled.filter((e) => e.health === 'ready');
  return enabled.filter((e) => e.health === 'attention');
});

onMounted(() => {
  void refresh();
});
</script>

<template>
  <div class="page">
    <div class="gridbg" aria-hidden="true"></div>
    <div class="shell">
      <AppHeader />

      <div class="body">
        <div class="list-bar">
          <div>
            <div class="title">
              产线列表 <b>/ {{ enabledEntriesCount }} 条</b>
            </div>
            <div class="sub">进入前已离线预检 · 干涉数来自 clearance-core</div>
          </div>
          <div class="chips">
            <button
              v-for="c in chips"
              :key="c.key"
              type="button"
              class="chip"
              :class="{ on: filter === c.key }"
              @click="filter = c.key"
            >
              {{ c.label }}<span v-if="c.count !== undefined" class="cnt">{{ c.count }}</span>
            </button>
          </div>
        </div>

        <!-- 加载态 -->
        <div v-if="state.loading && state.lines.length === 0" class="statebox">
          正在加载产线与预检快照…
        </div>

        <!-- 空态 / 整表失败 -->
        <div v-else-if="shownEntries.length === 0 && !state.loading" class="statebox">
          <template v-if="state.error">{{ state.error }} —— 请确认 assembly-svc(7101) 已启动</template>
          <template v-else>暂无符合筛选的产线</template>
        </div>

        <!-- 产线卡片网格 -->
        <div v-else class="grid">
          <LineCard v-for="e in shownEntries" :key="e.line.id" :entry="e" />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.page {
  min-height: 100vh;
  position: relative;
  background: var(--app-bg);
}
.gridbg {
  position: absolute;
  inset: 0;
  pointer-events: none;
  opacity: 0.5;
  background-image:
    linear-gradient(rgba(31, 111, 235, 0.05) 1px, transparent 1px),
    linear-gradient(90deg, rgba(31, 111, 235, 0.05) 1px, transparent 1px);
  background-size: 34px 34px;
}
.shell {
  position: relative;
  max-width: 1120px;
  margin: 0 auto;
  padding: 22px 20px 60px;
}
.shell > :first-child {
  border: 1px solid var(--line);
  border-radius: 14px;
  overflow: hidden;
  background: var(--bg);
}
.body {
  padding: 20px 22px;
}
.list-bar {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  margin-bottom: 18px;
  flex-wrap: wrap;
  gap: 12px;
}
.title {
  font-size: 15px;
  color: var(--ink);
}
.title b {
  color: var(--cyan);
  font-weight: 500;
}
.sub {
  font-size: 12px;
  color: var(--mute);
  margin-top: 6px;
}
.chips {
  display: flex;
  gap: 8px;
}
.chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: #8aa0bf;
  border: 1px solid #26385a;
  background: #0e1626;
  padding: 6px 12px;
  border-radius: 999px;
}
.chip.on {
  color: #a5f3fc;
  border-color: #22d3ee;
  background: rgba(34, 211, 238, 0.08);
}
.chip .cnt {
  font-family: var(--mono);
  font-size: 10px;
  color: inherit;
  opacity: 0.75;
}
.grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}
@media (max-width: 860px) {
  .grid {
    grid-template-columns: 1fr;
  }
}
.statebox {
  padding: 48px 0;
  text-align: center;
  color: var(--mute);
  font-size: 13px;
}
</style>
