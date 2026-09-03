# HARDCODE_AUDIT —— 硬编码审计与治理

> 审计范围：`apps/`、`packages/`、`services/`、`scripts/`、`deploy/` 中的生产代码与工程脚本。测试夹具和演示种子数据也检查，但不因“字面量存在”而机械删除。

## 1. 判定标准

| 类别 | 处理规则 | 示例 |
|------|----------|------|
| 业务数据/分支 | 禁止散落在前端或算法实现，迁移到后端契约/配置 | 按 `line.kind` 合成 BOM、固定资产组合 |
| 环境地址/路径 | 必须支持环境变量或从项目根推导 | 服务 URL、端口、用户绝对路径 |
| 重复清单 | 只保留一个共享事实源 | GLB 资产 id 白名单 |
| 调优参数 | 提取为有语义的常量并写明依据 | 轮询周期、相机 framing 系数、拖拽吸附半径 |
| API 路由 | 作为稳定协议常量允许保留，调用端集中封装 | `/lines/:id/bom`、`/model/glb/:file` |
| 测试/种子数据 | 允许保留，但必须局限在 fixture/seed，不能驱动生产分支 | 三条演示流水线、测试 part id |
| 标准数学/格式常量 | 允许保留，必要时命名 | `3600` 秒/小时、GLB magic、角度转弧度 |

## 2. 本轮发现与处理

| 风险 | 位置 | 处理 |
|------|------|------|
| 高 | `engine/babylon.ts` 的 `buildSyntheticBoxes/buildSyntheticBom/CreateBox` 可见装配件 | 删除，改为后端 BOM + model-svc GLB；仅保留不可见代理 |
| 高 | `engine/bomtree.ts` round-robin 工位归组 | 删除，使用 `AssemblyStep.stationId` |
| 高 | 前端按 `line.kind` 决定装配几何 | 删除，所有产线统一消费 BOM |
| 高 | GLB 资产 id 在 domain/model-svc/frontend 重复维护 | 收敛到 `@assemble/domain` 导出的资产清单与类型 |
| 中 | Vite 后端目标写死 `127.0.0.1:710x` | 改为 `env` 可覆盖并保留本地默认值 |
| 中 | `scripts/dev.mjs` 服务主机、端口与 URL 拼接散落 | 集中成运行时配置并支持环境变量覆盖 |
| 中 | `scripts/gltf-gen/measure_glb.mjs` 写死个人绝对路径 | 改为相对项目根推导或参数输入 |
| 中 | GLB 预览/量测脚本重复资产清单并固定监听主机 | 改为扫描资产目录/接受命令参数，监听主机支持环境变量覆盖 |
| 中 | Workbench 的轮询周期、节拍可用率直接写字面量 | 提取为命名常量 |
| 低 | 相机、光照、材质、framing 数值 | 保留为渲染调优常量，集中命名并注明用途；不外部配置化 |
| 低 | service `PORT/HOST` 默认值 | 已支持环境变量，默认值属于本地开发约定；保留 |
| 低 | tests 与 `buildSeedLines()` 中的 id/名称/节拍 | 属测试与演示 fixture；保留在单一 seed 模块，不进入前端分支 |

## 3. 持续门禁

- 新增跨端业务数据前先判断是否应进入 `@assemble/domain` 或后端配置。
- 禁止提交 `/Users/<name>/...`、`C:\\Users\\<name>\\...` 等个人绝对路径。
- 新增后端服务消费时，同时检查 Vite proxy、`scripts/dev.mjs` 与 `AGENTS.md`。
- Code review 搜索 `localhost`、`127.0.0.1`、固定端口、`line.kind ===`、绝对路径及重复枚举。
- 审计目标是消除隐式依赖和重复事实源，不是消灭所有数字与字符串字面量。
