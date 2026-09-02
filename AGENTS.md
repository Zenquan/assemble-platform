# AGENTS.md —— 给 AI 协作助手的本仓工作约定

> 面向任何进入 `assemble-platform/` 写代码的 AI（以及人类）协作对象。**开工前必读本文件与它指向的文档。**

## 你是谁、要遵守什么

本仓库遵循「文档驱动 + 小步可发布」的开发哲学。任何功能/修复/里程碑任务，**先加载流程技能**再动手：

- 加载 `.agent/skills/assemble-platform-workflow` 项目流程技能 —— 它规定 Phase 0→4（需求澄清 → 文档/契约 → Workbuddy 设计稿 → 小步实现/提交）与提交规范。
- 需求边界不清时，加载 `.agent/skills/grill-me` 追问澄清，不猜。
- 遇到错误/纠正/知识缺口，按 `.agent/skills/self-improving-agent` 的日志约定记录（可选，见其 SKILL.md）。

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
- **仓库**：本目录是**独立 git 仓**（main 主干），不从属于父 resume 仓。
- **共享层**：`packages/*`（domain/sim-utils/clearance-core/storage/http）。契约先动 `domain`，纯算法无 DOM。
- **性能红线**：clearance-core **200 件 `runFull <200ms`** 不得突破。
- **前端红线**：业务只经 SimEngine 门面，禁止直引 `@babylonjs/core`。
- **提交**：Conventional Commits，一个逻辑单元一次提交；merge 前全仓 typecheck+test 绿。

## 常用命令

```bash
pnpm test              # packages 单测全量
pnpm typecheck         # 全量类型检查
pnpm --filter @assemble/clearance-core test
```
