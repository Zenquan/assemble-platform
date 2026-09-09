<script setup lang="ts">
/**
 * 装配工作台：所选产线、后端 BOM、GLB 装配、BOM 树与动画共享同一数据源。
 *
 * 红线保持：本组件**不 import '@babylonjs/core'**，只经 createSimEngine() 返回的
 * 窄接口。可见装配件只来自 model-svc GLB；加载失败显示错误，不生成可见盒子。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import { fetchLine, fetchLineBom } from '@/api/lines';
import { fetchTaktSimulation } from '@/api/takt';
import { runOfflinePrecheck } from '@/api/interference';
import type { InterferenceHit, InterferenceReport, ProductionLine } from '@assemble/domain';
import { createSimEngine, type SimEngine } from '@/engine';
import { deriveBomTreeState, stationsOf, type BomTreeModel } from '@/engine/bomtree';
import { deriveTaktPanel, type TaktPanelModel } from '@/engine/taktpanel';
import BomTreePanel from '@/components/BomTreePanel.vue';
import InterferencePanel from '@/components/InterferencePanel.vue';
import TaktPanel from '@/components/TaktPanel.vue';

const UI_STATE_POLL_INTERVAL_MS = 120;

const route = useRoute();
const router = useRouter();
const lineId = ref(String(route.params.lineId ?? ''));
const canvasHost = ref<HTMLDivElement | null>(null);
const engine = ref<SimEngine | null>(null);
const line = ref<ProductionLine | null>(null);
const engineState = ref('初始化…');
const backend = ref<'babylon' | 'noop'>('noop');
const isLoading = ref(true);
const stepText = ref('');
const loadError = ref('');
const assembledCount = ref(0);
const totalParts = ref(0);
const animProgress = ref(0); // 动画进度 seq（S2 播放态）
const isAnimPlaying = ref(false);
const animTotal = ref(0);
const runtimeNodeCount = ref(0);
const runtimeMaterialCount = ref(0);
const runtimeCompletedUnits = ref(0);
const runtimeActiveStationCount = ref(0);
const isRuntimePlaying = ref(false);
// S3 · 手动拖拽实时状态（拖拽中零件 / 干涉拦截 / 可落位提示）
const dragText = ref('');
// S4 · BOM 树 + 节拍面板
const bomTree = ref<BomTreeModel | null>(null);
const selectedPartId = ref('');
const taktModel = ref<TaktPanelModel | null>(null);
const taktState = ref<'idle' | 'loading' | 'ready' | 'error'>('idle');
const taktError = ref('');
// C · 干涉处理：离线整线预检报告在装配工作台内可查看/定位/复检
const precheckState = ref<'idle' | 'loading' | 'ok' | 'error'>('idle');
const interferenceReport = ref<InterferenceReport | null>(null);
const precheckError = ref('');
const focusedHitKey = ref('');

const partNameById = computed(() => {
  const bom = engine.value?.assembly.bom;
  const map: Record<string, string> = {};
  for (const part of bom?.parts ?? []) map[part.id] = part.name;
  return map;
});

let unmounted = false;
let loadVersion = 0;

async function loadWorkbench(nextLineId: string) {
  if (!canvasHost.value || unmounted) return;
  const version = ++loadVersion;
  isLoading.value = true;
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
  precheckState.value = 'idle';
  interferenceReport.value = null;
  precheckError.value = '';
  focusedHitKey.value = '';
  assembledCount.value = 0;
  totalParts.value = 0;
  animProgress.value = 0;
  animTotal.value = 0;
  isAnimPlaying.value = false;
  runtimeNodeCount.value = 0;
  runtimeMaterialCount.value = 0;
  runtimeCompletedUnits.value = 0;
  runtimeActiveStationCount.value = 0;
  isRuntimePlaying.value = false;
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
    refreshRuntimeState();
    refreshBomTree();
    stepText.value = eng.backend === 'babylon'
      ? `已加载 ${health.totalParts} 个 GLB 零件 · 手动拖拽下一件装配（滚轮缩放 / 左键旋转）`
      : '当前环境无 WebGL，已回落 Noop 占位；请在浏览器中打开以启用 3D 渲染';
    isLoading.value = false;
    void loadTakt(version, loadedLine);
    void loadInterference(version, nextLineId);
  } catch (e) {
    eng?.dispose();
    if (version !== loadVersion) return;
    engine.value = null;
    engineState.value = '引擎离线';
    isLoading.value = false;
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

function startRuntime() {
  const eng = engine.value;
  if (!eng) return;
  eng.runtime.start();
  refreshRuntimeState();
}

function pauseRuntime() {
  const eng = engine.value;
  if (!eng) return;
  eng.runtime.pause();
  refreshRuntimeState();
}

function resetRuntime() {
  const eng = engine.value;
  if (!eng) return;
  eng.runtime.reset();
  refreshRuntimeState();
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

function refreshRuntimeState() {
  const eng = engine.value;
  if (!eng) return;
  runtimeNodeCount.value = eng.runtime.boundNodeCount;
  runtimeMaterialCount.value = eng.runtime.materialItemCount;
  runtimeCompletedUnits.value = eng.runtime.materialCompletedUnits;
  runtimeActiveStationCount.value = eng.runtime.activeStationIds.length;
  isRuntimePlaying.value = eng.runtime.playing;
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
    if (!unmounted) refreshRuntimeState();
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
  eng.scene.highlightParts([], false);
  focusedHitKey.value = '';
  eng.scene.frameToPart([partId]);
  refreshBomTree();
}

/** 恢复整条真实 GLB 产线的初始化最佳轴测视角。 */
function frameAssembly() {
  const eng = engine.value;
  if (!eng) return;
  eng.scene.highlightParts([], false);
  focusedHitKey.value = '';
  eng.scene.frameToAssembly();
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
    const res = await fetchTaktSimulation({
      lineId: ln.id,
    });
    if (version !== loadVersion) return;
    taktModel.value = deriveTaktPanel(
      { lineId: ln.id },
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

/** C · 拉取/复检该产线的离线整线干涉报告（真实 BOM/GLB 包络）。 */
async function loadInterference(version: number, nextLineId: string): Promise<void> {
  precheckState.value = 'loading';
  precheckError.value = '';
  interferenceReport.value = null;
  try {
    const report = await runOfflinePrecheck(nextLineId);
    if (unmounted || version !== loadVersion) return;
    interferenceReport.value = report;
    precheckState.value = 'ok';
  } catch (e) {
    if (unmounted || version !== loadVersion) return;
    precheckState.value = 'error';
    precheckError.value = e instanceof Error ? e.message : '离线预检服务不可用';
  }
}

/** C · 定位/高亮一组干涉命中零件。 */
function focusInterference(hit: InterferenceHit): void {
  const eng = engine.value;
  if (!eng) return;
  focusedHitKey.value = `${hit.firstPartId}->${hit.secondPartId}`;
  eng.scene.highlightParts([hit.firstPartId, hit.secondPartId], true);
  eng.scene.frameToPart([hit.firstPartId, hit.secondPartId]);
}

/** B-lite · 命中需要调整工位布局 → 去产线配置中心。 */
function openInterferenceConfig(_hit: InterferenceHit): void {
  const ln = line.value;
  if (!ln) return;
  void router.push({
    name: 'line-config',
    query: { lineId: ln.id, mode: 'interference', from: 'workbench' },
  });
}

function recheckInterference(): void {
  void loadInterference(loadVersion, lineId.value);
}
</script>

<template>
  <div class="wb-page">
    <div class="wb-panel">
      <header class="wb-head">
        <img class="wb-logo" src="/logo.png" alt="SIM-PLATFORM" draggable="false" />
        <div>
          <div class="wb-name">产线 {{ line?.name ?? lineId }} · 装配工作台</div>
          <div class="wb-sub">SIMULATION WORKBENCH · 0.4 动态 BOM + GLB 装配</div>
        </div>
        <span class="engline" :class="backend"><i class="dot"></i>{{ engineState }}</span>
        <button class="wb-back" type="button" @click="router.push({ name: 'line-select' })">← 返回产线列表</button>
      </header>

      <div class="wb-body">
        <aside class="left aside-col">
          <BomTreePanel :model="bomTree" @select="selectPart" />
        </aside>
        <div ref="canvasHost" class="viewport">
          <div v-if="isLoading" class="load-overlay" role="status" aria-live="polite">
            <span class="load-ring" aria-hidden="true"></span>
            <span class="load-text">正在加载 GLB 零件…</span>
          </div>
          <div v-else-if="loadError" class="vhint err">{{ loadError }}</div>
          <div v-else-if="backend === 'noop'" class="vhint">{{ stepText }}</div>
          <template v-else>
            <div class="hud-top">STEP&nbsp;·&nbsp;装配视口（BOM 树联动 · 当前步骤高亮）</div>
            <div class="hud-bottom">{{ stepText }}</div>
            <button class="view-reset-btn" type="button" title="定位到初始化最佳视角" aria-label="定位到初始化最佳视角" @click.stop="frameAssembly">
              <span aria-hidden="true">⌖</span> 定位初始视角
            </button>
            <div class="runtimebar">
              <span class="runtime-label">设备运行态 · 物料 {{ runtimeMaterialCount }} 件</span>
              <span class="runtime-count">{{ runtimeNodeCount }} 个运动节点</span>
              <span class="runtime-count">活跃工位 {{ runtimeActiveStationCount }}</span>
              <span class="runtime-count">完成 {{ runtimeCompletedUnits }} 件</span>
              <span class="runtime-status" :class="{ live: isRuntimePlaying }"><i class="dot"></i>{{ isRuntimePlaying ? '运行中' : '已暂停' }}</span>
              <button class="runtime-btn" :disabled="isRuntimePlaying || (runtimeNodeCount === 0 && runtimeMaterialCount === 0)" @click="startRuntime">▶ 启动</button>
              <button class="runtime-btn" :disabled="!isRuntimePlaying" @click="pauseRuntime">⏸ 暂停</button>
              <button class="runtime-btn" :disabled="runtimeNodeCount === 0 && runtimeMaterialCount === 0" @click="resetRuntime">↺ 复位</button>
            </div>
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
          <InterferencePanel
            :report="interferenceReport"
            :state="precheckState"
            :error="precheckError"
            :part-name-by-id="partNameById"
            :active-hit-key="focusedHitKey"
            @select="focusInterference"
            @adjust="openInterferenceConfig"
            @recheck="recheckInterference"
          />
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
  padding: 16px;
  display: flex;
  justify-content: center;
}
.wb-panel {
  width: 100%;
  max-width: 1680px;
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
.wb-logo {
  width: 34px;
  height: 34px;
  flex: none;
  border-radius: 8px;
  background: #fff;
  object-fit: cover;
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
.wb-back {
  font-size: 12px;
  color: #cbd5e1;
  border: 1px solid #2a3a5c;
  background: #111a2e;
  padding: 7px 14px;
  border-radius: 7px;
  white-space: nowrap;
}
.wb-back:hover {
  border-color: var(--blue);
  color: var(--ink);
}
.wb-body {
  display: grid;
  grid-template-columns: minmax(176px, 18vw) minmax(0, 1fr) minmax(208px, 21vw);
  min-height: min(720px, calc(100vh - 112px));
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
  min-height: min(720px, calc(100vh - 112px));
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
.view-reset-btn {
  position: absolute;
  top: 10px;
  right: 12px;
  z-index: 4;
  pointer-events: auto;
  appearance: none;
  cursor: pointer;
  border: 1px solid rgba(94, 234, 212, 0.35);
  background: rgba(10, 20, 32, 0.82);
  color: #99f6e4;
  font-size: 11px;
  padding: 5px 9px;
  border-radius: 6px;
}
.view-reset-btn span {
  margin-right: 3px;
  font-size: 14px;
  line-height: 0;
}
.view-reset-btn:hover {
  border-color: #5eead4;
  background: rgba(20, 45, 55, 0.9);
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
  top: 88px;
  left: 12px;
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  max-width: 96%;
  z-index: 3;
  font-size: 11px;
}
.runtimebar {
  position: absolute;
  top: 46px;
  left: 12px;
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 7px;
  max-width: 96%;
  z-index: 3;
  font-size: 11px;
}
.runtime-label,
.runtime-count,
.runtime-status {
  padding: 5px 9px;
  border-radius: 6px;
  background: rgba(10, 20, 32, 0.72);
  border: 1px solid var(--line-3);
  color: var(--mute);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
.runtime-label {
  color: #fbbf24;
  border-color: rgba(251, 191, 36, 0.35);
}
.runtime-status.live {
  color: #34d399;
  border-color: rgba(52, 211, 153, 0.35);
}
.runtime-status .dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  margin-right: 5px;
  border-radius: 50%;
  background: var(--ghost);
}
.runtime-status.live .dot {
  background: #34d399;
  box-shadow: 0 0 7px rgba(52, 211, 153, 0.75);
}
.runtime-btn {
  appearance: none;
  cursor: pointer;
  border: 1px solid var(--line-3);
  background: rgba(13, 22, 38, 0.75);
  color: var(--ink);
  font-size: 11px;
  padding: 5px 9px;
  border-radius: 6px;
}
.runtime-btn:hover:not(:disabled) {
  border-color: #fbbf24;
  color: #fbbf24;
}
.runtime-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
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
  min-height: min(720px, calc(100vh - 112px));
}
.vhint.err {
  color: var(--red);
}
.load-overlay {
  position: absolute;
  inset: 0;
  z-index: 20;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  background: rgba(10, 20, 32, 0.6);
}
.load-ring {
  width: 42px;
  height: 42px;
  border-radius: 50%;
  border: 3px solid rgba(94, 234, 212, 0.2);
  border-top-color: #5eead4;
  animation: wb-spin 0.9s linear infinite;
}
.load-text {
  color: #99f6e4;
  font-size: 12px;
  letter-spacing: 0.08em;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
@keyframes wb-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 900px) {
  .wb-page {
    padding: 10px;
  }
  .wb-body {
    grid-template-columns: minmax(160px, 1fr) minmax(0, 2fr);
    min-height: 620px;
  }
  .right {
    grid-column: 1 / -1;
    border-left: 0;
    border-top: 1px solid var(--line-3);
  }
  .viewport,
  .vhint {
    min-height: 620px;
  }
}

@media (max-width: 620px) {
  .wb-body {
    display: flex;
    flex-direction: column;
  }
  .left,
  .right {
    max-height: 260px;
  }
  .viewport,
  .vhint {
    min-height: 520px;
  }
}
</style>
