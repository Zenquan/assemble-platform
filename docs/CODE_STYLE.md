# CODE_STYLE —— 前后端代码风格规范

> 本仓库所有代码的**统一标准**。写代码与评审都以它为准。目录结构约定见 `ARCHITECTURE.md`。

## 1. TypeScript 基线（全仓库适用）

由根 `tsconfig.base.json` 强制，不放松：

- `strict: true`
- `noUncheckedIndexedAccess: true` —— **索引访问可能 undefined，须显式处理**（数组遍历多用 `for..of` 或判空）
- `noImplicitOverride: true`
- `target/module: ESNext`，`moduleResolution: Bundler`
- `noEmit` 于 typecheck；构建用各包 `tsconfig` 开启 `outDir: dist`

```ts
// 索引访问：必须处理 undefined
const axis = obb.axes[i];      // 类型 Vec3 | undefined
if (!axis) continue;            // 显式判空（clearance-core/obbSat 已用此模式）
```

## 2. 命名约定

| 类别 | 规则 | 示例 |
|------|------|------|
| 目录 | 小写 + 连字符 `-` | `clearance-core/`, `sim-platform/` |
| 文件 | 小驼峰；聚合/入口可用 `index` | `detector.ts`, `obbSat.ts`, `index.ts` |
| TS 类型/接口 | PascalCase，无 `I` 前缀 | `ProductionLine`, `InterferenceReport` |
| 类 | PascalCase | `ClearanceDetector`, `MemoryFileRepository` |
| 函数/变量/字段 | camelCase | `runFull()`, `broadCullRatio` |
| 常量（模块级不可变） | `UPPER_SNAKE` | `const DEFAULT_SEVERITY` |
| 领域枚举值 | `snake_case` | `'coincident'`, `'offline'`（与后端/数据口径一致） |
| 组件文件 | PascalCase | `AssemblyViewer.vue` |
| 组件名(引用) | PascalCase | `<AssemblyViewer/>` |

## 3. 结构规约

### 纯库（packages/*）
- 单一职责文件，`src/index.ts` 聚合导出（见 `ARCHITECTURE.md` §6）。
- **纯算法/数学代码禁止 `any`**；几何用 `readonly` 元组表达向量（`Vec3 = readonly [number,number,number]`），不可变、可跨端共享。

### 后端服务（services/*，Fastify 规划）
- 每服务 `src/` 下建议：`app.ts`(构建) / `server.ts`(监听) / `routes/*` / `repositories/*` / `domain`(引共享)。
- **统一响应信封**：成功 `{ ok: true, data }`，失败 `{ ok: false, code, message }`；不裸抛。
- 必须提供 `GET /healthz`（含存活与依赖状态）。
- 服务内不 catch 后吞错；交由统一错误中间件，保留原始 `cause`。

### 前端（apps/*，Vue3 `<script setup>`）
- 页面组件放 `views/`，可复用组件 `components/`，引擎封装 `engine/`，状态 `stores/`(Pinia)，请求 `api/`。
- **仿真页面的大逻辑尽量下推 store/engine，组件保持薄**，便于测试。
- API 返回类型必须显式声明（源自 `@assemble/domain`），不 `any`。

## 4. import 排序（lint 目标）

统一顺序，lint 校验：
1. Node 内置 / 第三方
2. `@assemble/*` 工作区包
3. 相对路径（`./` `../`）

```ts
import { promises as fs } from 'node:fs';          // 1 内置
import Fastify from 'fastify';                       // 1 第三方
import type { OBB } from '@assemble/domain';         // 2 workspace
import { Bvh } from './bvh.js';                      // 3 相对
```

> 相对导入**保留 `.js` 扩展名**（ESM + Bundler 解析需一致）。

## 5. 类型使用

- **优先 `interface`** 定义对象契约、`type` 定义联合/元组/映射。
- 向量元组用 `readonly [number, number, number]`，禁止可变裸数组当向量传参。
- 领域对象透传用共享 `@assemble/domain` 类型；**不要**在各端重复声明同一形状。
- 可选字段显式 `?`；判别联合用字面量字段（如 `phase: 'narrow' | 'broad'`）。

```ts
type Axis = 0 | 1 | 2;              // 元组可读性提示，禁用 number 裸索引常量
```

## 6. 错误处理

- 业务可预期失败用**返回值/判别结果**表达（如 `get(): T | undefined`）。
- 库层**抛异常**仅用于编程错误（前置条件失败），且带清晰 message。
- 服务层错误含稳定 `code`，便于前端映射与日志检索，不把堆栈直接吐给客户端。
- 禁止 `catch {}` 空吞；至少要 `log` 或 `rethrow`。

```ts
// 好：可预期缺失用 undefined
async getLine(id: string): Promise<ProductionLine | undefined>

// 好：前置校验主动抛
if (axes.length !== 3) throw new Error(`OBB 需要 3 个正交轴，got ${axes.length}`);
```

## 7. 测试风格（vitest）

- 单测放各包 `test/*.test.ts`，走根 `vitest.config.ts`。
- 描述用中文句子（what + 期望），结构：`describe('模块/类')` → `it('某行为')`。
- **性能/基准**用例给明确阈值断言（如 `expect(res.elapsedMs).toBeLessThan(200)`），作为性能回归门禁。
- 测试 import 一律走包根导出，验证公共接口而非内部私有实现。

## 8. 格式化工具（目标配置）

- 代码格式：**Prettier**（`printWidth 90`, `semi true`, `singleQuote true`）。
- Lint：**ESLint** + `typescript-eslint` + `vue/eslint-plugin-vue`（前端）。
- 提交前跑 `typecheck`；CI 门禁：`lint → typecheck → test`。
> 工具依赖与具体配置随版本进度在 0.2.x 一次性接入；本文先定"写代码时的自觉标准"。
