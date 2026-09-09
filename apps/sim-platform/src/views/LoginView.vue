<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { login, listRoles, ROLES, type Role } from '@/api/auth';
import { setAuthToken } from '@/api/http';

const router = useRouter();
const route = useRoute();

const userId = ref('operator-1');
const name = ref('生产操作员');
const role = ref<Role>('production_engineer');

const roles = ref<string[]>([]);
const submitting = ref(false);
const error = ref('');

onMounted(async () => {
  try {
    const list = await listRoles();
    if (Array.isArray(list) && list.length) roles.value = list;
  } catch {
    // 拉取失败回落静态角色表（本地 dev 未起 auth-svc 时仍可渲染）
    roles.value = [...ROLES];
  }
});

async function onSubmit(): Promise<void> {
  if (submitting.value) return;
  error.value = '';
  if (!userId.value.trim() || !name.value.trim()) {
    error.value = '请填写用户 ID 与姓名';
    return;
  }
  submitting.value = true;
  try {
    const res = await login({
      userId: userId.value.trim(),
      name: name.value.trim(),
      role: role.value,
    });
    setAuthToken(res.accessToken);
    const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : undefined;
    await router.replace(redirect || { name: 'line-select' });
  } catch (e) {
    error.value = e instanceof Error ? e.message : '登录失败，请稍后重试';
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div class="login-page">
    <form class="login-card" @submit.prevent="onSubmit">
      <div class="brand">SIM-PLATFORM</div>
      <div class="sub">装配仿真平台 · 身份验证</div>

      <label class="field">
        <span class="k">用户 ID</span>
        <input v-model="userId" type="text" autocomplete="username" placeholder="operator-1" />
      </label>

      <label class="field">
        <span class="k">姓名</span>
        <input v-model="name" type="text" autocomplete="name" placeholder="生产操作员" />
      </label>

      <label class="field">
        <span class="k">角色</span>
        <select v-model="role">
          <option v-for="r in roles" :key="r" :value="r">{{ r }}</option>
        </select>
      </label>

      <div v-if="error" class="err">{{ error }}</div>

      <button class="submit" type="submit" :disabled="submitting">
        {{ submitting ? '登录中…' : '登录' }}
      </button>
    </form>
  </div>
</template>

<style scoped>
.login-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background:
    radial-gradient(1200px 600px at 50% -10%, rgba(31, 111, 235, 0.18), transparent 60%),
    var(--bg);
}

.login-card {
  width: 100%;
  max-width: 360px;
  padding: 32px 28px;
  border: 1px solid var(--line);
  border-radius: 14px;
  background: var(--panel);
  box-shadow: 0 18px 50px rgba(0, 0, 0, 0.45);
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.brand {
  font-family: var(--mono);
  font-size: 18px;
  letter-spacing: 3px;
  background: var(--grad);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  text-align: center;
}

.sub {
  font-size: 12px;
  color: var(--mute);
  text-align: center;
  margin-top: -10px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.k {
  font-size: 12px;
  color: var(--ink-3);
}

input,
select {
  width: 100%;
  height: 40px;
  padding: 0 12px;
  border: 1px solid var(--line-2);
  border-radius: 8px;
  background: var(--bg-2);
  color: var(--ink);
  font-size: 14px;
  outline: none;
  transition: border-color 0.15s;
}

input:focus,
select:focus {
  border-color: var(--cyan);
}

.err {
  font-size: 12px;
  color: var(--red);
  line-height: 1.5;
}

.submit {
  height: 42px;
  border: none;
  border-radius: 8px;
  background: var(--grad);
  color: #04121f;
  font-size: 14px;
  font-weight: 600;
  transition: opacity 0.15s;
}

.submit:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
</style>
