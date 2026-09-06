# TESTING —— 测试策略与质量门禁

> 本工程的质量红线：**任何改动在提交前必须 typecheck + test 全绿**。本文回答「测什么、怎么测、基准卡在哪」。
> 配套：`docs/CODE_STYLE.md` §7（单测写法）、`docs/GIT_GUIDE.md`（提交/评审门禁）、`docs/VERSIONING.md`（版本出口门禁）。

## 1. 测试分层

```
packages/*   单测（vitest，纯逻辑，快，ms~s 级）
services/*   服务级测试（注入 app 不监听，发真实 HTTP 打 /healthz 与业务路由）
apps/*       前端（组件/逻辑测试优先，引擎门面 mock；E2E/截图在 0.2.x 落地）
```

**约定**：
- 单测放各包 `test/*.test.ts`，走根 `vitest.config.ts`（alias 到源码，**无需先 build**）。
- 测试 import 一律走**包根导出**（`from '@assemble/clearance-core'`），验证公共接口而非内部私有实现 —— 逼出稳定的对外契约。
- 描述用中文句子（what + 期望）：`describe('模块/类')` → `it('某行为')`。
- 纯契约/骨架包（当前：`domain`/`storage`/`auth-svc`）暂无单测时，`test` 脚本用 `vitest run --passWithNoTests` 显式允许空套件，避免根 `pnpm test` / `pnpm test:services` 被空测试集退出 1 截断；有真用例后保留该开关即可。

## 2. 测试类型与责任

| 类型 | 载体 | 关注点 | 示例 |
|------|------|--------|------|
| 单测 | 各包 `test/` | 算法正确性、边界、错误路径 | OBB-SAT 分离/接触/斜盒；BVH 自碰撞无重复对 |
| 性能/基准 | 单测中的阈值断言 | 防性能回归 | 200 件 `runFull < 200ms` |
| 服务集成 | `services/*/test` | 路由/信封/降级存储连通 | `/healthz`、响应 `ok/err` |
| （规划）前端 | apps | 装配逻辑（store 注入假门面） | 三模式状态流转 |

## 3. 性能基准（不可退让的阈值）

- **`@assemble/clearance-core`：200 零部件 `runFull < 200ms`**（对齐简历口径，产线工程师可接受的上限）。
  - 位置：`packages/clearance-core/test/clearance.test.ts`
  - 该用例作为**性能回归门禁**：任何几何/索引改动若使其失败，必须先定位是不是引入 O(n²) 或分配热点。
- 其它基准（OBB-SAT 单对、BVH 构建）随功能演进补 `test/` 阈值用例。

> 判断基准波动：CI 环境比本机慢属正常；阈值留 20% 余量，若经常贴线再评估调优而非放宽。

## 4. 命令

```bash
# 全量（packages 单测）
pnpm test

# 服务层测试（注入 app，不起监听进程）
pnpm test:services

# 单包（迭代时常用）
pnpm --filter @assemble/clearance-core test

# typecheck（提交前必跑）
pnpm typecheck
```

## 5. 提交 / 评审门禁（与 GIT_GUIDE 衔接）

> CI 已落地（`.github/workflows/ci.yml`，见 `GIT_GUIDE.md` §5）：`push` 到 `main` 与 `pull_request` 自动跑 `pnpm build:all` + `typecheck:all` + `test:all`，失败阻断合并。下表为门禁语义来源。

| 动作 | 前置通过项 |
|------|-----------|
| 任何提交 | 所属包 `typecheck` + `test` |
| merge 到 main | 全仓 `typecheck` + `test`（含性能基准），CI 绿灯 |
| 修改 domain 契约 | 反向全量 `typecheck`（改动波及所有依赖包），优先向后兼容 |
| 修改 clearance-core | 单测 + 200 件性能用例必须仍绿 |

## 6. 覆盖率与回归

- **覆盖率门禁已落地**（`pnpm test:coverage`，已并入 CI）：对核心算法包 `clearance-core` + `sim-utils` 强制 `lines/functions/statements ≥80%`、`branches ≥75%`。阈值在根 `vitest.config.ts` 的 `coverage.thresholds`。
  - `branches` 单独放宽到 75% 的原因：`math.ts`/`obb.ts` 含大量防御性 `?? 0`/`|| 1` 兜底分支（类型层已保证非空），无法通过有意义用例触发，不为凑数字写无意义测试。
- 不做覆盖率的教条式 KPI（骨架/服务/前端包不强制数字），但**核心算法（bvh/obbSat/detector）改动必须新增几何用例**证明正确性。
- 回归靠两条：① Conventional Commit 的可追溯性（见 GIT_GUIDE）；② 性能/行为阈值用例随版本固化在 `test/`。
- 修复 bug 先补一条能复现该 bug 的用例再改实现（红→绿），防止同一坑复发。
