<script setup lang="ts">
/**
 * 装配工作台（design 稿页面 B）—— 0.2.0 出口：Babylon 最小真渲染。
 *
 * 0.2.0 范围（FEAT-20260903-002，grill-me 确认「最小真渲染」）：
 *   - 视口由真 Babylon（经 SimEngine 门面工厂取到）挂 WebGL canvas；
 *   - 真拉取所选产线(/lines/:id)，引擎把其零件按确定性布局渲成 OBB 盒体占位
 *     + 网格/坐标轴 + ArcRotateCamera（可旋转缩放），HUD 显示产线名与引擎实时。
 *   - 不做（归 0.3.x）：三模式真装配 / 实时干涉拖拽 / BOM 树 / 节拍面板。
 *
 * 红线保持：本组件**不 import '@babylonjs/core'**，只经 createSimEngine() 返回的
 * 窄接口（SimEngine/EngineHealth）。WebGL 不可用（无头/预览降级）时工厂回落
 * Noop，视口显示占位说明，不报错。
 */
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';

import { fetchLine } from '@/api/lines';
import type { ProductionLine } from '@assemble/domain';
import { createSimEngine, type SimEngine } from '@/engine';

const route = useRoute();
const lineId = String(route.params.lineId ?? '');
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

let unmounted = false;

onMounted(async () => {
  if (!canvasHost.value || unmounted) return;
  try {
    line.value = await fetchLine(lineId);
  } catch (e) {
    loadError.value = e instanceof Error ? e.message : '产线加载失败';
    return;
  }
  if (unmounted) return;
  const eng = createSimEngine();
  engine.value = eng;
  backend.value = eng.backend;
  const health = eng.init({ container: canvasHost.value, line: line.value ?? undefined });
  engineState.value = health.ok
    ? (eng.backend === 'babylon' ? '引擎实时' : '引擎占位(Noop)')
    : '引擎离线';
  if (eng.backend === 'babylon') {
    // 真 WebGL：引擎内 loadLine 已把零件盒体建入场景
    stepText.value = `已加载 ${health.totalParts} 个零件 · STEP 视角（滚轮缩放 / 左键旋转）`;
    // S1：等引擎完成 BOM 装载与首帧后刷新分态计数
    window.setTimeout(() => {
      const s = eng.syncAssemblyState();
      assembledCount.value = s.seated;
      totalParts.value = s.seated + s.scattered;
    }, 120);
  } else {
    stepText.value = '当前环境无 WebGL，已回落 Noop 占位；请在浏览器中打开以启用 3D 渲染';
  }
});

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
  window.clearInterval(pollTimer);
  engine.value?.dispose();
  engine.value = null;
});

let pollTimer = 0;
onMounted(() => {
  // 轮询刷新动画进度（播放由引擎 render loop 驱动，Vue 无帧 hook）
  pollTimer = window.setInterval(() => {
    if (!unmounted) refreshAnimState();
  }, 120);
});
</script>

<template>
  <div class="wb-page">
    <div class="wb-panel">
      <header class="wb-head">
        <div>
          <div class="wb-name">产线 {{ line?.name ?? lineId }} · 装配工作台</div>
          <div class="wb-sub">SIMULATION WORKBENCH · 0.3 过程动画(S2)</div>
        </div>
        <span class="engline" :class="backend"><i class="dot"></i>{{ engineState }}</span>
      </header>

      <div class="wb-body">
        <aside class="left">零件 / BOM · 3D 视口（S2 过程动画）<br><span class="muted">已贴合(青)/待装配(琥珀散落)；播放时散落件平滑滑入贴合位</span></aside>
        <div ref="canvasHost" class="viewport">
          <div v-if="loadError" class="vhint err">{{ loadError }}</div>
          <div v-else-if="backend === 'noop'" class="vhint">{{ stepText }}</div>
          <template v-else>
            <div class="hud-top">STEP&nbsp;·&nbsp;装配视口（S2 过程动画）</div>
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
            </div>
          </template>
        </div>
        <aside class="right">S2 · 装配过程动画<br><span class="muted">从头演示→播放：零件沿步骤序从散落位平滑滑入贴合位；暂停停当前件；撤销/复位仍瞬时跳变</span></aside>
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
  font-size: 11px;
  color: var(--faint);
  padding: 14px;
  letter-spacing: 0.04em;
  line-height: 1.8;
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
