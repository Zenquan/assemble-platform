<script setup lang="ts">
/**
 * 性能监视页（/perf）—— 集中查看前端/渲染侧实时性能数据。
 *
 * 数据源（两条独立通道，均本地实时、不依赖 gateway 在线）：
 *   1. 渲染侧：`getActiveEngine().health()`（SimEngine 门面快照）——
 *      引擎 fps / draw call / 活动网格 / 顶点数，500ms 轮询刷新；
 *   2. 前端侧：`getSimMonitor().subscribe()`（SimMonitor 实时订阅）——
 *      页面帧率 / JS 堆内存 / Web Vitals（LCP·CLS·FID），采样窗口到期即刷新；
 *   3. 上报状态：`getSimMonitor().stats` —— enqueued/flushed/dropped/batches。
 * telemetry 聚合需本地另起 gateway（见 vite.config 注释），页面实时数据不依赖它。
 */
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import AppHeader from '@/components/AppHeader.vue';
import { getActiveEngine, type EngineHealth } from '@/engine';
import { getSimMonitor, type SimMonitorSnapshot, type SimMonitorStats } from '@/monitor';

const router = useRouter();

const monitor = getSimMonitor();
const emptySnapshot: SimMonitorSnapshot = {
  fps: 0,
  fpsAvg: 0,
  jsHeapUsed: 0,
  jsHeapUsedAvg: 0,
  jsHeapTotal: 0,
  jsHeapTotalAvg: 0,
  lcp: 0,
  cls: 0,
  fid: 0,
};

const monSnapshot = ref<SimMonitorSnapshot>(monitor?.snapshot ?? emptySnapshot);
const monStats = ref<SimMonitorStats | null>(monitor?.stats ?? null);
const engineHealth = ref<EngineHealth | null>(null);

let unsubscribe: (() => void) | null = null;
let pollTimer = 0;

function refreshEngine(): void {
  engineHealth.value = getActiveEngine()?.health() ?? null;
}

onMounted(() => {
  unsubscribe =
    monitor?.subscribe((snapshot) => {
      monSnapshot.value = snapshot;
      monStats.value = monitor.stats;
    }) ?? null;
  refreshEngine();
  pollTimer = window.setInterval(() => {
    refreshEngine();
    if (monitor) monStats.value = monitor.stats;
  }, 500);
});

onBeforeUnmount(() => {
  unsubscribe?.();
  window.clearInterval(pollTimer);
});

/* ---------------- 格式化 ---------------- */
function fmtFps(fps: number): string {
  return fps > 0 ? fps.toFixed(1) : '0.0';
}
function frameMs(fps: number): string {
  return fps > 0 ? (1000 / fps).toFixed(1) : '—';
}
function mb(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(1);
}
function fmtCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}
/** FPS 健康色：>=55 绿 / 30~55 琥珀 / <30 红（对齐 docs 阈值 FPS<30 告警） */
function fpsTone(fps: number): 'good' | 'warn' | 'bad' {
  if (fps >= 55) return 'good';
  if (fps >= 30) return 'warn';
  return 'bad';
}
</script>

<template>
  <div class="page">
    <div class="gridbg" aria-hidden="true"></div>
    <div class="shell">
      <AppHeader title="性能监视" subtitle="PERFORMANCE MONITOR">
        <template #actions>
          <button class="hbtn" type="button" @click="router.push({ name: 'line-select' })">← 返回产线</button>
        </template>
      </AppHeader>

      <div class="body">
        <!-- 引擎状态条 -->
        <div class="statusbar">
          <span class="badge" :class="{ on: engineHealth?.rendering }">
            <i class="dot"></i>
            {{ engineHealth ? (engineHealth.rendering ? '渲染中' : '已停止') : '无活跃渲染场景' }}
          </span>
          <span class="hint">
            渲染后端 <b class="mono">{{ engineHealth?.backend ?? '—' }}</b> ·
            数据为本地实时采样（不依赖 gateway 在线）
          </span>
        </div>

        <!-- 渲染侧（引擎） -->
        <div class="section">
          <div class="sec-title">
            渲染侧 <span class="mono sec-sub">SimEngine.health()</span>
          </div>
          <div v-if="!engineHealth || !engineHealth.rendering" class="emptybox">
            当前无活跃渲染场景 —— 请先进入某条产线的
            <a class="mono" @click="router.push({ name: 'line-select' })">装配工作台</a>
            加载 GLB 后此处将实时显示 draw call / 顶点等渲染指标。
          </div>
          <div v-else class="cards">
            <div class="card">
              <div class="k">引擎帧率</div>
              <div class="v big mono" :class="fpsTone(engineHealth.fps)">{{ fmtFps(engineHealth.fps) }}<i>fps</i></div>
            </div>
            <div class="card">
              <div class="k">Draw Calls</div>
              <div class="v big mono">{{ fmtCount(engineHealth.drawCalls) }}</div>
            </div>
            <div class="card">
              <div class="k">活动网格</div>
              <div class="v big mono">{{ fmtCount(engineHealth.activeMeshes) }}</div>
            </div>
            <div class="card">
              <div class="k">顶点数 / 帧</div>
              <div class="v big mono">{{ fmtCount(engineHealth.totalVertices) }}</div>
            </div>
            <div class="card">
              <div class="k">装配进度</div>
              <div class="v big mono">{{ engineHealth.assembledParts }}<i>/ {{ engineHealth.totalParts }}</i></div>
            </div>
          </div>
        </div>

        <!-- 前端侧（SimMonitor） -->
        <div class="section">
          <div class="sec-title">
            前端侧 <span class="mono sec-sub">SimMonitor · rAF 采样</span>
          </div>
          <div class="cards">
            <div class="card">
              <div class="k">页面帧率<i class="avg">10s 均值</i></div>
              <div class="v big mono" :class="fpsTone(monSnapshot.fpsAvg)">{{ fmtFps(monSnapshot.fpsAvg) }}<i>fps</i></div>
            </div>
            <div class="card">
              <div class="k">帧耗时<i class="avg">10s 均值</i></div>
              <div class="v big mono">{{ frameMs(monSnapshot.fpsAvg) }}<i>ms</i></div>
            </div>
            <div class="card">
              <div class="k">JS 堆内存<i class="avg">10s 均值</i></div>
              <div class="v big mono">{{ mb(monSnapshot.jsHeapUsedAvg) }}<i>/ {{ mb(monSnapshot.jsHeapTotalAvg) }} MB</i></div>
            </div>
            <div class="card">
              <div class="k">LCP<i class="avg">首屏</i></div>
              <div class="v big mono">{{ monSnapshot.lcp > 0 ? monSnapshot.lcp.toFixed(0) : '—' }}<i>ms</i></div>
            </div>
            <div class="card">
              <div class="k">FID<i class="avg">首屏</i></div>
              <div class="v big mono">{{ monSnapshot.fid > 0 ? monSnapshot.fid.toFixed(0) : '—' }}<i>ms</i></div>
            </div>
            <div class="card">
              <div class="k">CLS<i class="avg">首屏</i></div>
              <div class="v big mono">{{ monSnapshot.cls > 0 ? monSnapshot.cls.toFixed(3) : '—' }}</div>
            </div>
          </div>
        </div>

        <!-- 上报状态 -->
        <div class="section">
          <div class="sec-title">
            上报状态 <span class="mono sec-sub">gateway /telemetry（需单容器形态，本地 dev 未起 gateway 时静默丢弃）</span>
          </div>
          <div class="cards small">
            <div class="card">
              <div class="k">入队</div>
              <div class="v mono">{{ monStats?.enqueued ?? 0 }}</div>
            </div>
            <div class="card">
              <div class="k">已上报</div>
              <div class="v mono good">{{ monStats?.flushed ?? 0 }}</div>
            </div>
            <div class="card">
              <div class="k">丢弃</div>
              <div class="v mono" :class="{ bad: (monStats?.dropped ?? 0) > 0 }">{{ monStats?.dropped ?? 0 }}</div>
            </div>
            <div class="card">
              <div class="k">批次数</div>
              <div class="v mono">{{ monStats?.batches ?? 0 }}</div>
            </div>
          </div>
          <div v-if="monStats?.lastError" class="errline mono">
            最近上报错误：{{ String(monStats.lastError) }}
          </div>
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
  width: 100%;
  max-width: 1680px;
  margin: 0 auto;
  padding: 16px;
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

/* 状态条 */
.statusbar {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 22px;
}
.badge {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: 12px;
  color: var(--ink-2);
}
.badge .dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--amber);
  box-shadow: 0 0 0 3px rgba(251, 191, 36, 0.15);
}
.badge.on .dot {
  background: var(--green);
  box-shadow: 0 0 0 3px rgba(52, 211, 153, 0.15);
}
.hint {
  font-size: 11px;
  color: var(--mute);
}
.hint b {
  color: var(--ink-2);
  font-weight: 400;
}

/* 分组 */
.section {
  margin-bottom: 24px;
}
.sec-title {
  font-size: 13px;
  color: var(--ink);
  margin-bottom: 10px;
}
.sec-sub {
  font-size: 10px;
  color: var(--faint);
  margin-left: 8px;
}
.emptybox {
  border: 1px dashed var(--line-2);
  border-radius: 10px;
  background: var(--bg-2);
  color: var(--ink-3);
  font-size: 13px;
  padding: 26px;
}
.emptybox a {
  color: var(--cyan);
  cursor: pointer;
}

/* 指标卡片 */
.cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
  gap: 12px;
}
.cards.small {
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
}
.card {
  border: 1px solid var(--line-2);
  border-radius: 10px;
  background: var(--bg-2);
  padding: 14px 16px;
}
.card .k {
  font-size: 11px;
  color: var(--mute);
  margin-bottom: 8px;
}
.card .k i.avg {
  font-style: normal;
  font-size: 9px;
  color: var(--faint);
  margin-left: 6px;
  letter-spacing: 0;
}
.card .v {
  font-size: 15px;
  color: var(--ink);
}
.card .v.big {
  font-size: 26px;
  font-weight: 500;
  letter-spacing: 0.01em;
}
.card .v i {
  font-style: normal;
  font-size: 11px;
  color: var(--mute);
  margin-left: 6px;
  letter-spacing: 0;
}
.good {
  color: var(--green) !important;
}
.warn {
  color: var(--amber) !important;
}
.bad {
  color: var(--red) !important;
}
.errline {
  margin-top: 10px;
  font-size: 11px;
  color: var(--red);
  border-left: 2px solid color-mix(in srgb, var(--red) 55%, transparent);
  background: color-mix(in srgb, var(--red) 7%, transparent);
  padding: 6px 10px;
  border-radius: 0 6px 6px 0;
  word-break: break-all;
}
</style>
