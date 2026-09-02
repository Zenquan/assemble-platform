---
name: assemble-platform-workflow
description: 产线3D装配仿真平台（assemble-platform）的本工程开发流程技能。当在本仓库开发任何功能、修复、里程碑任务前，先加载本 skill，按「文档驱动 → Workbuddy 设计稿 → 小步实现 → 小步提交」推进，并对照 docs/ 的规范（GIT_GUIDE / CODE_STYLE / ARCHITECTURE / VERSIONING / TESTING）。触发：开发新功能、改造既有模块、跨层改动、进入新的版本里程碑（0.1.x/0.2.x/…）、被要求"按项目流程来"。
---

# Assemble-Platform 开发流程

> **本工程哲学：文档驱动、先对齐再动手、小步可发布。** 参考 `.agent/skills/grill-me`（需求追问）——需求没问清不写码。

---

## 0. 开工前必读

- `docs/README.md` —— 文档导航，先看它决定读哪份。
- `docs/VERSIONING.md` —— 判断当前做到哪个版本、本次属哪一档（0.1 算法地基 / 0.2 单产线 Demo / …）。
- `docs/ARCHITECTURE.md` —— **维护模块边界红线**（SimEngine 门面、依赖方向、前后端算法同源）。
- `docs/CODE_STYLE.md` + `docs/TESTING.md` —— 代码怎么写得一致、测试/性能门禁怎么过。
- `docs/GIT_GUIDE.md` —— 分支 / Conventional Commits / PR / 发版。

---

## 1. 分阶段流程（Phase 0 → 4）

每个新需求/里程碑按序推进；**每阶段完成即小步 commit，不要跨阶段一次堆完**。

### Phase 0 —— 需求澄清（先问清，对齐边界）
- 加载 `grill-me` 五问：目标 / 范围 / 验收 / 约束 / 风险。
- 对照 `VERSIONING.md` 判断改动落在哪个版本档与里程碑出口门禁。
- 产出：一句话目标 + 边界 + 验收标准（写进 commit / PR 描述或阶段任务）。

### Phase 1 —— 文档驱动（先落文档/契约，再写码）
- **契约先行**：跨端数据形状改动先改 `@assemble/domain`，并评估波及面（向后兼容优先）。
- 复杂功能先在 `docs/` 补/更新方案片段或模块说明；改动既有架构红线则同步更新 `ARCHITECTURE.md`。
- 规划落地时维护 `CHANGELOG.md` 的 Unreleased（归类 feat/fix/perf）。
- 本阶段完成 → commit（`docs(...)` 前缀）。

### Phase 2 —— 设计稿（UI 相关用 Workbuddy 出 mockup）
- 涉及前端页面的改动，先用 **Workbuddy 内嵌 mockup**（`show_widget` + mockup 模块）绘制关键页线框稿，对齐布局与信息架构，**先给人看再编码**。
- 设计稿需贴合当前浅色主题；聚焦关键页（产线选择、装配工作台、干涉提示、节拍可视），不必每页都画。
- 设计确认后落一份设计稿资产（可内嵌或存档），→ commit（`docs:` 或 `design:` 前缀，若入仓则 `chore`/`feat` 视改动）。

### Phase 3 —— 小步实现（红绿驱动）
- 切 `feat/<名>` 或 `fix/<名>` 分支（从 `main`）。
- **一个逻辑单元一次提交**；每个逻辑单元做完即过该包 `typecheck` + `test`。
- 核心算法（clearance-core / sim-utils）改动必须带单测，且 **200 件 `runFull<200ms` 性能门禁不得突破**（`docs/TESTING.md`）。
- 前端只经 SimEngine 门面，业务代码禁止直引 `@babylonjs/core`。
- 修 bug 先补能复现的红用例，再改实现转绿。

### Phase 4 —— 合并 / 发版
- 按 `GIT_GUIDE` §3：PR 描述 = 动机/改动/如何验证/关联；**typecheck + test 全绿** 才 merge。
- 更新版本号与 `CHANGELOG.md`，打 `vX.Y.Z` tag（`GIT_GUIDE` §4）。
- 保持 `main` 随时可发布：small & continuous。

---

## 2. 提交规范速查

- 前缀：`feat` `fix` `perf` `refactor` `test` `docs` `chore` `ci` `build` `style`；破坏性加 `!`。
- `scope` 用模块：`(domain)` `(clearance-core)` `(sim-utils)` `(storage)` `(assembly-svc)` `(sim-platform)` …
- subject 祈使句、首字母小写、≤72 字符；正文讲"为什么改"。
- **同逻辑单元收敛一次提交；不同类型（如纯文档 vs 纯代码）分开发。**

示例：
```bash
docs(clearance-core): 补 runFull 返回结构说明
fix(clearance-core): 修复 computeAabbFromObb y 轴误用 cx 的假干涉
feat(sim-platform): 新增产线选择页（SimEngine 门面渲染）
```

---

## 3. 流程红线（不可违反）

1. **先问清再动手**（grill-me），不猜需求边界。
2. **文档驱动**：契约/方案改动先落 `docs/` 与 `domain`，不直接改业务码绕过约定。
3. **UI 先出 Workbuddy mockup 再编码**，不盲写页面。
4. **小步提交**：一个逻辑单元一个 Conventional Commit，main 随时可发布。
5. **门禁**：每包 `typecheck`+`test`；clearance-core 200 件 <200ms；merge 前全仓绿。
6. **边界**：遵守 `ARCHITECTURE.md`（SimEngine 门面、依赖方向、纯算法无 DOM）。

---

## 4. 本技能自身迭代

发现本流程有更优做法 / 踩了新坑 → 更新本 `SKILL.md`（保留 `agent_created: true` 语义，若由 agent 创建），并同步到 `.learnings/`（若启用 self-improving-agent 的日志约定）。
