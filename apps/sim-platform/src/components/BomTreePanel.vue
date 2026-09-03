<script setup lang="ts">
/**
 * S4 · BOM 树面板（工作台左栏）
 *
 * 纯展示组件：只收 `BomTreeModel`（已由 bomtree.ts 纯逻辑算好），渲染
 * 「工位 → 零件」两层树 + 每零件装配态标注（✓done / ▸current / ○pending / 基座）。
 * 点击某零件 emit `select(partId)` → 父级调 `engine.scene.frameToPart` 联动视口。
 * 本组件不 import Babylon、不写场景，只发事件。
 */
import type { BomTreeModel } from '@/engine/bomtree';

defineProps<{ model: BomTreeModel | null }>();
const emit = defineEmits<{ (e: 'select', partId: string): void }>();
</script>

<template>
  <div class="bom-tree">
    <template v-if="model">
      <div class="bt-head">
        <span class="bt-title">BOM · 装配树</span>
        <span class="bt-count">{{ model.assembledCount }}/{{ model.totalSteps }} 贴合</span>
      </div>
      <!-- 工位分组（一级节点） -->
      <div v-for="g in model.groups" :key="g.station.id" class="bt-station">
        <div class="bt-station-hd">
          <span class="bt-st-ico">▦</span>
          <span class="bt-st-name">{{ g.station.name }}</span>
          <span class="bt-st-seq">#{{ g.station.seq }}</span>
          <span class="bt-st-takt mono">{{ g.station.taktSeconds.toFixed(1) }}s</span>
        </div>
        <ul class="bt-parts">
          <li
            v-for="p in g.parts"
            :key="p.partId"
            class="bt-part"
            :class="{
              done: p.done && !p.current,
              current: p.current,
              base: p.isBase && !p.current,
            }"
            :title="`${p.name} · 步骤 ${p.stepSeq + 1}${p.current ? '（当前待装配）' : ''}`"
            @click="emit('select', p.partId)"
          >
            <span class="bt-glyph">
              <template v-if="p.current">▸</template>
              <template v-else-if="p.done">✓</template>
              <template v-else>·</template>
            </span>
            <span class="bt-pname">{{ p.name }}</span>
            <span v-if="p.isBase" class="bt-base">基座</span>
          </li>
        </ul>
      </div>
      <div v-if="model.allDone" class="bt-done-banner mono">ALL ASSEMBLED ✓</div>
    </template>
    <div v-else class="bt-empty">… 等待 BOM 装载</div>
  </div>
</template>

<style scoped>
.bom-tree {
  display: flex;
  flex-direction: column;
  gap: 10px;
  overflow-y: auto;
  max-height: calc(100vh - 120px);
}
.bt-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--line-3);
}
.bt-title {
  color: var(--cyan);
  font-size: 11px;
  letter-spacing: 0.12em;
}
.bt-count {
  font-family: var(--mono);
  font-size: 10px;
  color: var(--mute);
}
.bt-station {
  border: 1px solid var(--line-3);
  border-radius: 8px;
  background: rgba(13, 22, 38, 0.55);
  overflow: hidden;
}
.bt-station-hd {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  background: rgba(10, 18, 31, 0.6);
  border-bottom: 1px solid var(--line-3);
}
.bt-st-ico {
  color: var(--blue-2);
  font-size: 11px;
}
.bt-st-name {
  color: var(--ink-2);
  font-size: 11px;
  font-weight: 600;
}
.bt-st-seq {
  color: var(--faint);
  font-size: 9px;
  font-family: var(--mono);
}
.bt-st-takt {
  margin-left: auto;
  color: var(--ghost);
  font-size: 9px;
}
.bt-parts {
  list-style: none;
  margin: 0;
  padding: 4px 6px;
}
.bt-part {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 6px;
  border-radius: 5px;
  cursor: pointer;
  transition: background 0.12s;
  color: var(--ink-3);
  font-size: 11px;
}
.bt-part:hover {
  background: rgba(31, 111, 235, 0.14);
}
.bt-part.done {
  color: var(--ghost);
}
.bt-part.done .bt-glyph {
  color: var(--green);
}
.bt-part.current {
  background: rgba(34, 211, 238, 0.1);
  outline: 1px solid rgba(34, 211, 238, 0.4);
  color: var(--ink);
}
.bt-part.current .bt-glyph {
  color: var(--cyan);
}
.bt-glyph {
  width: 12px;
  text-align: center;
  font-family: var(--mono);
  font-size: 11px;
}
.bt-pname {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.bt-base {
  margin-left: auto;
  font-size: 8px;
  color: var(--amber);
  border: 1px solid rgba(251, 191, 36, 0.35);
  padding: 0 4px;
  border-radius: 3px;
}
.bt-done-banner {
  text-align: center;
  color: var(--green);
  font-size: 10px;
  letter-spacing: 0.2em;
  padding: 6px;
}
.bt-empty {
  color: var(--faint);
  font-size: 11px;
}
</style>
