<script setup lang="ts">
/**
 * 装配工作台：所选产线、后端 BOM、GLB 装配、BOM 树与动画共享同一数据源。
 *
 * 红线保持：本组件**不 import '@babylonjs/core'**，只经 createSimEngine() 返回的
 * 窄接口。可见装配件只来自 model-svc GLB；加载失败显示错误，不生成可见盒子。
 */
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';

import { fetchLine, fetchLineBom } from '@/api/lines';
import { fetchTaktSimulation } from '@/api/takt';
import type { ProductionLine } from '@assemble/domain';
import { createSimEngine, type SimEngine } from '@/engine';
import { deriveBomTreeState, stationsOf, type BomTreeModel } from '@/engine/bomtree';
import { deriveTaktPanel, recommendTargetPerHour, type TaktPanelModel } from '@/engine/taktpanel';
import BomTreePanel from '@/components/BomTreePanel.vue';
import TaktPanel from '@/components/TaktPanel.vue';

const UI_STATE_POLL_INTERVAL_MS = 120;
const TAKT_DEMO_AVAILABILITY = 0.85;

const route = useRoute();
const lineId = ref(String(route.params.lineId ?? ''));
const canvasHost = ref<HTMLDivElement | null>(null);
const engine = ref<SimEngine | null>(null);
const line = ref<ProductionLine | null>(null);
const engineState = ref('初始化…');
const backend = ref<'babylon' | 'noop'>('noop');
const stepText = ref('');
const loadError = ref('');
const assembledCount = ref(0);
const totalParts = ref(0);
const animProgress = ref(0); // 动画进度 seq（S2 播放态）
const isAnimPlaying = ref(false);
const animTotal = ref(0);
// S3 · 手动拖拽实时状态（拖拽中零件 / 干涉拦截 / 可落位提示）
const dragText = ref('');
// S4 · BOM 树 + 节拍面板
const bomTree = ref<BomTreeModel | null>(null);
const selectedPartId = ref('');
const taktModel = ref<TaktPanelModel | null>(null);
const taktState = ref<'idle' | 'loading' | 'ready' | 'error'>('idle');
const taktError = ref('');

let unmounted = false;
let loadVersion = 0;

async function loadWorkbench(nextLineId: string) {
  if (!canvasHost.value || unmounted) return;
  const version = ++loadVersion;
  lineId.value = nextLineId;
  engine.value?.dispose();
  engine.value = null;
  line.value = null;
  backend.value = 'noop';
  engineState.value = '初始化…';
  stepText.value = '';
  loadError.value = '';
  selectedPartId.value = '';
  dragText.value = '';
  bomTree.value = null;
  taktModel.value = null;
  taktState.value = 'idle';
  taktError.value = '';
  assembledCount.value = 0;
  totalParts.value = 0;
  animProgress.value = 0;
  animTotal.value = 0;
  isAnimPlaying.value = false;
  let eng: SimEngine | null = null;
  try {
    const [loadedLine, bom] = await Promise.all([
      fetchLine(nextLineId),
      fetchLineBom(nextLineId),
    ]);
    if (unmounted || version !== loadVersion) return;
    line.value = loadedLine;
    eng = createSimEngine();
    engine.value = eng;
    backend.value = eng.backend;
    (window as unknown as { __sim?: SimEngine }).__sim = eng;
    const health = await eng.init({ container: canvasHost.value, line: loadedLine, bom });
    if (unmounted || version !== loadVersion) {
      eng.dispose();
      return;
    }
    engineState.value = health.ok
      ? (eng.backend === 'babylon' ? '引擎实时' : '引擎占位(Noop)')
      : '引擎离线';
    const assemblyState = eng.syncAssemblyState();
    assembledCount.value = assemblyState.seated;
    totalParts.value = assemblyState.seated + assemblyState.scattered;
    refreshAnimState();
    refreshBomTree();
    stepText.value = eng.backend === 'babylon'
      ? `已加载 ${health.totalParts} 个 GLB 零件 · 手动拖拽下一件装配（滚轮缩放 / 左键旋转）`
      : '当前环境无 WebGL，已回落 Noop 占位；请在浏览器中打开以启用 3D 渲染';
    void loadTakt(version, loadedLine);
  } catch (e) {
    eng?.dispose();
    if (version !== loadVersion) return;
    engine.value = null;
    engineState.value = '引擎离线';
    loadError.value = e instanceof Error ? e.message : '产线或 GLB 装配加载失败';
  }
}

onMounted(() => {
  void loadWorkbench(String(route.params.lineId ?? ''));
});

watch(
  () => String(route.params.lineId ?? ''),
  (nextLineId) => {
    if (canvasHost.value && nextLineId !== lineId.value) void loadWorkbench(nextLineId);
  },
);

/** S1 · 装配下一件（严格按工艺步骤序），并同步分态渲染 */
function assembleNext() {
  const eng = engine.value;
  if (!eng) return;
  const step = eng.assembly.currentStepSeq;
  const next = eng.assembly.bom?.steps[step];
  if (!next) return;
  if (eng.assembly.assemble(next.partId)) {
    const s = eng.syncAssemblyState();
    assembledCount.value = s.seated;
  }
}

/** S1 · 撤销最近一次装配，把该件放回散落待料位 */
function undoLast() {
  const eng = engine.value;
  if (!eng) return;
  if (eng.assembly.undo()) {
    const s = eng.syncAssemblyState();
    assembledCount.value = s.seated;
  }
}

/** S2 · 复位到全散落（从头演示） */
function resetForPlay() {
  const eng = engine.value;
  if (!eng) return;
  const s = eng.resetForPlay();
  assembledCount.value = s.seated;
  refreshAnimState();
}

/** S2 · 播放装配动画（auto/replay 散落→贴合逐件平滑滑入） */
function playAuto() {
  const eng = engine.value;
  if (!eng) return;
  if (eng.assembly.mode === 'manual') eng.assembly.switchMode('auto');
  eng.playAssembly();
  refreshAnimState();
}

/** S2 · 暂停播放 */
function pauseAuto() {
  const eng = engine.value;
  if (!eng) return;
  eng.pauseAssembly();
  refreshAnimState();
}

/** 刷新动画播放态与已贴合计数（巴比仑后端由 render loop 内部推进，UI 轮询展示） */
function refreshAnimState() {
  const eng = engine.value;
  if (!eng) return;
  const s = eng.animState;
  animProgress.value = s.cursorSeq;
  animTotal.value = s.totalSteps;
  isAnimPlaying.value = s.playing;
  // 只读计数源（assembly 为事实集合），避免每次 syncAssemblyState 重摆场景打断飞行动画
  const seated = eng.assembly.assembledPartIds.length;
  const total = eng.assembly.bom?.parts.length ?? s.totalSteps;
  if (totalParts.value === 0 || total > totalParts.value) totalParts.value = total;
  assembledCount.value = seated;
}

onBeforeUnmount(() => {
  unmounted = true;
  loadVersion += 1;
  window.clearInterval(pollTimer);
  engine.value?.dispose();
  engine.value = null;
});

let pollTimer = 0;
onMounted(() => {
  // 轮询刷新动画进度（播放由引擎 render loop 驱动，Vue 无帧 hook）
  pollTimer = window.setInterval(() => {
    if (!unmounted) refreshAnimState();
    if (!unmounted) refreshDragState();
    if (!unmounted) refreshBomTree();
  }, UI_STATE_POLL_INTERVAL_MS);
});

/** S3 · 读取手动拖拽会话状态并映射为 HUD 文案（引擎内部 pointer 拖拽驱动） */
function refreshDragState() {
  const eng = engine.value;
  if (!eng) return;
  const d = eng.interaction.dragState;
  if (!d.dragging) {
    dragText.value = '';
    return;
  }
  if (d.blocked) {
    dragText.value = `干涉拦截 · 无法贴合（命中 ${d.hitPartId || '已装配件'}）`;
  } else if (d.nearSeat) {
    dragText.value = `拖拽 ${d.partId} · 可贴合`;
  } else {
    dragText.value = `拖拽 ${d.partId} · 移至目标位`;
  }
}

/** S4 · 从引擎装配态 + 产线工位推导 BOM 树视图（轮询只读，不写场景） */
function refreshBomTree() {
  const eng = engine.value;
  const ln = line.value;
  const bom = eng?.assembly.bom;
  if (!eng || !ln || !bom) {
    bomTree.value = null;
    return;
  }
  const model = deriveBomTreeState(bom, stationsOf(ln), {
    assembledIds: eng.assembly.assembledPartIds,
    currentStepSeq: eng.assembly.currentStepSeq,
    selectedPartId: selectedPartId.value || undefined,
  });
  bomTree.value = model;
  totalParts.value = bom.parts.length || totalParts.value;
}

/** S4 · 点选 BOM 树某零件 → 联动视口（frameToPart 聚焦该件包围盒）并记录选中 */
function selectPart(partId: string) {
  selectedPartId.value = partId;
  const eng = engine.value;
  if (!eng) return;
  eng.scene.frameToPart([partId]);
  refreshBomTree();
}

/** S4 · 拉取节拍仿真（一次）：目标产能取瓶颈工位小时速率。 */
async function loadTakt(version: number, ln: ProductionLine) {
  if (ln.stations.length === 0) {
    if (version !== loadVersion) return;
    taktState.value = 'idle';
    return;
  }
  taktState.value = 'loading';
  try {
    const target = recommendTargetPerHour(ln.stations);
    const res = await fetchTaktSimulation({
      lineId: ln.id,
      stations: ln.stations,
      targetUnitsPerHour: target,
      availability: TAKT_DEMO_AVAILABILITY,
    });
    if (version !== loadVersion) return;
    taktModel.value = deriveTaktPanel(
      { lineId: ln.id, targetUnitsPerHour: target, availability: TAKT_DEMO_AVAILABILITY },
      res,
      ln.stations,
    );
    taktState.value = 'ready';
  } catch (e) {
    if (version !== loadVersion) return;
    taktState.value = 'error';
    taktError.value = e instanceof Error ? e.message : '节拍服务不可用';
  }
}
</script>

<template>
  <div class="wb-page">
    <div class="wb-panel">
      <header class="wb-head">
        <div>
          <div class="wb-name">产线 {{ line?.name ?? lineId }} · 装配工作台</div>
          <div class="wb-sub">SIMULATION WORKBENCH · 0.4 动态 BOM + GLB 装配</div>
        </div>
        <span class="engline" :class="backend"><i class="dot"></i>{{ engineState }}</span>
      </header>

      <div class="wb-body">
        <aside class="left aside-col">
          <BomTreePanel :model="bomTree" @select="selectPart" />
        </aside>
        <div ref="canvasHost" class="viewport">
          <div v-if="loadError" class="vhint err">{{ loadError }}</div>
          <div v-else-if="backend === 'noop'" class="vhint">{{ stepText }}</div>
          <template v-else>
            <div class="hud-top">STEP&nbsp;·&nbsp;装配视口（BOM 树联动 · 当前步骤高亮）</div>
            <div class="hud-bottom">{{ stepText }}</div>
            <div class="s1bar">
              <span class="s1count">已贴合 <b>{{ assembledCount }}</b> / {{ totalParts }}</span>
              <span v-if="animTotal > 0" class="s1prog">动画 {{ animProgress }}/{{ animTotal }}{{ isAnimPlaying ? ' · 播放中' : '' }}</span>
              <button class="s1btn" :disabled="assembledCount >= totalParts" @click="assembleNext">装配下一件</button>
              <button class="s1btn" :disabled="assembledCount <= 0" @click="undoLast">撤销装配</button>
              <span class="s1sep"></span>
              <button class="s1btn act" @click="resetForPlay" :disabled="assembledCount <= 0">从头演示</button>
              <button class="s1btn act" :disabled="isAnimPlaying || assembledCount >= totalParts" @click="playAuto">▶ 播放</button>
              <button class="s1btn" :disabled="!isAnimPlaying" @click="pauseAuto">⏸ 暂停</button>
              <span v-if="dragText" class="s3drag" :class="{ bad: dragText.includes('干涉') }">S3 · {{ dragText }}</span>
            </div>
          </template>
        </div>
        <aside class="right aside-col">
          <TaktPanel :model="taktModel" :state="taktState" :error="taktError" />
        </aside>
      </div>
    </div>
  </div>
</template>

<style scoped>
.wb-page {
  min-height: 100vh;
  background: var(--app-bg);
  padding: 20px;
  display: flex;
  justify-content: center;
}
.wb-panel {
  width: 100%;
  max-width: 1180px;
  border: 1px solid var(--line);
  border-radius: 14px;
  background: var(--bg);
  overflow: hidden;
  align-self: flex-start;
}
.wb-head {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px 22px;
  border-bottom: 1px solid var(--line);
  background: rgba(9, 15, 28, 0.6);
}
.wb-name {
  font-size: 14px;
  color: var(--ink);
  font-weight: 500;
}
.wb-sub {
  font-size: 9px;
  letter-spacing: 0.16em;
  color: var(--faint);
  margin-top: 3px;
}
.engline {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: 12px;
  color: #5eead4;
}
.engline .dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}
.engline.babylon .dot {
  background: var(--green);
  box-shadow: 0 0 0 3px rgba(52, 211, 153, 0.18);
}
.engline.noop .dot {
  background: var(--amber);
  box-shadow: 0 0 0 3px rgba(251, 191, 36, 0.16);
}
.wb-body {
  display: grid;
  grid-template-columns: 200px 1fr 240px;
  min-height: 560px;
}
.left,
.right {
  background: var(--bg-2);
  color: var(--faint);
  padding: 12px;
  min-height: 0;
}
.aside-col {
  overflow-y: auto;
  align-self: stretch;
}
.left .muted,
.right .muted {
  color: var(--ghost);
  font-size: 10px;
}
.left {
  border-right: 1px solid var(--line-3);
}
.right {
  border-left: 1px solid var(--line-3);
}
.viewport {
  position: relative;
  background: #0a1420;
  min-height: 560px;
}
.viewport canvas {
  width: 100% !important;
  height: 100% !important;
  display: block;
}
.hud-top,
.hud-bottom {
  position: absolute;
  pointer-events: none;
  z-index: 2;
  color: var(--ink);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.6);
}
.hud-top {
  top: 10px;
  left: 12px;
  font-size: 12px;
  letter-spacing: 0.08em;
  color: #22d3ee;
  padding: 4px 10px;
  background: rgba(10, 20, 32, 0.55);
  border: 1px solid rgba(34, 211, 238, 0.25);
  border-radius: 6px;
}
.hud-bottom {
  bottom: 12px;
  left: 12px;
  right: 12px;
  font-size: 11px;
  color: var(--mute);
}
.s1bar {
  position: absolute;
  top: 46px;
  left: 12px;
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  max-width: 96%;
  z-index: 3;
  font-size: 11px;
}
.s1count {
  color: var(--ink);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  padding: 5px 10px;
  background: rgba(10, 20, 32, 0.6);
  border: 1px solid rgba(52, 211, 153, 0.25);
  border-radius: 6px;
}
.s1count b {
  color: #5eead4;
}
.s1prog {
  color: #fbbf24;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  padding: 5px 10px;
  background: rgba(10, 20, 32, 0.6);
  border: 1px solid rgba(251, 191, 36, 0.3);
  border-radius: 6px;
}
.s3drag {
  color: #34d399;
  font-size: 11px;
  padding: 5px 10px;
  background: rgba(10, 20, 32, 0.7);
  border: 1px solid rgba(52, 211, 153, 0.35);
  border-radius: 6px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
.s3drag.bad {
  color: #f87171;
  border-color: rgba(248, 113, 113, 0.45);
}
.s1sep {
  width: 1px;
  height: 20px;
  background: var(--line-3);
  margin: 0 2px;
}
.s1btn.act {
  border-color: rgba(34, 211, 238, 0.45);
}
.s1btn.act:hover:not(:disabled) {
  background: rgba(34, 211, 238, 0.12);
}
.s1btn.act:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.s1btn {
  appearance: none;
  cursor: pointer;
  border: 1px solid var(--line-3);
  background: rgba(13, 22, 38, 0.75);
  color: var(--ink);
  font-size: 11px;
  padding: 5px 12px;
  border-radius: 6px;
  transition: all 0.15s;
}
.s1btn:hover:not(:disabled) {
  border-color: #22d3ee;
  color: #22d3ee;
}
.s1btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.vhint {
  color: var(--ghost);
  font-size: 13px;
  text-align: center;
  padding: 0 20px;
  line-height: 1.7;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 560px;
}
.vhint.err {
  color: var(--red);
}
</style>
