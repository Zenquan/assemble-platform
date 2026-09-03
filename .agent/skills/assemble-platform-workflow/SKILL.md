---
name: assemble-platform-workflow
description: 产线3D装配仿真平台（assemble-platform）的项目主流程技能，统一编排五个本地 skill：需求澄清 grill-me、全栈工程 senior-fullstack-engineer、Web3D 工程 senior-web3d-engineer、学习沉淀 self-improving-agent，以及本主流程。覆盖 Phase 0→4 的需求共识、文档/契约、Workbuddy 深色科技设计稿、小步实现、验证、提交与复盘。进入本仓开发任何功能、修复、评审或里程碑任务前加载本 skill，再按任务路由条件技能。
---

# Assemble-Platform 开发流程

> **本工程哲学：文档驱动、先对齐再动手、小步可发布。** 一套自洽的工具链（见下「技能编排」），任何进入本仓的 agent 都按它推进。

---

## 0. 技能编排（五个 skill 分层协作）

本仓 `.agent/skills/` 下的五个技能统一由本文件编排。前三个是流程基础层，两个 senior 技能是按任务加载的专业执行层：

| Skill | 环节 | 在流程中的职责 | 触发点 |
|-------|------|--------------|--------|
| `assemble-platform-workflow`（本文件） | 主流程 | 编排 Phase 0→4，规定每阶段动作、文档/设计/提交规范 | 每次开发/修复/里程碑任务开工前必加载 |
| `grill-me` | **Phase 0 执行者** | 用 GRILL 五问把目标/边界/约束/验收问清，产出并确认「需求共识」 | 任何新需求、功能变更、跨层改动，需求边界不清时**强制**加载，问清前不写码 |
| `self-improving-agent` | **贯穿全程的记录层** | 错误/纠正/知识缺口/待建能力发生时记入 `.learnings/`（团队共享、入库）；里程碑后 review，重要约定 promote 到 `docs/` 或 `AGENTS.md` | 命令失败、用户纠正、发现更好做法、API 坑、跨包踩坑——**即时记**；每阶段完成——**review 一次** |
| `senior-fullstack-engineer` | **全栈执行层** | 约束 domain 契约、Fastify 服务、Vue API 接入、代理/服务编排与集成验证 | 修改 API，或改动横跨 `apps/services/packages` 两层以上时加载 |
| `senior-web3d-engineer` | **Web3D 执行层** | 约束 Babylon、GLB 资产、材质/光照、坐标/包围盒、相机与视觉验收 | 涉及 3D、Babylon、glTF/GLB、渲染与 Web3D 性能时加载 |

> **规则**：主流程负责时序；grill-me 管开始前问清；self-improving-agent 管过程记录与结束沉淀；两个 senior 技能管实现质量。GLB 后端下发、实时干涉等跨端 3D 任务必须同时加载两个 senior 技能。

### 0.1 路由规则

| 改动类型 | 必需技能组合 |
|----------|--------------|
| 文档、流程、普通单层修复 | `assemble-platform-workflow` + `self-improving-agent`；新需求再加 `grill-me` |
| Vue + API、服务端、共享契约 | 基础组合 + `senior-fullstack-engineer` |
| Babylon、GLB、材质、相机、包围盒 | 基础组合 + `senior-web3d-engineer` |
| 模型服务到 Babylon、前后端干涉链路 | 基础组合 + `senior-fullstack-engineer` + `senior-web3d-engineer` |

每次 Phase 0 收敛后明确写出本次加载组合；任务中途跨入另一专业边界时立即补加载对应技能。

## 0.5 开工前必读

`docs/` 是本仓工程标准的单一事实源，本 skill 只负责编排执行，不替代下列文档。若 skill 与文档不一致，先按文档执行并在当前任务内同步修正 skill；不得为了缩短流程跳过文档标准。

- `docs/README.md` —— 文档导航，先看它决定读哪份。
- `docs/VERSIONING.md` —— 判断当前做到哪个版本、本次属哪一档（0.1 算法地基 / 0.2 单产线 Demo / …）。
- `docs/ARCHITECTURE.md` —— **维护模块边界红线**（SimEngine 门面、依赖方向、前后端算法同源）。
- `docs/CODE_STYLE.md` + `docs/TESTING.md` —— 代码怎么写得一致、测试/性能门禁怎么过。
- `docs/GIT_GUIDE.md` —— 分支 / Conventional Commits / PR / 发版。

---

## 1. 分阶段流程（Phase 0 → 4）

每个新需求/里程碑按序推进；**每阶段完成即小步 commit，不要跨阶段一次堆完**。

### Phase 0 —— 需求澄清（由 grill-me 全权执行）
- **加载 `.agent/skills/grill-me`**，按 GRILL 五问（目标 / 范围 / 输入约束 / 核心逻辑 / 验收+兼容）向用户逐项确认；信息已够的自答跳过。
- 铁律：**用户没提的功能一律砍掉或先问，不准自作主张加**；范围蔓延即回炉。
- 对照 `VERSIONING.md` 判断改动落在哪个版本档与里程碑出口门禁。
- 产出：标准「**需求共识**」（格式见 grill-me §输出）——含目标 / 范围✅❌ / 输入 / 约束 / 核心逻辑 / 验收标准 / 影响范围。
- **必须得到用户"对，就按这个来"的确认**，共识才算锁定，方可进 Phase 1。
- 按 §0.1 选择专业执行技能，并在需求共识的「影响范围」中标明前端/后端/契约/Web3D。

### Phase 1 —— 文档驱动（先落文档/契约，再写码）
- 跨 `apps/services/packages` 的改动加载 `senior-fullstack-engineer`，先画出契约与调用链。
- **契约先行**：跨端数据形状改动先改 `@assemble/domain`，并评估波及面（向后兼容优先）。
- 复杂功能先在 `docs/` 补/更新方案片段或模块说明；改动既有架构红线则同步更新 `ARCHITECTURE.md`。
- 规划落地时维护 `CHANGELOG.md` 的 Unreleased（归类 feat/fix/perf）。
- **记录**：本阶段若发现文档与实现不符 / 有更清晰的组织方式 → 记 `.learnings/`（类别 `docs` / `best_practice`）。
- 本阶段完成 → commit（`docs(...)` 前缀）。

### Phase 2 —— 设计稿（UI 相关用 Workbuddy 出设计稿）
- 涉及前端页面的改动，先用 **Workbuddy** 绘制关键页设计稿，对齐布局与信息架构，**先给人看再编码**。
- **风格固定为「深色科技扁平」**（色板/令牌/视觉语言见 `apps/sim-platform/design/sim-platform-tech-mockup.html` 与 `docs/sim-platform-design.md` §1），**不要**画成贴合宿主 IDE 的浅色 mockup——产品 UI 是深色工业大屏感。
- 聚焦关键页（产线选择、装配工作台、干涉提示、节拍可视），不必每页都画。
- 设计确认后落一份设计稿资产（可内嵌或存档，高保真稿放 `apps/sim-platform/design/`），→ commit（`docs:` 或 `design:` 前缀，若入仓则 `chore`/`feat` 视改动）。
- **记录**：用户对视觉的否定反馈（如"太丑"）与最终拍板的风格取向 → 记 `.learnings/`（类别 `correction`），防止反复走偏。

### Phase 3 —— 小步实现（红绿驱动）
- **版本/里程碑分支**：一个版本档（如 `0.2.0`）开一条专属 `feat/0.2.0-<名>` 分支承载该里程碑全部小步提交，收尾 merge 回 `main`。
- **保留已合并分支**（用户明确约定）：版本/里程碑分支**合回 main 后不删除**，保留以利于按版本/里程碑归因错误与回溯 diff。特性级小分支可正常删。
- **一个逻辑单元一次提交**；每个逻辑单元做完即过该包 `typecheck` + `test`。
- 核心算法（clearance-core / sim-utils）改动必须带单测，且 **200 件 `runFull<200ms` 性能门禁不得突破**（`docs/TESTING.md`）。
- 前端只经 SimEngine 门面，业务代码禁止直引 `@babylonjs/core`。
- 全栈改动遵循 `senior-fullstack-engineer` 的“契约 -> 后端 -> 前端 -> 编排 -> 集成验证”顺序。
- Web3D 改动遵循 `senior-web3d-engineer` 的资产/材质/光照/相机诊断顺序；跨端 3D 同时执行两套门禁。
- 修 bug 先补能复现的红用例，再改实现转绿。
- **记录**：命令失败 / 算法坑 / 环境坑（如 pnpm 沙箱禁 symlink、vitest 临时文件、strict 索引）→ **即时**记 `.learnings/ERRORS.md` 或 `LEARNINGS.md`（类别 `error` / `knowledge_gap`）；能沉淀成通用规则的在修复后 promote 到 `docs/` 或 `AGENTS.md`。

### Phase 4 —— 合并 / 发版
- 按 `GIT_GUIDE` §3：PR 描述 = 动机/改动/如何验证/关联；**typecheck + test 全绿** 才 merge。
- 更新版本号与 `CHANGELOG.md`，打 `vX.Y.Z` tag（`GIT_GUIDE` §4）。
- **阶段 review（self-improving-agent）**：本里程碑/需求收尾时过一遍 `.learnings/` ——
  - 把已修的条目 `Status: pending → resolved`（补 commit 号）；
  - 识别跨 2+ 任务复现 ≥3 次的模式 → 提 `Priority` 并 promote 成 `docs/`/`AGENTS.md` 的持久规则；
  - 高价值且可复用的解决方案 → 考虑抽成新 skill（见 self-improving-agent §技能抽取）。
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

1. **先问清再动手**：新需求/跨层改动先加载 `grill-me`，产出并确认「需求共识」，不猜需求边界。
2. **文档驱动**：契约/方案改动先落 `docs/` 与 `domain`，不直接改业务码绕过约定。
3. **UI 先出 Workbuddy mockup 再编码**（深色科技扁平风格），不盲写页面。
4. **小步提交**：一个逻辑单元一个 Conventional Commit，main 随时可发布。
5. **门禁**：每包 `typecheck`+`test`；clearance-core 200 件 <200ms；merge 前全仓绿。
6. **边界**：遵守 `ARCHITECTURE.md`（SimEngine 门面、依赖方向、纯算法无 DOM）。
7. **专业路由**：跨端/API 加载 `senior-fullstack-engineer`；3D/GLB 加载 `senior-web3d-engineer`；跨端 3D 两者同时加载。
8. **即时记录**：错误/纠正/知识缺口发生时按 `self-improving-agent` 记入 `.learnings/`，不丢上下文；阶段收尾 review + promote。

---

## 4. 本技能自身迭代

发现本流程有更优做法 / 踩了新坑 → 更新本 `SKILL.md`，并在 `.learnings/LEARNINGS.md` 记一条（`best_practice`），重要变更同步到 `AGENTS.md`（本仓默认按 self-improving-agent 的**团队共享/入库**模式使用 `.learnings/`）。
