<script setup lang="ts">
import { useRouter } from 'vue-router';

// 顶部品牌栏 —— 复用于产线选择页与装配工作台。
// props.title/subtitle 可覆盖；无则回落到平台默认品牌。
// engineOnline：引擎在线状态（默认 true = 在线，绿光晕）
const props = withDefaults(
  defineProps<{
    title?: string;
    subtitle?: string;
    engineOnline?: boolean;
  }>(),
  { engineOnline: true },
);
const router = useRouter();
</script>

<template>
  <header class="hd">
    <img class="hdlogo" src="/logo.png" alt="SIM-PLATFORM" draggable="false" />
    <div>
      <div class="hd-name">{{ title ?? '产线装配仿真平台' }}</div>
      <div class="hd-sub">{{ subtitle ?? 'ASSEMBLY SIMULATION CONSOLE' }}</div>
    </div>
    <span class="badge" :class="{ on: engineOnline !== false }">
      <i class="dot"></i>引擎{{ engineOnline === false ? '离线' : '在线' }}
    </span>
    <div class="hbtns">
      <slot name="actions">
        <button class="hbtn" type="button" @click="router.push({ name: 'model-assets' })">导入模型</button>
        <button class="hbtn prim" type="button" @click="router.push({ name: 'line-config', query: { new: '1' } })">＋ 新建产线</button>
      </slot>
    </div>
  </header>
</template>

<style scoped>
.hd {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px 22px;
  border-bottom: 1px solid var(--line);
  background: rgba(9, 15, 28, 0.6);
}
.hdlogo {
  width: 34px;
  height: 34px;
  flex: none;
  border-radius: 8px;
  background: #fff;
  object-fit: cover;
}
.hd-name {
  font-size: 14px;
  color: var(--ink);
  font-weight: 500;
}
.hd-sub {
  font-size: 9px;
  letter-spacing: 0.16em;
  color: var(--faint);
  margin-top: 3px;
  text-transform: uppercase;
}
.badge {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: 12px;
  color: #5eead4;
  margin-left: 2px;
}
.badge .dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--green);
  box-shadow: 0 0 0 3px rgba(52, 211, 153, 0.15);
}
.badge.off .dot {
  background: var(--amber);
  box-shadow: 0 0 0 3px rgba(251, 191, 36, 0.15);
}
.hbtns {
  margin-left: auto;
  display: flex;
  gap: 8px;
}
.hbtn {
  font-size: 12px;
  color: #cbd5e1;
  border: 1px solid #2a3a5c;
  background: #111a2e;
  padding: 7px 14px;
  border-radius: 7px;
}
.hbtn.prim {
  color: #04121f;
  background: var(--grad);
  border-color: transparent;
  font-weight: 500;
}
.hbtn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
/* 页面经 actions 插槽自定义的按钮复用同一视觉（scoped CSS 用 :slotted 命中父作用域节点） */
.hbtns :slotted(.hbtn) {
  font-size: 12px;
  color: #cbd5e1;
  border: 1px solid #2a3a5c;
  background: #111a2e;
  padding: 7px 14px;
  border-radius: 7px;
}
.hbtns :slotted(.hbtn.prim) {
  color: #04121f;
  background: var(--grad);
  border-color: transparent;
  font-weight: 500;
}
.hbtns :slotted(.hbtn:disabled) {
  opacity: 0.55;
  cursor: not-allowed;
}
</style>
