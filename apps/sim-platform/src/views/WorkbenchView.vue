<script setup lang="ts">
/**
 * 装配工作台（design 稿页面 B）—— 本轮占位。
 *
 * 范围说明：0.2.x 前端分两拍 —— 本拍（SimEngine 门面 + 产线选择页）只出
 * 工作台的**框架与视口占位**；下一拍接入 Babylon 真渲染经 SimEngine 门面替换占位。
 *
 * 此处已演示「业务经门面工厂获取引擎、init 挂载容器」的注入方式，
 * 保证红线成立：业务不 import '@babylonjs/core'，只碰 createSimEngine 返回的窄接口。
 */
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';

import { createSimEngine, type SimEngine } from '@/engine';

const route = useRoute();
const lineId = String(route.params.lineId ?? '');
const canvasHost = ref<HTMLDivElement | null>(null);
const engine = ref<SimEngine | null>(null);
const healthText = ref('');

onMounted(() => {
  const eng = createSimEngine();
  engine.value = eng;
  // 视口占位：Noop 渲染 backend 在 host 上落地（本轮不做 WebGL，仅挂容器占位）
  eng.init({ container: canvasHost.value ?? undefined, line: undefined });
  healthText.value = `渲染后端 ${eng.backend} · 装配工作台视口将在 Babylon 接入后激活`;
});

onBeforeUnmount(() => {
  engine.value?.dispose();
  engine.value = null;
});
</script>

<template>
  <div class="wb-page">
    <div class="wb-panel">
      <header class="wb-head">
        <div>
          <div class="wb-name">产线 {{ lineId }} · 装配工作台</div>
          <div class="wb-sub">SIMULATION WORKBENCH</div>
        </div>
        <span class="engline"><i class="dot"></i>引擎 {{ healthText.includes('babylon') ? '实时' : '占位' }}</span>
      </header>

      <div class="wb-body">
        <aside class="left">零件 / BOM（装配工作台待 Babylon 接入后激活）</aside>
        <div ref="canvasHost" class="viewport">
          <div class="vhint">{{ healthText }}</div>
        </div>
        <aside class="right">实时干涉 · 步骤 · 节拍（待接入）</aside>
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
  background: var(--amber);
  box-shadow: 0 0 0 3px rgba(251, 191, 36, 0.15);
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
  display: flex;
  align-items: center;
  justify-content: center;
}
.vhint {
  color: var(--ghost);
  font-size: 13px;
  text-align: center;
  padding: 0 20px;
  line-height: 1.7;
}
</style>
