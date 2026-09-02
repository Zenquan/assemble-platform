# Feature Requests

Capabilities requested by the user.

> 记录用户提出但尚未落地、或值得后续排期的能力。格式遵循 `.agent/skills/self-improving-agent`。

---

## [FEAT-20260902-001] services_install_and_runtime_verify

**Logged**: 2026-09-02T23:00:00+08:00
**Priority**: high
**Status**: resolved
**Resolution**: 2026-09-02T23:40:00+08:00 on branch feat/0.2.0-services-runtime
**Area**: backend

### Requested Capability
把 services/ 下 5 个后端服务（assembly/interference/model/takt/auth）跑通：装依赖 + build + smoke run（healthz 与算法调用），并在 0.2.x 补上服务 README。

### User Context
5 服务代码已在仓内（0.1.x 末尾铺完），但依赖未装/未 build，属于"代码写了但没验证可运行"的悬空状态。

### Complexity Estimate
medium

### Suggested Implementation
按 AGENTS.md 的 pnpm hoisted 命令逐服务 install → `tsc -b` → 起服务 curl `/healthz`；assembly-svc/interference-svc 验证调 clearance-core。

### Metadata
- Frequency: first_time
- Related Features: assembly-svc, interference-svc, model-svc, takt-svc, auth-svc

---

## [FEAT-20260902-002] sim_platform_vue_skeleton

**Logged**: 2026-09-02T23:00:00+08:00
**Priority**: medium
**Status**: resolved
**Resolution**: 2026-09-03T00:10:00+08:00 on branch feat/0.2.0-sim-platform（SimEngine 门面 + 产线选择页就绪；装配工作台为占位；Babylon 接入与清洁就绪产线为下一轮见 FEAT-20260903-001）
**Area**: frontend

### Requested Capability
照 `apps/sim-platform/design/sim-platform-tech-mockup.html` 深色科技稿，搭 sim-platform 前端骨架（Vue3 + Babylon 经 SimEngine 门面），含产线选择页 / 装配工作台。

### User Context
设计稿已定稿落仓，等待落地成可运行前端组件（0.2.x 单产线 Demo 出口）。

### Complexity Estimate
complex

### Suggested Implementation
按 workflow Phase 3 小步实现：SimEngine 门面 → 产线选择页 → 装配工作台；色板抄自 design 稿 CSS 变量。

### Metadata
- Frequency: first_time
- Related Features: sim-platform

---

---

## [FEAT-20260903-001] clean_ready_line_seed

**Logged**: 2026-09-03T00:10:00+08:00
**Priority**: low
**Status**: pending
**Area**: data

### Requested Capability
在 interference-svc 种子几何或 assembly-svc 产线中，引入一条「装配良好、离线预检 0 干涉」的产线（例如 `kind=optimized` 或新启一条启用冷链但几何稀疏），使产线选择页能同时呈现 design 稿 B1「就绪·无干涉(绿)」与 B2「待检修·干涉告警(红)」两种真实状态。

### User Context
现 FEAT-002 落地后，产线选择页两端 (`sorting` / `fresh-cut`) 种子几何（synthesizePartsForLine 的 cluster+jitter 策略）确定性命中 0.75·partCount 件干涉，两卡均显示「待检修·135 干涉」。绿态派生态由单测锁定（deriveHealth 0→ready），但 E2E 视觉缺一绿色就绪卡。设计稿页面 A 的 B1/B2 双态对照是 demo 必要组成。

### Complexity Estimate
small

### Suggested Implementation
两个走法任选其一：
  (a) `synthesizePartsForLine` 接收 lineKind 时，对 `cold-chain` 或新 `optimized` kind 改用全稀疏无 jitter 布局（hitCount 始终 0），assembly-svc 种子加一条启用 cold-chain 产线；与现 `kind ∈ {sorting, fresh-cut}` 不冲突。
  (b) 在 assembly-svc 注入一条 BOM 显式声明 0 干涉的产线（前端跳过预检直接 ready），需新增领域字段 `forceReady: boolean` 或等价 precheck-skip 标记。

### Metadata
- Frequency: first_time
- Related Features: sim-platform, interference-svc, assembly-svc
