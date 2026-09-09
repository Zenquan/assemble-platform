import { createApp } from 'vue';
import { router } from './router';
import App from './App.vue';
import { initSimMonitor } from './monitor';
import { restoreAuthToken, setUnauthorizedHandler } from './api/http';
import './styles/tokens.css';

// 前端可观测性埋点：Web Vitals + FPS + 内存采样，节流批量上报 gateway /telemetry
initSimMonitor();

// 恢复持久化登录态（刷新保活），再挂载
restoreAuthToken();

// 任意请求 401（登录过期/凭证失效）→ 强制跳登录页
setUnauthorizedHandler(() => {
  if (router.currentRoute.value.name !== 'login') {
    void router.push({ name: 'login' });
  }
});

createApp(App).use(router).mount('#app');
