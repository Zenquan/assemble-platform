import { createRouter, createWebHashHistory } from 'vue-router';
import type { RouteRecordRaw } from 'vue-router';

const routes: RouteRecordRaw[] = [
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
];

export const router = createRouter({
  // hash 路由：本地 file/preview 直接可开，无需服务端 history 回退
  history: createWebHashHistory(),
  routes,
});

router.afterEach((to) => {
  const t = to.meta.title as string | undefined;
  document.title = t ? `SIM-PLATFORM · ${t}` : 'SIM-PLATFORM';
});
