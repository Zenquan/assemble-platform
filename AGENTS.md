# AGENTS.md —— 给 AI 协作助手的本仓工作约定

> 面向任何进入 `assemble-platform/` 写代码的 AI（以及人类）协作对象。**开工前必读本文件与它指向的文档。**

## 你是谁、要遵守什么

本仓库遵循「文档驱动 + 小步可发布」的开发哲学，且有一套**三 skill 自洽流程**（主流程 + 两个强制环节）。任何功能/修复/里程碑任务，**先加载流程技能**再动手：

- 加载 `.agent/skills/assemble-platform-workflow` 项目流程技能 —— 它规定 Phase 0→4（需求澄清 → 文档/契约 → Workbuddy 深色科技设计稿 → 小步实现/提交）与提交规范。
- **需求澄清（Phase 0，强制）**：需求边界不清/新需求/跨层改动，加载 `.agent/skills/grill-me` 按 GRILL 五问追问，产出并得到确认的「需求共识」后才写码。
- **学习记录（贯穿全程，强制）**：遇到错误、用户纠正、知识缺口、API 坑、跨包踩坑 → 按 `.agent/skills/self-improving-agent` **即时**记入 `.learnings/`（团队共享、随提交入库）；每阶段/里程碑收尾 review + promote 重要约定到 `docs/` 或本文件。

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
- **版本迭代走分支**：每个版本/里程碑（0.2.0/0.3.x…）开 `feat/<版本>-<名>` 或 `release/vX.Y.Z` 分支，小步 commit 到该分支，收尾 merge 回 `main`（用户已明确此约定，勿再直接往 main 堆里程碑）。
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

# 装依赖/构建务必 unset NODE_OPTIONS（否则 node-language-shim broker 会误拒 pnpm 的 *_tmp_* mkdir，见 .learnings LRN-20260902-004）
env -u NODE_OPTIONS node /Users/zenquan/.workbuddy/binaries/corepack/v1/pnpm/9.15.4/bin/pnpm.cjs install --store-dir node_modules/.assemble-pnpm-store
env -u NODE_OPTIONS node ./node_modules/.bin/tsc -p services/<svc>/tsconfig.json
```
