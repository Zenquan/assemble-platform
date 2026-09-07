<script setup lang="ts">
/**
 * 模型资产页（design 稿页面 D）—— 自定义 GLB 上传与资产库总览。
 * 数据来自 model-svc /model/assets 与 /model/glb/:assetId（上传/下载）；
 * 页面只编排状态与表单，id 推导/校验等纯逻辑在 api/model.ts。
 */
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import AppHeader from '@/components/AppHeader.vue';
import { ApiError } from '@/api/http';
import {
  assetDisplayName,
  deleteModelAsset,
  deriveCustomAssetId,
  fetchModelAssets,
  suggestChineseName,
  uploadModelAsset,
} from '@/api/model';
import { fetchLines } from '@/api/lines';
import { isCustomAssetId, MODEL_ASSET_IDS, type ModelAssetVersion } from '@assemble/domain';

const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
const router = useRouter();

const state = ref<{ loading: boolean; error: string; assets: ModelAssetVersion[] }>({
  loading: false,
  error: '',
  assets: [],
});

// 上传表单状态
const file = ref<File | null>(null);
const assetIdInput = ref('');
const displayNameInput = ref('');
const uploading = ref(false);
const uploadMessage = ref('');
const uploadError = ref('');
const fileInput = ref<HTMLInputElement | null>(null);

/** 选中文件后自动建议：id 从文件名推导，中文名由词库翻译建议（可手改）。 */
function stageFile(picked: File): void {
  file.value = picked;
  assetIdInput.value = deriveCustomAssetId(picked.name);
  displayNameInput.value = suggestChineseName(picked.name);
}

const isCustom = (a: ModelAssetVersion): boolean => a.assetId.startsWith('custom-');
const customAssets = computed(() => state.value.assets.filter(isCustom));
const builtinEntries = computed(() =>
  // 内置资产可能尚未入库版本记录，仅存在文件；与已注册的自定义资产合并展示
  MODEL_ASSET_IDS.map((id) => {
    const registered = state.value.assets.find((a) => a.assetId === id);
    return registered ?? ({ assetId: id } as ModelAssetVersion);
  }),
);

function formatBytes(bytes: number | undefined): string {
  if (!bytes) return '—';
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}

function formatTime(iso: string | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

async function refresh(): Promise<void> {
  state.value = { loading: true, error: '', assets: state.value.assets };
  try {
    state.value.assets = await fetchModelAssets();
    state.value.error = '';
  } catch (cause) {
    state.value.error =
      cause instanceof ApiError ? cause.message : '无法连接 model-svc，请确认服务已启动';
  } finally {
    state.value.loading = false;
  }
}

function onPickFile(event: Event): void {
  const input = event.target as HTMLInputElement;
  const picked = input.files?.[0] ?? null;
  uploadMessage.value = '';
  uploadError.value = '';
  if (!picked) return;
  stageFile(picked);
}

function onDrop(event: DragEvent): void {
  const picked = event.dataTransfer?.files?.[0] ?? null;
  uploadMessage.value = '';
  uploadError.value = '';
  if (!picked) return;
  stageFile(picked);
}

const idValid = computed(() => isCustomAssetId(assetIdInput.value));
const fileValid = computed(() => !!file.value && file.value.name.toLowerCase().endsWith('.glb'));
const sizeValid = computed(() => !!file.value && file.value.size <= MAX_UPLOAD_BYTES);
const canUpload = computed(
  () => !!file.value && idValid.value && fileValid.value && sizeValid.value && !uploading.value,
);

async function submitUpload(): Promise<void> {
  if (!file.value || !canUpload.value) return;
  uploading.value = true;
  uploadMessage.value = '';
  uploadError.value = '';
  try {
    const result = await uploadModelAsset(
      assetIdInput.value,
      file.value,
      displayNameInput.value.trim() || undefined,
    );
    uploadMessage.value = `已上传 ${result.asset.displayName ?? result.asset.assetId}（${formatBytes(result.asset.sizeBytes)}），可直接下载`;
    file.value = null;
    assetIdInput.value = '';
    displayNameInput.value = '';
    if (fileInput.value) fileInput.value.value = '';
    await refresh();
  } catch (cause) {
    uploadError.value =
      cause instanceof ApiError
        ? `上传失败：${cause.message}`
        : '上传失败：无法连接 model-svc，请确认服务已启动';
  } finally {
    uploading.value = false;
  }
}

// 删除资产状态（列表区反馈与上传区分开）
const deleting = ref('');
const actionMessage = ref('');
const actionError = ref('');

/**
 * 删除自定义资产前的引用防护：先查产线列表，被任一产线工位引用的资产禁止删除，
 * 提示用户先到产线配置更换设备（避免运行态出现指向不存在资产的产线）。
 */
async function onDeleteAsset(asset: ModelAssetVersion): Promise<void> {
  if (deleting.value) return;
  actionMessage.value = '';
  actionError.value = '';
  try {
    const lines = await fetchLines();
    const refs = lines.filter((line) =>
      line.stations.some((station) => station.deviceKind === asset.assetId),
    );
    if (refs.length > 0) {
      actionError.value =
        `无法删除：资产已被产线 ${refs.map((line) => `「${line.name}」`).join('、')} 的工位引用，` +
        '请先在产线配置中更换该设备后再删除';
      return;
    }
  } catch {
    // 产线服务不可达时不阻断删除尝试：服务端仍会做存在性校验
  }
  const label = assetDisplayName(asset);
  if (!window.confirm(`确定删除自定义资产「${label}」（${asset.assetId}）？\n磁盘文件与全部版本记录将一并移除，不可恢复。`)) {
    return;
  }
  deleting.value = asset.assetId;
  try {
    const result = await deleteModelAsset(asset.assetId);
    actionMessage.value = `已删除资产「${label}」（撤销 ${result.removedVersions} 个版本记录）`;
    await refresh();
  } catch (cause) {
    actionError.value =
      cause instanceof ApiError ? `删除失败：${cause.message}` : '删除失败，请确认 model-svc 已启动';
  } finally {
    deleting.value = '';
  }
}

onMounted(() => {
  void refresh();
});
</script>

<template>
  <div class="page">
    <div class="gridbg" aria-hidden="true"></div>
    <div class="shell">
      <AppHeader title="模型资产库" subtitle="MODEL ASSET LIBRARY">
        <template #actions>
          <button class="hbtn" type="button" @click="router.push({ name: 'line-select' })">← 返回产线</button>
        </template>
      </AppHeader>

      <div class="body">
        <!-- 上传卡片 -->
        <div class="upload-card">
          <div class="card-head">
            <div class="title">上传自定义模型</div>
            <div class="sub">仅支持 .glb 二进制 · ≤100MB · 资产 id 自动加 custom- 前缀</div>
          </div>
          <div class="upload-row">
            <label
              class="dropzone"
              :class="{ on: file }"
              for="asset-file"
              @dragover.prevent
              @drop.prevent="onDrop"
            >
              <template v-if="file">
                <span class="mono fname">{{ file.name }}</span>
                <span class="fsize mono">{{ formatBytes(file.size) }}</span>
              </template>
              <template v-else>
                <span>点击选择或拖入 GLB 文件</span>
              </template>
            </label>
            <input ref="fileInput" id="asset-file" type="file" accept=".glb" hidden @change="onPickFile" />

            <div class="idbox">
              <div class="fields">
                <input
                  v-model="displayNameInput"
                  class="nameinput"
                  type="text"
                  placeholder="中文名（如：数控机床）"
                  spellcheck="false"
                />
                <input
                  v-model="assetIdInput"
                  class="idinput mono"
                  :class="{ bad: assetIdInput !== '' && !idValid }"
                  type="text"
                  placeholder="custom-asset-id"
                  spellcheck="false"
                />
              </div>
              <div v-if="assetIdInput !== '' && !idValid" class="hint bad">
                资产 id 须为 custom- 前缀的小写字母/数字/连字符
              </div>
              <div v-else-if="file && !fileValid" class="hint bad">仅支持 .glb 文件</div>
              <div v-else-if="file && !sizeValid" class="hint bad">文件超过 100MB 上限</div>
              <div v-else class="hint">
                资产 id 由文件名自动推导；中文名已按文件名给出建议，可修改
              </div>
            </div>

            <button class="btn prim" type="button" :disabled="!canUpload" @click="submitUpload">
              {{ uploading ? '上传中…' : '上传' }}
            </button>
          </div>
          <div v-if="uploadMessage" class="upload-msg ok">{{ uploadMessage }}</div>
          <div v-if="uploadError" class="upload-msg bad">{{ uploadError }}</div>
        </div>

        <!-- 资产库列表 -->
        <div class="list-bar">
          <div class="title">
            资产库 <b>/ {{ builtinEntries.length + customAssets.length }} 项</b>
          </div>
          <div class="sub2">内置 {{ builtinEntries.length }} · 自定义 {{ customAssets.length }}</div>
        </div>
        <div v-if="actionError" class="action-msg bad">{{ actionError }}</div>
        <div v-else-if="actionMessage" class="action-msg ok">{{ actionMessage }}</div>

        <div v-if="state.loading && state.assets.length === 0" class="statebox">
          正在加载模型资产库…
        </div>
        <div v-else-if="state.error && state.assets.length === 0" class="statebox">
          {{ state.error }} —— 请确认 model-svc(7103) 已启动
          <button class="btn" type="button" @click="refresh">重试</button>
        </div>

        <div v-else class="table">
          <div class="thead">
            <span>资产（中文名 · ID）</span><span>来源</span><span>体积</span><span>压缩</span><span>入库时间</span><span>操作</span>
          </div>
          <div v-for="a in customAssets" :key="a.assetId" class="trow custom">
            <span class="idcell">
              <span class="cn custom-cn">{{ assetDisplayName(a) }}</span>
              <span class="id mono custom-id">{{ a.assetId }}</span>
            </span>
            <span><i class="tag tag-custom">自定义</i></span>
            <span class="mono">{{ formatBytes(a.sizeBytes) }}</span>
            <span class="mono">{{ a.compression }}</span>
            <span class="mono">{{ formatTime(a.createdAt) }}</span>
            <span class="ops">
              <a class="mono" :href="`/model/glb/${encodeURIComponent(a.assetId)}.glb`" download>下载 GLB</a>
              <button
                class="del"
                type="button"
                :disabled="deleting === a.assetId"
                @click="onDeleteAsset(a)"
              >{{ deleting === a.assetId ? '删除中…' : '删除' }}</button>
            </span>
          </div>
          <div v-for="a in builtinEntries" :key="a.assetId" class="trow">
            <span class="idcell">
              <span class="cn">{{ assetDisplayName(a) }}</span>
              <span class="id mono">{{ a.assetId }}</span>
            </span>
            <span><i class="tag">内置</i></span>
            <span class="mono">{{ formatBytes(a.sizeBytes) }}</span>
            <span class="mono">{{ a.compression ?? '—' }}</span>
            <span class="mono">{{ formatTime(a.createdAt) }}</span>
            <span><a class="mono" :href="`/model/glb/${encodeURIComponent(a.assetId)}.glb`" download>下载 GLB</a></span>
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
.title {
  font-size: 15px;
  color: var(--ink);
}
.title b {
  color: var(--mute);
  font-weight: 400;
  font-size: 12px;
}
.sub,
.sub2 {
  font-size: 11px;
  color: var(--mute);
  margin-top: 3px;
}
/* 上传卡片 */
.upload-card {
  border: 1px solid var(--line-2);
  border-radius: 10px;
  background: var(--bg-2);
  padding: 16px 18px;
  margin-bottom: 22px;
}
.card-head {
  margin-bottom: 12px;
}
.upload-row {
  display: flex;
  align-items: flex-start;
  gap: 14px;
}
.dropzone {
  flex: none;
  width: 260px;
  min-height: 56px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  border: 1px dashed var(--line-2);
  border-radius: 8px;
  background: var(--bg-3);
  color: var(--ink-3);
  font-size: 12px;
  cursor: pointer;
  padding: 8px;
}
.dropzone.on {
  border-style: solid;
  border-color: var(--cyan);
  color: var(--ink);
}
.fname {
  max-width: 230px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.fsize {
  font-size: 11px;
  color: var(--mute);
}
.idbox {
  flex: 1;
  min-width: 240px;
}
.fields {
  display: flex;
  gap: 12px;
}
.idinput,
.nameinput {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  background: var(--panel);
  border: 1px solid var(--line-2);
  border-radius: 7px;
  padding: 9px 12px;
  outline: none;
}
.idinput {
  color: var(--cyan);
}
.nameinput {
  color: var(--ink);
}
.idinput:focus,
.nameinput:focus {
  border-color: var(--blue);
}
.idinput.bad {
  border-color: var(--red);
}
.hint {
  font-size: 11px;
  color: var(--mute);
  margin-top: 6px;
}
.hint.bad {
  color: var(--red);
}
.btn {
  font-size: 12px;
  color: #cbd5e1;
  border: 1px solid #2a3a5c;
  background: #111a2e;
  padding: 8px 16px;
  border-radius: 7px;
}
.btn.prim {
  color: #04121f;
  background: var(--grad);
  border-color: transparent;
  font-weight: 500;
}
.btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
.upload-msg {
  margin-top: 10px;
  font-size: 12px;
}
.upload-msg.ok {
  color: var(--green);
}
.upload-msg.bad {
  color: var(--red);
}
.action-msg {
  font-size: 12px;
  margin: -4px 0 10px;
}
.action-msg.ok {
  color: var(--green);
}
.action-msg.bad {
  color: var(--red);
}
/* 列表行操作（下载 + 删除自定义） */
.ops {
  display: inline-flex;
  align-items: center;
  gap: 12px;
}
.del {
  font-size: 12px;
  color: var(--red);
  background: transparent;
  border: 1px solid color-mix(in srgb, var(--red) 45%, transparent);
  border-radius: 6px;
  padding: 2px 9px;
  cursor: pointer;
}
.del:hover {
  background: color-mix(in srgb, var(--red) 12%, transparent);
}
.del:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
/* 列表 */
.list-bar {
  display: flex;
  align-items: baseline;
  gap: 14px;
  margin-bottom: 12px;
}
.statebox {
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--bg-2);
  color: var(--ink-3);
  font-size: 13px;
  padding: 28px;
  display: flex;
  align-items: center;
  gap: 12px;
}
.table {
  border: 1px solid var(--line);
  border-radius: 10px;
  overflow: hidden;
}
.thead,
.trow {
  display: grid;
  grid-template-columns: 1.6fr 0.8fr 0.8fr 0.7fr 1fr 0.8fr;
  gap: 8px;
  align-items: center;
  padding: 9px 14px;
  font-size: 12px;
}
.thead {
  color: var(--faint);
  font-size: 11px;
  background: var(--bg-2);
  border-bottom: 1px solid var(--line);
}
.trow {
  color: var(--ink-2);
  background: var(--bg-3);
  border-bottom: 1px solid var(--line-3);
}
.trow:last-child {
  border-bottom: none;
}
.trow.custom {
  border-left: 2px solid var(--cyan);
}
.id {
  color: var(--ink-2);
}
.idcell {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.cn {
  font-size: 12.5px;
  color: var(--ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.idcell .id {
  font-size: 10.5px;
  color: var(--mute);
}
.custom-id {
  color: var(--cyan);
}
.custom-cn {
  color: var(--cyan);
}
.tag {
  font-style: normal;
  font-size: 10px;
  color: #6d9ee8;
  border: 1px solid #1e3a5f;
  background: #0e1c33;
  border-radius: 4px;
  padding: 2px 7px;
}
.tag-custom {
  color: var(--cyan);
  border-color: #155e6b;
  background: #0a2a33;
}
a {
  color: var(--cyan);
  font-size: 12px;
}
a:hover {
  text-decoration: underline;
}
</style>
