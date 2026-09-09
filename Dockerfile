# assemble-platform 单容器聚合部署镜像（CloudBase 云托管源码构建）
# 5 个 Fastify 服务由 services/gateway 以子进程方式编排（127.0.0.1:7101–7105），
# gateway 监听 PORT（云托管标准 80）同源托管 sim-platform 静态产物并前缀反代 API。
#
# 构建策略：
#   1. deps 阶段：corepack 安装 pnpm（packageManager 锁定 9.15.4），冻结 lockfile 安装
#   2. build 阶段：按依赖序编译 packages（运行时 main 指向 dist）与 services
#   3. runtime 阶段：只拷贝 dist 产物、node_modules 与 model-svc 本地 GLB 回退目录
#
# 模型 GLB 的云端事实源是对象存储（ASSEMBLE_GLB_BASE_URL 指向 OSS/COS 桶），
# 本地 assets/glb 仅作未配置 env 时的回退。

FROM node:20-slim AS deps
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.base.json ./
COPY packages ./packages
COPY apps ./apps
COPY services ./services
# 冻结 lockfile 安装（workspace 全量依赖；源码随本层一起进来，后续 build 直接复用）
RUN pnpm install --frozen-lockfile

FROM deps AS build
WORKDIR /app
# 运行时依赖 packages/*/dist（main/exports 指向 dist），必须先行编译
# 注意：observability/security/health 虽被多服务 import，但未在此清单内会导致镜像内
# 无 dist/*.d.ts，服务 tsc 报 TS2307（Cannot find module）+ 类型增强缺失的次生错误。
RUN pnpm --filter @assemble/domain build \
  && pnpm --filter @assemble/sim-utils build \
  && pnpm --filter @assemble/clearance-core build \
  && pnpm --filter @assemble/http build \
  && pnpm --filter @assemble/storage build \
  && pnpm --filter @assemble/observability build \
  && pnpm --filter @assemble/security build \
  && pnpm --filter @assemble/health build
# 编译全部后端服务（gateway 最后，独立于其他服务源码）
RUN pnpm --filter @assemble/assembly-svc build \
  && pnpm --filter @assemble/interference-svc build \
  && pnpm --filter @assemble/model-svc build \
  && pnpm --filter @assemble/takt-svc build \
  && pnpm --filter @assemble/auth-svc build \
  && pnpm --filter @assemble/gateway build \
  && pnpm --filter @assemble/sim-platform build

FROM node:20-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/services ./services
# sim-platform Vite 产物由 gateway 静态托管（同源，无需独立静态站点/跨域）
COPY --from=build /app/apps/sim-platform/dist ./apps/sim-platform/dist
# model-svc 本地 GLB 回退目录（OSS 不可达时的兜底；云端事实源为 ASSEMBLE_GLB_BASE_URL）
COPY services/model-svc/assets /app/services/model-svc/assets
# 聚合入口监听端口（云托管探活同端口）
ENV PORT=80
EXPOSE 80
HEALTHCHECK --interval=10s --timeout=3s --start-period=30s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||80)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "services/gateway/dist/server.js"]
