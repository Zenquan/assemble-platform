<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue';

// 通用弹窗 —— 只负责「遮罩 + 框 + 按钮」外壳，业务内容经默认插槽注入。
// visible 支持 v-model 双向绑定；danger 切换危险态（红标题/红按钮）；loading 控制确认中。
// mode='confirm'（默认）双按钮（取消 + 确认）；mode='alert' 单按钮（用于报错/通知提示，点按钮仅关闭）。
const props = withDefaults(
  defineProps<{
    visible?: boolean;
    title?: string;
    danger?: boolean;
    loading?: boolean;
    confirmText?: string;
    cancelText?: string;
    mode?: 'confirm' | 'alert';
  }>(),
  {
    visible: false,
    title: '确认操作',
    danger: false,
    loading: false,
    confirmText: '确认',
    cancelText: '取消',
    mode: 'confirm',
  },
);

const emit = defineEmits<{
  (e: 'update:visible', value: boolean): void;
  (e: 'confirm'): void;
  (e: 'cancel'): void;
}>();

const isAlert = () => props.mode === 'alert';

function close(): void {
  emit('update:visible', false);
}

function onCancel(): void {
  if (props.loading) return;
  if (isAlert()) {
    close();
    emit('confirm');
    return;
  }
  close();
  emit('cancel');
}

function onConfirm(): void {
  if (props.loading) return;
  emit('confirm');
}

function onKeydown(ev: KeyboardEvent): void {
  if (ev.key === 'Escape') onCancel();
}

onMounted(() => document.addEventListener('keydown', onKeydown));
onBeforeUnmount(() => document.removeEventListener('keydown', onKeydown));
</script>

<template>
  <div v-if="visible" class="modal-scrim" @click.self="onCancel">
    <div class="modal" role="dialog" aria-modal="true" :aria-label="title">
      <div class="m-title" :class="{ danger }">
        <i v-if="danger" class="m-ico">!</i>
        {{ title }}
      </div>
      <div class="m-body">
        <slot />
      </div>
      <div class="m-actions">
        <template v-if="mode === 'alert'">
          <button class="btn" type="button" @click="onCancel">{{ confirmText }}</button>
        </template>
        <template v-else>
          <button class="btn" type="button" :disabled="loading" @click="onCancel">{{ cancelText }}</button>
          <button class="btn" type="button" :class="{ danger }" :disabled="loading" @click="onConfirm">
            {{ loading ? '处理中…' : confirmText }}
          </button>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.modal-scrim {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(3, 10, 20, 0.66);
  backdrop-filter: blur(3px);
}
.modal {
  width: min(420px, calc(100vw - 40px));
  background: var(--panel);
  border: 1px solid var(--line-2);
  border-radius: 14px;
  box-shadow: 0 18px 50px rgba(0, 0, 0, 0.45);
  padding: 20px 22px;
}
.m-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 15px;
  font-weight: 600;
  color: var(--ink);
  margin-bottom: 14px;
}
.m-title.danger {
  color: var(--red);
}
.m-ico {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  flex: none;
  font-style: normal;
  font-size: 12px;
  font-weight: 700;
  color: var(--red);
  border: 1.5px solid var(--red);
  border-radius: 50%;
}
.m-body {
  font-size: 12px;
  color: var(--ink-3);
}
.m-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 18px;
}
.m-actions .btn {
  font-size: 12px;
  color: #cbd5e1;
  border: 1px solid #2a3a5c;
  background: #111a2e;
  padding: 8px 16px;
  border-radius: 7px;
  transition: border-color 0.15s ease, background 0.15s ease;
}
.m-actions .btn:hover:not(:disabled) {
  border-color: #3a4f78;
  background: #16223a;
}
.m-actions .btn.danger {
  border-color: color-mix(in srgb, var(--red) 65%, transparent);
  color: var(--red);
  background: color-mix(in srgb, var(--red) 10%, transparent);
}
.m-actions .btn.danger:hover:not(:disabled) {
  border-color: var(--red);
  background: color-mix(in srgb, var(--red) 22%, transparent);
}
.m-actions .btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
</style>
