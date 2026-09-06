# GIT_GUIDE —— Git 工作流与提交规范

> 与 `VERSIONING.md` 配套：**提交信息驱动版本号、分支模型保障可发布主线**。适用对象：在本仓库协作的每一个人（含未来的 AI 协作助手）。

## 1. 分支模型

采用 **Trunk-based + 短生命周期特性分支**（适配 1–3 人 + AI 协作的小型工业项目，避免 GitFlow 过度设计）。

| 分支 | 用途 | 规则 |
|------|------|------|
| `main` | 稳定可发布主干 | 只接受 `release/`、`hotfix/` 或评审通过的 squash merge；禁止直接 push |
| `feat/<名>` | 新功能 | 从 `main` 切，合并回 `main` 即删 |
| `fix/<名>` | 缺陷修复 | 同上 |
| `release/vX.Y.Z` | 版本发布线 | 冻结后仅 bug 修复并入，发版打 tag 合回 main |
| `hotfix/<名>` | 生产紧急修复 | 从最新 tag 切，双合 main + 当前 release |

**AI/协作提示**：一个逻辑变更一个分支；不要在同一分支混入无关改动（评审与回溯会乱）。

## 2. 提交信息：Conventional Commits

格式（这是**版本号来源**，务必规范）：

```
<type>[optional scope][!]: <subject>

[optional body]
```

| type | 含义 | 版本影响 |
|------|------|---------|
| `feat` | 新功能 | 次版本 `+1` |
| `fix` | Bug 修复 | 修订 `+1` |
| `perf` | 性能优化 | 修订 `+1`（可标注基准提升） |
| `refactor` | 重构（无行为变化） | 修订 `+0`（记 changelog 无 tag 必然） |
| `test` | 测试新增/修改 | 修订 `+0` |
| `docs` | 文档 | 修订 `+0` |
| `chore` | 构建/依赖/杂项 | 修订 `+0` |
| `ci` | CI 配置 | 修订 `+0` |
| `build` | 构建系统 | 修订 `+0` |
| `style` | 格式（不影响逻辑） | 修订 `+0` |
| **`breaking!`** 或 `feat!` | 破坏性变更 | **主版本 `+1`** |

**scope（可选但鼓励）**：用模块名 `(clearance-core)`, `(domain)`, `(sim-platform)`, `(assembly-svc)` 等，利于 changelog 分组。

### 示例
```bash
# 普通
feat(clearance-core): 新增 BVH 自碰撞离线全量预检入口

# 破坏性（0.x 期仍加次版本；1.0 后需主版本）
refactor!(domain): Constraint 改用 id 引用零件，不再内嵌坐标

# 性能（带可验证指标）
perf(clearance-core): 优化 OBB-SAT 分离轴短路，200件 runFull 3.2s→35ms
```

> **subject 用祈使句、首字母小写、≤72 字符**；正文解释"为什么改"而非"改了什么"（diff 已能看出什么）。

## 3. PR / 评审流程

每个 merge 到 `main` 前过评审：

1. 从 `main` 切 `feat/...`，功能完整 + 提交信息规范。
2. **必须通过**：`typecheck` + `test`（含性能回归用例）。
3. PR 描述：动机、改动点、如何验证、关联 issue。
4. **Squash merge** 到 `main`（保留一个清晰 commit，信息格式同 Conventional Commits）。
5. 合入后删特性分支。

## 4. 发布流程（与 VERSIONING 衔接）

```bash
# 1) 从 main 切 release 线
git checkout -b release/v0.1.1 main

# 2) 仅修复性提交，更新版本号 + changelog
pnpm --filter @assemble/clearance-core version patch   # 或整体统一版本

# 3) 打 tag（格式 vX.Y.Z）
git tag -a v0.1.1 -m "release: v0.1.1"
git push origin release/v0.1.1 && git push origin v0.1.1

# 4) 合回 main
git checkout main && git merge --no-ff release/v0.1.1
git push origin main
```

**tag 即发布单元**：CI 检测到 `vX.Y.Z` tag 触发构建/镜像/部署。

## 5. CI 门禁（GitHub Actions）

`.github/workflows/ci.yml` 在 `push` 到 `main` 与 `pull_request` 时自动执行，把「人工约定」固化为「机器门禁」，任一环节失败即阻断合并：

| 阶段 | 命令 | 覆盖 |
|------|------|------|
| 构建 | `pnpm build:all` | 全 workspace 拓扑构建（`pnpm -r --sort`） |
| 类型检查 | `pnpm typecheck:all` | 全 workspace `tsc --noEmit`（含 sim-platform `vue-tsc`） |
| 测试 | `pnpm test:all` | packages + services + apps 全量单测，**含 clearance-core 200 件 `runFull <200ms` 性能回归门禁** |

本地一键复现整条门禁：`pnpm ci`（= `build:all` + `typecheck:all` + `test:all`）。

> 依赖用 `pnpm install --frozen-lockfile` 锁定，保证 CI 与本地 `pnpm-lock.yaml` 一致；`node-linker=hoisted` 已在 `.npmrc` 强制（规避受限环境 symlink 拒绝）。

## 6. 协作红线（务必遵守）

- 禁止直接向 `main` push；一律 PR。
- 不 `--force` push 共享分支；确需改写历史只限未 push 的本地分支。
- 不在提交里夹带：`.env`、密钥、`node_modules`、大体积二进制/模型文件（用 `.gitignore` + 资产管理，模型走对象存储）。
- 每个 merge 保持主干**随时可发布**（small & continuous）。

## 6. AI 协作提交约定

- AI 助手改动遵循同一 Conventional Commits；同一逻辑单元收敛为一次提交。
- AI 在创建分支前先看 `docs/GIT_GUIDE.md` 与当前分支，避免污染他人工作。
- AI 提交覆盖测试与 typecheck 通过后才可视为完成。
