<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import { MODEL_ASSET_IDS, type ProductionLine } from '@assemble/domain';
import AppHeader from '@/components/AppHeader.vue';
import { createLine, fetchLines, updateLine, type LineWriteInput } from '@/api/lines';

type LineForm = Omit<ProductionLine, 'createdAt' | 'updatedAt'>;

const route = useRoute();
const router = useRouter();
const lines = ref<ProductionLine[]>([]);
const selectedId = ref('');
const form = ref<LineForm | null>(null);
const state = ref<'loading' | 'ready' | 'saving' | 'error'>('loading');
const errorMessage = ref('');
const saveMessage = ref('');

const assetOptions = computed(() => [...MODEL_ASSET_IDS]);
const isNew = computed(() => !form.value?.id);

function cloneLine(line: ProductionLine): LineForm {
  return structuredClone({
    ...line,
    stations: line.stations.map((station) => ({ ...station })),
  });
}

function emptyLine(): LineForm {
  const id = `line-custom-${Date.now()}`;
  return {
    id: '',
    name: '新建净菜产线',
    kind: 'fresh-cut',
    transferAssetId: 'transfer-conveyor',
    transferGapMeters: 0.8,
    enabled: true,
    modelVersion: 'freshcut-v1.0.1',
    stations: [{
      id: `${id}-station-1`,
      lineId: id,
      seq: 1,
      name: '提升上料',
      taktSeconds: 5,
      deviceKind: 'infeed-elevator',
      footprintLengthMeters: 3.49,
      facingDeg: 0,
    }],
  };
}

function selectLine(id: string): void {
  const selected = lines.value.find((line) => line.id === id);
  if (!selected) return;
  selectedId.value = id;
  form.value = cloneLine(selected);
  saveMessage.value = '';
  void router.replace({ query: { lineId: id } });
}

function openNew(): void {
  selectedId.value = '';
  form.value = emptyLine();
  saveMessage.value = '';
  void router.replace({ query: { new: '1' } });
}

function addStation(): void {
  const current = form.value;
  if (!current) return;
  const seq = current.stations.length + 1;
  current.stations.push({
    id: `${current.id || 'line-custom'}-station-${Date.now()}`,
    lineId: current.id,
    seq,
    name: `工位 ${seq}`,
    taktSeconds: 5,
    deviceKind: 'inspection-conveyor',
    footprintLengthMeters: 3.73,
    facingDeg: 0,
  });
}

function removeStation(index: number): void {
  const current = form.value;
  if (!current || current.stations.length <= 1) return;
  current.stations.splice(index, 1);
  current.stations.forEach((station, stationIndex) => { station.seq = stationIndex + 1; });
}

function normalizeForm(): LineWriteInput {
  const current = form.value;
  if (!current) throw new Error('没有可保存的产线配置');
  const stations = current.stations.map((station, index) => ({
    ...station,
    lineId: current.id,
    seq: index + 1,
  }));
  return {
    ...current,
    ...(current.transferAssetId ? { transferAssetId: current.transferAssetId } : {}),
    stations,
  };
}

async function save(): Promise<void> {
  if (!form.value) return;
  state.value = 'saving';
  errorMessage.value = '';
  saveMessage.value = '';
  try {
    const input = normalizeForm();
    const newId = `line-custom-${Date.now()}`;
    const createInput = {
      ...input,
      id: newId,
      stations: input.stations.map((station) => ({ ...station, lineId: newId })),
    };
    const saved = isNew.value ? await createLine(createInput) : await updateLine(input.id, input);
    const existingIndex = lines.value.findIndex((line) => line.id === saved.id);
    if (existingIndex >= 0) lines.value[existingIndex] = saved;
    else lines.value.push(saved);
    selectedId.value = saved.id;
    form.value = cloneLine(saved);
    state.value = 'ready';
    saveMessage.value = '配置已保存，BOM 将按最新工位自动刷新';
    void router.replace({ query: { lineId: saved.id } });
  } catch (error) {
    state.value = 'error';
    errorMessage.value = error instanceof Error ? error.message : '配置保存失败';
  }
}

onMounted(async () => {
  try {
    lines.value = await fetchLines();
    if (route.query.new === '1') openNew();
    else selectLine(String(route.query.lineId ?? lines.value[0]?.id ?? ''));
    state.value = 'ready';
  } catch (error) {
    state.value = 'error';
    errorMessage.value = error instanceof Error ? error.message : '产线加载失败';
  }
});
</script>

<template>
  <div class="config-page">
    <div class="config-shell">
      <AppHeader title="产线配置中心" subtitle="LINE CONFIGURATION CONSOLE" />
      <main class="config-body">
        <div class="config-toolbar">
          <div>
            <h1>工艺与设备配置</h1>
            <p>保存后，装配 BOM、传送段和节拍服务都会读取最新配置。</p>
          </div>
          <div class="toolbar-actions">
            <button type="button" class="btn" @click="router.push({ name: 'line-select' })">返回产线</button>
            <button type="button" class="btn primary" @click="openNew">＋ 新建产线</button>
          </div>
        </div>

        <div v-if="state === 'loading'" class="state">正在加载产线配置…</div>
        <div v-else-if="state === 'error' && !form" class="state error">{{ errorMessage }}</div>
        <div v-else class="config-layout">
          <aside class="line-list">
            <div class="section-label">已配置产线</div>
            <button
              v-for="line in lines"
              :key="line.id"
              type="button"
              class="line-item"
              :class="{ selected: line.id === selectedId }"
              @click="selectLine(line.id)"
            >
              <span>{{ line.name }}</span>
              <small>{{ line.stations.length }} 工位</small>
            </button>
          </aside>

          <section v-if="form" class="editor">
            <div class="section-label">{{ isNew ? '新建产线' : `编辑 · ${form.name}` }}</div>
            <div class="field-grid">
              <label>产线名称<input v-model="form.name" type="text" /></label>
              <label>产线类型
                <select v-model="form.kind">
                  <option value="fresh-cut">果蔬 / 净菜</option>
                  <option value="sorting">分拣</option>
                  <option value="cold-chain">冷链预包装</option>
                </select>
              </label>
              <label>模型版本<input v-model="form.modelVersion" type="text" /></label>
              <label class="switch-field"><span>启用产线</span><input v-model="form.enabled" type="checkbox" /></label>
              <label>卫生转运资产
                <select v-model="form.transferAssetId">
                  <option :value="undefined">不自动生成</option>
                  <option value="transfer-conveyor">transfer-conveyor</option>
                </select>
              </label>
              <label>设备间隙（米）<input v-model.number="form.transferGapMeters" type="number" min="0" step="0.05" /></label>
            </div>

            <div class="station-head">
              <div class="section-label">工位与设备</div>
              <button type="button" class="btn small" @click="addStation">＋ 添加工位</button>
            </div>
            <div class="station-table">
              <div class="table-row table-head"><span>序号</span><span>工位名称</span><span>GLB 设备</span><span>节拍 s/件</span><span>占用长度 m</span><span></span></div>
              <div v-for="(station, index) in form.stations" :key="station.id" class="table-row">
                <span class="seq">{{ index + 1 }}</span>
                <input v-model="station.name" type="text" />
                <select v-model="station.deviceKind">
                  <option v-for="assetId in assetOptions" :key="assetId" :value="assetId">{{ assetId }}</option>
                </select>
                <input v-model.number="station.taktSeconds" type="number" min="0.1" step="0.1" />
                <input v-model.number="station.footprintLengthMeters" type="number" min="0.1" step="0.01" />
                <button type="button" class="remove" title="删除工位" @click="removeStation(index)">×</button>
              </div>
            </div>

            <div v-if="errorMessage" class="form-error">{{ errorMessage }}</div>
            <div v-if="saveMessage" class="form-success">{{ saveMessage }}</div>
            <div class="editor-foot"><span class="hint">工位顺序决定物料流向与 BOM 步骤</span><button type="button" class="btn primary" :disabled="state === 'saving'" @click="save">{{ state === 'saving' ? '保存中…' : '保存配置' }}</button></div>
          </section>
        </div>
      </main>
    </div>
  </div>
</template>

<style scoped>
.config-page { min-height: 100vh; background: var(--app-bg); padding: 16px; color: var(--ink); }
.config-shell { max-width: 1440px; margin: 0 auto; border: 1px solid var(--line); border-radius: 14px; background: var(--bg); overflow: hidden; }
.config-body { padding: 24px; }
.config-toolbar, .station-head, .editor-foot { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
h1 { margin: 0; font-size: 18px; font-weight: 500; }
p { margin: 6px 0 0; color: var(--mute); font-size: 12px; }
.toolbar-actions { display: flex; gap: 8px; }
.btn { border: 1px solid var(--line-3); border-radius: 6px; background: var(--bg-3); color: var(--ink-2); padding: 8px 12px; cursor: pointer; }
.btn.primary { border-color: transparent; background: var(--grad); color: #04121f; font-weight: 600; }
.btn.small { padding: 5px 9px; font-size: 11px; }
.btn:disabled { opacity: .5; cursor: wait; }
.config-layout { display: grid; grid-template-columns: 230px minmax(0, 1fr); gap: 24px; margin-top: 26px; }
.line-list { border-right: 1px solid var(--line); padding-right: 16px; }
.section-label { color: var(--cyan); font-size: 11px; letter-spacing: .08em; text-transform: uppercase; margin-bottom: 10px; }
.line-item { width: 100%; display: flex; flex-direction: column; gap: 4px; text-align: left; border: 1px solid transparent; border-radius: 6px; background: transparent; color: var(--ink-2); padding: 10px; cursor: pointer; }
.line-item small { color: var(--mute); }
.line-item.selected { border-color: rgba(34, 211, 238, .45); background: rgba(34, 211, 238, .08); color: var(--cyan); }
.editor { min-width: 0; }
.field-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin-bottom: 24px; }
label { display: flex; flex-direction: column; gap: 6px; color: var(--mute); font-size: 11px; }
input, select { min-width: 0; border: 1px solid var(--line-3); border-radius: 5px; background: #0d1626; color: var(--ink); padding: 8px; font: inherit; }
.switch-field { justify-content: center; gap: 10px; }
.switch-field input { width: 18px; height: 18px; align-self: flex-start; accent-color: var(--cyan); }
.station-head { border-bottom: 1px solid var(--line); padding-bottom: 7px; }
.station-table { margin-top: 8px; overflow-x: auto; }
.table-row { display: grid; grid-template-columns: 44px minmax(130px, 1.2fr) minmax(150px, 1.4fr) 110px 110px 30px; align-items: center; gap: 8px; padding: 7px 0; border-bottom: 1px solid rgba(51, 65, 85, .45); }
.table-head { color: var(--ghost); font-size: 10px; }
.table-row input, .table-row select { width: 100%; box-sizing: border-box; padding: 7px; font-size: 11px; }
.seq { color: var(--cyan); font-family: var(--mono); text-align: center; }
.remove { border: 0; background: transparent; color: var(--red); font-size: 20px; cursor: pointer; }
.hint { color: var(--mute); font-size: 11px; }
.editor-foot { margin-top: 22px; }
.form-error, .form-success { margin-top: 12px; padding: 8px 10px; border-radius: 5px; font-size: 11px; }
.form-error { color: var(--red); background: rgba(244, 63, 94, .08); }
.form-success { color: var(--green); background: rgba(52, 211, 153, .08); }
.state { padding: 72px; text-align: center; color: var(--mute); }
.state.error { color: var(--red); }
@media (max-width: 900px) { .config-layout { grid-template-columns: 1fr; } .line-list { border-right: 0; border-bottom: 1px solid var(--line); padding: 0 0 12px; display: flex; gap: 6px; overflow-x: auto; } .line-list .section-label { display: none; } .line-item { min-width: 150px; } .field-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 600px) { .config-body { padding: 16px; } .config-toolbar { align-items: flex-start; flex-direction: column; } .field-grid { grid-template-columns: 1fr; } .editor-foot { align-items: flex-start; flex-direction: column; } }
</style>
