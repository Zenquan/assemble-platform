# DEPLOYMENT —— 部署

> 部署事实源：CloudBase 云托管「通过 Git 仓库部署」。本地不再维护 `.deploy/` 构建快照，
> 也不再用 `tcb cloudrun deploy` 手动部署；代码推送 GitHub 后由 CloudBase 拉取源码并构建。

## 部署形态

单容器聚合部署：

- 根目录 `Dockerfile` 构建全部 `packages/*`、`services/*` 与 `apps/sim-platform`；
- runtime 以 `services/gateway/dist/server.js` 为入口，子进程拉起 5 个上游服务
  （assembly 7101 / interference 7102 / model 7103 / takt 7104 / auth 7105）；
- gateway 监听 `PORT=80`，同源托管前端静态产物并前缀反代 API；
- model-svc 自带 `services/model-svc/assets/glb` 本地回退，未配置对象存储也能渲染。

## 首次在 CloudBase 控制台绑定（一次性操作）

1. 打开云开发控制台 → 云托管 → 服务 `assemble-platform`。
2. 选择「通过 Git 仓库部署」→ 绑定 GitHub 账号，授权私有仓库
   `Zenquan/assemble-platform`。
3. 选择部署分支 `main`，容器端口填 `80`，构建使用仓库根 `Dockerfile`。
4. 开启「自动部署」：此后 push `main` 会触发 CloudBase 拉取最新源码并构建发布。
5. 部署完成后访问平台分配的服务域名，验证 `/healthz` 与首页。

## 触发方式

- 向 GitHub `main` 推送 / PR 合并 → CloudBase Webhook 自动触发构建与发布；
- 需要手动重发时，在云托管控制台「手动部署」拉取最新 commit 即可，无需本地 CLI。

## 注意事项

- 已按旧端口 `3000` 绑定过的服务：请在云托管「服务设置」把端口同步改为 `80` 再触发部署，平台按该端口转发。
- `main` 必须包含根 `Dockerfile` 与 `services/gateway`（版本分支合并回 `main` 后生效）；
- Vite/Babylon 生产构建较重，CloudBase 每次部署会叠加数分钟构建耗时，属正常现象；
- 仓储默认内存模式：配置中心/节拍/审计等写入在容器重启后重置。需要持久化时在云托管
  环境变量设置 `ASSEMBLE_STORAGE=file`、`ASSEMBLE_DATA_DIR=/data` 并挂载持久化目录；
- 本地开发与部署互不影响：`pnpm dev` 仍走原自包含编排，不需要 `.deploy/` 快照。
