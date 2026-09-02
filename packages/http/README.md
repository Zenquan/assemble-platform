# @assemble/http

后端服务**统一响应信封**。全仓服务一致约定：成功 `{ ok: true, data }`，失败 `{ ok: false, code, message }`；稳定 `code` 供前端/网关映射与日志检索，**不把堆栈抛给客户端**。

## API

```ts
import { ok, err, isErr, errToStatus, type Envelope } from '@assemble/http';

const success: Envelope<User> = ok({ id: 'u1', name: 'x' });
const failure: Envelope<User> = err('NOT_FOUND', '产线不存在');

if (isErr(result)) {
  ctx.status(errToStatus(result.code)); // 错误码 → HTTP 状态
}
```

## 错误码约定

| code | HTTP |
|------|------|
| `NOT_FOUND` | 404 |
| `VALIDATION_FAILED` / `BAD_REQUEST` | 400 |
| `UNAUTHORIZED` | 401 |
| `FORBIDDEN` | 403 |
| `CONFLICT` | 409 |
| 其它 | 500 |

## 命令

```bash
pnpm --filter @assemble/http typecheck
pnpm --filter @assemble/http build
```
