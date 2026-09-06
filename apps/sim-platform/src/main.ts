import { createApp } from 'vue';
import { router } from './router';
import App from './App.vue';
import { initSimMonitor } from './monitor';
import './styles/tokens.css';

// 前端可观测性埋点：Web Vitals + FPS + 内存采样，节流批量上报 gateway /telemetry
initSimMonitor();

createApp(App).use(router).mount('#app');
