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
  } else {
    stepText.value = '当前环境无 WebGL，已回落 Noop 占位；请在浏览器中打开以启用 3D 渲染';
  }
});

onBeforeUnmount(() => {
  unmounted = true;
  engine.value?.dispose();
  engine.value = null;
});
</script>

<template>
  <div class="wb-page">
    <div class="wb-panel">
      <header class="wb-head">
        <div>
          <div class="wb-name">产线 {{ line?.name ?? lineId }} · 装配工作台</div>
          <div class="wb-sub">SIMULATION WORKBENCH</div>
        </div>
        <span class="engline" :class="backend"><i class="dot"></i>{{ engineState }}</span>
      </header>

      <div class="wb-body">
        <aside class="left">零件 / BOM · 3D 视口（0.2 真渲染）<br><span class="muted">三模式装配与 BOM 树归 0.3.x</span></aside>
        <div ref="canvasHost" class="viewport">
          <div v-if="loadError" class="vhint err">{{ loadError }}</div>
          <div v-else-if="backend === 'noop'" class="vhint">{{ stepText }}</div>
          <template v-else>
            <div class="hud-top">STEP&nbsp;·&nbsp;3D 装配视口</div>
            <div class="hud-bottom">{{ stepText }}</div>
          </template>
        </div>
        <aside class="right">实时干涉 · 步骤 · 节拍<br><span class="muted">实时联动归 0.3.x</span></aside>
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
