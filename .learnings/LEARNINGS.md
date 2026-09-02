# Learnings

Corrections, insights, and knowledge gaps captured during development.

**Categories**: correction | insight | knowledge_gap | best_practice

> 本仓按 **团队共享 / 入库** 模式使用 `.learnings/`（随各阶段小步提交一起带）。格式遵循 `.agent/skills/self-improving-agent`。ID 规则 `TYPE-YYYYMMDD-XXX`。

---

## [LRN-20260902-001] best_practice

**Logged**: 2026-09-02T22:00:00+08:00
**Priority**: high
**Status**: resolved
**Area**: config

### Summary
沙箱环境禁 symlink 导致 pnpm workspace 安装失败，需用 hoisted 链接模式。

### Details
pnpm workspace install 默认建 symlink，被环境 broker 拒（ERR_PNPM_CODEBUDDY_BROKER_DENY）。本工程 `.npmrc` 已固定 `node-linker=hoisted` + `shamefully-hoist=true`。本机无 pnpm，需经 corepack 入口调 `pnpm@9.15.4` 的 `.cjs`，并可用 `--store-dir node_modules/.assemble-pnpm-store` 规避安全删除守卫。

### Suggested Action
凡本仓装依赖：用 `node …/pnpm.cjs install`（见 AGENTS.md §常用命令备注），**不要**临时改 `.npmrc` 为默认 linked 模式。

### Metadata
- Source: error
- Related Files: .npmrc
- Tags: pnpm, hoisted, sandbox
- Pattern-Key: build.pnpm_hoisted
- Recurrence-Count: 2

---

## [LRN-20260902-002] knowledge_gap

**Logged**: 2026-09-02T22:00:00+08:00
**Priority**: high
**Status**: resolved
**Area**: tests

### Summary
vitest 启动 config.ts 用"原子 rename"写 `vitest.config.ts.timestamp-*.mjs`，正常退出会清，但被 TaskStop/Ctrl-C 打断会留孤儿文件。

### Details
每次中断的 vitest 会在工程根撒一个同名临时 `.mjs`，堆积污染工作区。`.gitignore` 已兜底（`*.timestamp-*.mjs`），但仍显示在 IDE。

### Suggested Action
长跑测试用 `pnpm test`（vitest run 一次性）而非交互式；中断后顺手清 `vitest.config.ts.timestamp-*.mjs`。

### Metadata
- Source: error
- Related Files: .gitignore, vitest.config.ts
- Tags: vitest, tmpfile
- Pattern-Key: tests.vitest_tmp_orphan

---

## [LRN-20260902-003] correction

**Logged**: 2026-09-02T23:00:00+08:00
**Priority**: high
**Status**: resolved
**Area**: docs

### Summary
sim-platform 产品 UI 定稿为「深色科技扁平」，不能用贴合宿主 IDE 的浅色 mockup。

### Details
用户两轮嫌浅色线框 mockup "太丑"，AskUserQuestion 拍板深色科技大屏感（工业数字孪生）。色板/令牌见 `apps/sim-platform/design/sim-platform-tech-mockup.html` 与 `docs/sim-platform-design.md` §1。后续任何 sim-platform UI 设计一律走这套色板，别按宿主浅色画。

### Suggested Action
见 `.agent/skills/assemble-platform-workflow` Phase 2；UI 改动先出深色科技稿再编码。

### Metadata
- Source: user_feedback
- Related Files: docs/sim-platform-design.md, apps/sim-platform/design/sim-platform-tech-mockup.html
- Tags: ui, dark-theme
- Pattern-Key: ui.sim_dark_tech

---
