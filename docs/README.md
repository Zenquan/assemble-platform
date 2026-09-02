# docs —— 工程文档导航

`assemble-platform/` 的文档集中在 `docs/`。按「先读哪份」排序：

| 文档 | 内容 | 何时读 |
|------|------|--------|
| `产线3D装配仿真平台-工业级Web3D技术方案.md` | 产品/业务级完整方案（11 章：场景→选型→实施→性能→架构→安全→监控→质量→里程碑） | 了解项目为什么这么做、整体蓝图 |
| `ARCHITECTURE.md` | **技术架构设计**：Monorepo 分层、模块边界、SimEngine 门面、前后端干涉算法协同、目录规约 | 动手写代码前必读，维护模块边界 |
| `VERSIONING.md` | 版本计划与策略（SemVer + 版本演进路线 + 各阶段目标） | 判断当前做到哪、下一步版本目标 |
| `CODE_STYLE.md` | 前后端代码风格/命名/结构/错误处理/工程化约定 | 每次提交前对照 |
| `GIT_GUIDE.md` | Git 分支模型 / Conventional Commits / PR / tag 发版规则 | 每次提交/开分支前对照 |
| `TESTING.md` | 测试策略：分层/类型/性能基准门禁/提交门禁 | 动手改核心算法前必读 |
| `sim-platform-design.md` | sim-platform 关键页（产线选择/装配工作台）Workbuddy mockup 设计稿说明 | 0.2.x 落地前端组件前必读 |

> 根目录 `CHANGELOG.md` 记录版本变更历史（Keep a Changelog，发布流程详见 `VERSIONING.md`）。

## 文档间关系

```
技术方案(业务蓝图)
   │  拆解版本演进
   ▼
VERSIONING.md ──► 把蓝图切成可交付的版本里程碑
   │
   ├──► ARCHITECTURE.md   本版本怎么搭（结构/边界）
   ├──► CODE_STYLE.md     代码怎么写（一致）
   └──► GIT_GUIDE.md      变更怎么管（可追溯）
```

> 约定：`*.md` 文档命名用大写 + 下划线（如 `CODE_STYLE.md`）；业务/方案类保留中文标题文档。图片 `assets/` 或与引用文档同目录。
