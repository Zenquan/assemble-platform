# Feature Requests

Capabilities requested by the user.

> 记录用户提出但尚未落地、或值得后续排期的能力。格式遵循 `.agent/skills/self-improving-agent`。

---

## [FEAT-20260902-001] services_install_and_runtime_verify

**Logged**: 2026-09-02T23:00:00+08:00
**Priority**: high
**Status**: pending
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
**Status**: pending
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
