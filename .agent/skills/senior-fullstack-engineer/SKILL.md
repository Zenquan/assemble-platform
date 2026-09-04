---
name: senior-fullstack-engineer
description: assemble-platform 项目级全栈工程技能。用于涉及 Vue 前端、Fastify 后端、@assemble/domain 跨端契约、@assemble/http 响应信封、微服务路由、Repository 存储、Vite 代理、scripts/dev.mjs 服务编排、前后端联调与集成测试的功能、修复或评审。凡改动同时触及 apps/services/packages 中两个及以上层级，新增或调整 HTTP API，接入 model/assembly/interference/takt/auth 服务，或需要判断契约放置与验证范围时加载本 skill；纯 Web3D 渲染问题同时加载 senior-web3d-engineer，纯视觉样式或纯几何算法任务不单独触发本 skill。
---

# 资深全栈工程师

> 把一次跨层改动收敛成可追踪链路：领域契约 -> 后端能力 -> 前端接入 -> 本地编排 -> 自动验证。

## 0. 接入项目流程

本技能是项目主流程的条件执行层，不替代主流程：

1. 先加载 [assemble-platform-workflow](../assemble-platform-workflow/SKILL.md)，按 Phase 0 -> 4 推进。
2. 新需求、边界不清或跨层改动先由 [grill-me](../grill-me/SKILL.md) 锁定需求共识。
3. 命令失败、用户纠正、知识缺口或可复用经验按 [self-improving-agent](../self-improving-agent/SKILL.md) 即时写入 `.learnings/`。
4. 涉及 Babylon、glTF/GLB、相机、材质、包围盒或 Web3D 性能时，同时加载 [senior-web3d-engineer](../senior-web3d-engineer/SKILL.md)。

## 1. 开工决策

先读 `docs/README.md`，至少再读 `docs/ARCHITECTURE.md`、`docs/CODE_STYLE.md`、`docs/TESTING.md` 和 `docs/VERSIONING.md`。这些文档是工程标准事实源，本 skill 只把标准转成执行检查；如两者出现差异，以 `docs/` 为准并同步修正本 skill。然后写出本次变更地图：

| 决策 | 本仓默认选择 | 何时允许偏离 |
|------|--------------|--------------|
| 契约归属 | 跨端形状放 `packages/domain` | 仅单端私有且不会跨边界的数据 |
| HTTP 结果 | `@assemble/http` 的 `{ ok, data }` / `{ ok, code, message }` | 二进制流、下载或标准健康检查 |
| 服务边界 | `services/*` 互不 import，通过 HTTP/事件协作 | 无 |
| 存储访问 | 依赖 `@assemble/storage` 的 `Repository<T>` | 纯计算服务不需要存储 |
| 前端请求 | `apps/sim-platform/src/api` 内 typed client | 引擎内部资产加载可由 SimEngine 封装 |
| 3D 引擎 | Vue 业务只调用 SimEngine 门面 | Babylon import 仅限 `engine/babylon.ts` |
| 本地联调 | Vite proxy 与 `scripts/dev.mjs` 同步维护 | 服务不被浏览器调用时可只保留 `dev:all` |

如果任一决策会改变 `docs/ARCHITECTURE.md` 的依赖方向或公开契约，先更新文档/契约再写实现。

## 2. 契约先行

按以下顺序定义跨端边界：

1. 在 `packages/domain/src` 定义或复用领域类型，并从包入口导出。
2. 为兼容性选择新增可选字段、版本化端点或明确的破坏性变更；不要静默改变既有字段语义。
3. 复用 `@assemble/http` 响应信封与稳定错误码，不在每个服务重复声明同形 DTO。
4. 为请求边界做运行时校验；TypeScript 类型不能替代对网络输入的检查。
5. 先写契约/纯逻辑测试，再分别实现后端和前端消费者。

跨层数据只允许单一事实源。发现前端、服务端各自复制相同 interface 时，优先上移到 `@assemble/domain`，不要用类型断言掩盖漂移。

## 3. 后端实现

保持服务可独立启动、可注入测试、无状态：

- `src/app.ts` 只构建并返回 Fastify 实例，不监听端口；依赖通过 `buildApp(deps)` 注入。
- `src/server.ts` 只读取 `HOST`/`PORT`、调用 `listen` 并处理启动失败。
- 路由层负责解析、校验、调用领域逻辑和格式化响应；业务规则下沉到纯函数/service，持久化下沉到 repository。
- 每个服务保留 `GET /healthz`，预期失败返回稳定 `code`，禁止空 `catch` 和裸露堆栈。
- 服务间不得源码 import；共享算法进入 `packages/*`，跨服务调用走 HTTP/事件契约。
- 文件下载使用白名单、受控路径和正确 Content-Type；不要把用户输入直接拼入文件系统路径。

新增端点时至少覆盖：成功、输入非法、资源不存在，以及依赖失败或降级路径中与本次改动相关的一项。

## 4. 前端接入

沿“API -> 纯逻辑/store -> view/component”接入：

- 在 `apps/sim-platform/src/api` 封装请求、解析统一信封并声明返回类型；不要在 Vue 组件里散落 `fetch`。
- API 基础路径使用同源相对 URL，由 `vite.config.ts` 的 proxy 对接本地服务，生产环境交给网关/CDN。
- 页面显式处理 loading、empty、error、ready；错误映射成用户可理解的状态，同时保留稳定错误码用于诊断。
- 可测试的数据转换放纯函数或 store，组件保持薄，只接收 props、发事件和编排门面。
- 3D 场景状态、拾取、相机、动画和资产加载一律经 SimEngine；业务组件禁止 import `@babylonjs/core`。

当新增浏览器直连后端能力时，同一逻辑单元内检查并同步：

1. `apps/sim-platform/vite.config.ts` 是否有代理。
2. `scripts/dev.mjs` 精简 `CORE` 是否应加入该服务。
3. 根 `package.json` 是否已有对应 `dev:<service>` 脚本。
4. `AGENTS.md` 的启动说明是否仍准确。

## 5. Web3D 全栈链路

涉及模型资产或干涉数据时，使用双技能协作：

- 本技能负责 API 契约、model-svc 文件边界、Vite 代理、失败信封和联调验证。
- `senior-web3d-engineer` 负责 GLB 加载、坐标/单位、包围盒、材质、相机取景和浏览器视觉验收。
- 外观 mesh 与碰撞 OBB 解耦；资产加载失败要有可观察错误或明确降级，不能让 UI 假装成功。
- 大型资产生产优先 CDN/签名 URL；本地开发可经 `/model` 代理访问 model-svc，但不得复制成前端第二份事实源。

## 6. 验证矩阵

验证范围按改动面扩大，不用全仓绿代替针对性测试：

| 改动面 | 最小验证 |
|--------|----------|
| `packages/domain` / `http` | 对应 package typecheck + test，并检查所有消费者 |
| 单个 service | service typecheck + test，Fastify `inject` 覆盖新端点 |
| sim-platform API/store | app typecheck + app vitest |
| 前后端联调 | 启动相关服务，curl 健康/关键端点，确认 proxy 无 404/ECONNREFUSED |
| Web3D 资产链路 | 上述检查 + Playwright 截图/像素或场景状态验收 |
| clearance-core | 单测 + 200 件 `runFull < 200ms` 性能门禁 |

本环境执行 pnpm/tsc 前清掉注入的 `NODE_OPTIONS`：

```bash
env -u NODE_OPTIONS node ./node_modules/.bin/tsc -p services/<svc>/tsconfig.json
env -u NODE_OPTIONS node /Users/zenquan/.workbuddy/binaries/corepack/v1/pnpm/9.15.4/bin/pnpm.cjs --filter <package> test
```

联调时优先 `pnpm dev` 启动浏览器当前依赖的核心服务；需要 auth/model 等非核心服务时使用 `pnpm dev:all`。若前端开始默认依赖新服务，应把它加入精简编排，而不是要求每位开发者记住额外手动启动命令。

## 7. 交付检查

完成前逐项确认：

- 需求共识中的每条验收都有可执行证据。
- domain、HTTP、前端消费端没有同形类型漂移。
- Vite proxy、dev 编排、健康检查和文档保持一致。
- 没有让 apps/services 反向进入 packages，也没有服务间源码依赖。
- 针对性 typecheck/test 已通过；涉及 3D 时完成视觉验收。
- 本轮错误与新经验已按 self-improving-agent review，必要时 promote 到 docs、AGENTS 或技能。

## 8. 技能路由速查

| 任务 | 加载组合 |
|------|----------|
| 纯需求澄清 | `assemble-platform-workflow` + `grill-me` + `self-improving-agent` |
| Vue + API / 服务 / 跨端契约 | 上述基础组合 + `senior-fullstack-engineer` |
| 纯 Babylon / GLB / 3D 渲染 | 基础组合 + `senior-web3d-engineer` |
| GLB 后端下发、实时干涉、3D 数据跨端 | 基础组合 + 两个 senior 技能 |
