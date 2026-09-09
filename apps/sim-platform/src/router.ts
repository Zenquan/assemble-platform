import { createRouter, createWebHashHistory } from 'vue-router';
import type { RouteRecordRaw } from 'vue-router';
import { getAuthToken } from '@/api/http';

const routes: RouteRecordRaw[] = [
  {
    path: '/login',
    name: 'login',
    component: () => import('@/views/LoginView.vue'),
    // public：匿名可访问（登录入口本身）
    meta: { title: '登录', public: true },
  },
  {
    path: '/',
    name: 'line-select',
    component: () => import('@/views/LineSelectView.vue'),
    meta: { title: '产线选择' },
  },
  {
    path: '/workbench/:lineId',
    name: 'workbench',
    component: () => import('@/views/WorkbenchView.vue'),
    meta: { title: '装配工作台' },
  },
  {
    path: '/config',
    name: 'line-config',
    component: () => import('@/views/LineConfigView.vue'),
    meta: { title: '产线配置' },
  },
  {
    path: '/assets',
    name: 'model-assets',
    component: () => import('@/views/ModelAssetsView.vue'),
    meta: { title: '模型资产' },
  },
  {
    path: '/perf',
    name: 'performance',
    component: () => import('@/views/PerformanceView.vue'),
    // public：内部监控页，数据来自本地引擎 + 匿名 /telemetry，不依赖登录
    meta: { title: '性能监视', public: true },
  },
];

export const router = createRouter({
  // hash 路由：本地 file/preview 直接可开，无需服务端 history 回退
  history: createWebHashHistory(),
  routes,
});

// 未登录（无令牌）访问受保护路由 → 强制跳登录页，并携带回跳地址
router.beforeEach((to) => {
  const authed = Boolean(getAuthToken());
  if (!authed && !to.meta.public) {
    return { name: 'login', query: to.fullPath !== '/' ? { redirect: to.fullPath } : {} };
  }
  // 已登录却访问登录页 → 回首页
  if (authed && to.name === 'login') {
    return { name: 'line-select' };
  }
});

router.afterEach((to) => {
  const t = to.meta.title as string | undefined;
  document.title = t ? `SIM-PLATFORM · ${t}` : 'SIM-PLATFORM';
});
