# @assemble/storage

**降级仓储层**：服务对持久化介质的唯一抽象。业务只依赖 `Repository<T>` 接口，不直接决定介质；由工厂按配置注入 `memory / file`，未来可替换 MySQL/Redis 而**接口不变**。

> 降级策略见 `docs/ARCHITECTURE.md` §4 —— 连不上中间件时自动回落内存/文件，保证本地一键可跑。

## 核心 API

```ts
interface Repository<T extends { id: string }> {
  list(): Promise<T[]>;
  get(id: string): Promise<T | undefined>;
  upsert(item: T): Promise<T>;
  delete(id: string): Promise<boolean>;
}
```

## 创建方式

```ts
import { createRepo } from '@assemble/storage';

// 按后端 + 数据目录创建（file 落到 <dataDir>/<collection>.json）
const repo = createRepo<MyDoc>({ backend: 'file', dataDir: './.assemble-data' }, 'lines');

// 纯内存（测试/临时）
const memRepo = createMemoryRepo<MyDoc>();
```

## 介质选择

- 显式由环境变量 `ASSEMBLE_STORAGE=memory|file` 或 `StorageFactoryOptions.backend` 决定。
- 生产接真库（MySQL/Redis）时替换对应 `Repository<T>` 实现并统一由工厂创建，业务代码零改动。

## 命令

```bash
pnpm --filter @assemble/storage typecheck
pnpm --filter @assemble/storage build
```
