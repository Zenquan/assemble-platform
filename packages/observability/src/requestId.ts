/**
 * 跨服务链路 request-id 工具。
 *
 * 统一用 `x-request-id` 头透传：网关生成、各服务透传，使一条请求在
 * 前端 → 网关 → 服务 → 下游服务 的日志里串成同一链路。
 */

export const REQUEST_ID_HEADER = 'x-request-id';

/**
 * 生成唯一请求 ID。优先 `crypto.randomUUID()`（Node 19+/现代浏览器均有），
 * 无则回落到「时间戳 + 随机串」。
 */
export function createRequestId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') {
    return c.randomUUID();
  }
  return `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
