# AGENTS.md —— 给 AI 协作助手的本仓工作约定

> 面向任何进入 `assemble-platform/` 写代码的 AI（以及人类）协作对象。**开工前必读本文件与它指向的文档。**

## 你是谁、要遵守什么

本仓库遵循「文档驱动 + 小步可发布」的开发哲学，并以**五 skill 协作流程**运行（三个流程基础技能 + 两个按任务路由的专业技能）。任何功能/修复/里程碑任务，**先加载流程技能**再动手：

> **职责边界**：`docs/` 是架构、版本、代码风格、测试、Git 与设计标准的工程事实源；`.agent/skills/` 负责把这些标准编排进实际工作。Skill 不复制、不降级、也不替代 `docs/` 标准，发生差异时先以 `docs/` 校正 Skill，并同步修复失配。

- 加载 `.agent/skills/assemble-platform-workflow` 项目流程技能 —— 它规定 Phase 0→4（需求澄清 → 文档/契约 → Workbuddy 深色科技设计稿 → 小步实现/提交）与提交规范。
- **需求澄清（Phase 0，强制）**：需求边界不清/新需求/跨层改动，加载 `.agent/skills/grill-me` 按 GRILL 五问追问，产出并得到确认的「需求共识」后才写码。
- **学习记录（贯穿全程，强制）**：遇到错误、用户纠正、知识缺口、API 坑、跨包踩坑 → 按 `.agent/skills/self-improving-agent` **即时**记入 `.learnings/`（团队共享、随提交入库）；每阶段/里程碑收尾 review + promote 重要约定到 `docs/` 或本文件。
- **全栈执行（条件强制）**：涉及 Vue + API、Fastify 服务、`@assemble/domain` 契约、Vite 代理/服务编排，或改动横跨 `apps/services/packages` 两层以上 → 加载 `.agent/skills/senior-fullstack-engineer`。
- **Web3D 执行（条件强制）**：涉及 Babylon、glTF/GLB、渲染、材质/光照、相机/包围盒或 Web3D 性能 → 加载 `.agent/skills/senior-web3d-engineer`。
- **跨端 3D**：模型服务下发 GLB、实时干涉等任务同时加载两个专业技能；具体组合见主流程 skill §0.1。

**`.learnings/` 三件套**：`LEARNINGS.md`（纠正/洞见/知识缺口/最佳实践）、`ERRORS.md`（命令/算法失败）、`FEATURE_REQUESTS.md`（用户待建能力）。格式与 ID 规则见 self-improving-agent SKILL.md。

## 必读文档（按 `docs/README.md` 导航）

| 场景 | 先读 |
|------|------|
| 判断版本进度 | `docs/VERSIONING.md` |
| 模块边界/架构红线 | `docs/ARCHITECTURE.md` |
| 代码风格 | `docs/CODE_STYLE.md` |
| 测试/性能门禁 | `docs/TESTING.md` |
| Git/提交规范 | `docs/GIT_GUIDE.md` |

## 本仓快速事实

- **包管理**：pnpm（`pnpm-lock.yaml`），Monorepo。本环境用 corepack 的 pnpm 调入口；`.npmrc` 强制 `node-linker=hoisted`。
- **版本迭代走分支**：每个版本/里程碑（0.2.0/0.3.x…）开 `feat/<版本>-<名>` 分支，小步 commit 到该分支，收尾 merge 回 `main`。**已合并的版本/里程碑分支保留不删**（利于按版本归因错误与回溯 diff，用户明确约定）。已保留分支：`feat/0.1.0-baseline`（v0.1.0 M1 技术验证基线，指向 `2da0421`，即引入 Vue 前端代码前的状态）＋ `feat/0.2.0-services-runtime` / `feat/0.2.0-sim-platform` / `feat/0.2.0-clean-ready-line` / `feat/0.2.0-babylon-render`（闭合 0.2.0「浏览器渲染装配」出口）＋ `feat/0.3.0-s1-distinct-render` / `feat/0.3.0-s2-assembly-anim` / `feat/0.3.0-s3-manual-drag` / `feat/0.3.0-s4-bom-takt`（闭合 0.3.0「交互式装配仿真」S1–S4）。
- **仓库**：本目录是**独立 git 仓**（main 主干），不从属于父 resume 仓。
- **共享层**：`packages/*`（domain/sim-utils/clearance-core/storage/http）。契约先动 `domain`，纯算法无 DOM。
- **性能红线**：clearance-core **200 件 `runFull <200ms`** 不得突破。
- **前端红线**：业务只经 SimEngine 门面，禁止直引 `@babylonjs/core`。
- **学习记录**：`.learnings/`（LEARNINGS/ERRORS/FEATURE_REQUESTS）**团队共享、随提交入库**；格式遵循 self-improving-agent。
- **提交**：Conventional Commits，一个逻辑单元一次提交；merge 前全仓 typecheck+test 绿。

## 常用命令

```bash
pnpm test              # packages 单测全量
pnpm typecheck         # 全量类型检查
pnpm --filter @assemble/clearance-core test

# 一键起 dev（默认精简：assembly + interference + model + takt + vite）
pnpm dev               # = node scripts/dev.mjs（自包含 Node 编排，不依赖 pnpm）
pnpm dev:all           # = node scripts/dev.mjs --all（全量：5 个后端 + vite）
#  Ctrl+C 会统一清理所有子进程；已占用的端口自动复用不重复起。
# 启动前脚本会检查后端源码与 dist 是否同步，缺失或过期时自动构建；端口已占用则复用已有进程。
# 精简模式包含工作台依赖的 assembly:7101/model:7103，并保留 interference:7102/takt:7104；
# --all 额外起 auth:7105。主机与端口可通过 ASSEMBLE_DEV_HOST、*_SVC_PORT、VITE_DEV_PORT 覆盖。

# ── 后端服务启动/构建速查 ──────────────────────────────
# 5 个后端服务，各自独立（cwd 进服务目录）：
#   <svc>=assembly-svc|interference-svc|model-svc|takt-svc|auth-svc
#   端口映射（源码 services/<svc>/src/server.ts:3 为准）：
#     assembly-svc:7101   interference-svc:7102   model-svc:7103
#     takt-svc:7104       auth-svc:7105
# 构建（根目录）：env -u NODE_OPTIONS node ./node_modules/.bin/tsc -p services/<svc>/tsconfig.json
# 启动（服务目录内）：
#   npm run start          # = node dist/server.js（一次性，前台阻塞）
#   npm run dev            # = node --watch dist/server.js（改动热重启，适合开发）
# vite 代理只连 assembly(7101)+interference(7102)；auth/model/takt 属后端自治、
# 前端暂不直连（需要全链路时用 pnpm dev:all 一起起）。
# 注：services/ 下另有 gateway；clearance 算法在 packages/clearance-core，
#     非独立 HTTP 服务（勿把它当 7103）。

# 装依赖/构建务必 unset NODE_OPTIONS（否则 node-language-shim broker 会误拒 pnpm 的 *_tmp_* mkdir，见 .learnings LRN-20260902-004）
env -u NODE_OPTIONS node /Users/zenquan/.workbuddy/binaries/corepack/v1/pnpm/9.15.4/bin/pnpm.cjs install --store-dir node_modules/.assemble-pnpm-store
env -u NODE_OPTIONS node ./node_modules/.bin/tsc -p services/<svc>/tsconfig.json
```
