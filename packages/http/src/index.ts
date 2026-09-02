/**
 * @assemble/http —— 服务统一响应信封。
 * 全仓后端服务统一约定：成功 `{ ok: true, data }`，失败 `{ ok: false, code, message }`。
 * 稳定 `code` 供前端/网关映射与日志检索，不把堆栈抛给客户端。
 */

export interface OkEnvelope<T> {
  ok: true;
  data: T;
}

export interface ErrEnvelope {
  ok: false;
  /** 稳定错误码，如 'NOT_FOUND' / 'VALIDATION_FAILED' */
  code: string;
  message: string;
  /** 附加详情（可选，供诊断/前端提示） */
  detail?: unknown;
}

export type Envelope<T> = OkEnvelope<T> | ErrEnvelope;

export function ok<T>(data: T): OkEnvelope<T> {
  return { ok: true, data };
}

export function err(code: string, message: string, detail?: unknown): ErrEnvelope {
  return { ok: false, code, message, detail };
}

export function isErr<T>(env: Envelope<T>): env is ErrEnvelope {
  return env.ok === false;
}

/** 由错误码推导 HTTP 状态码的简单映射 */
export function errToStatus(code: string): number {
  switch (code) {
    case 'NOT_FOUND':
      return 404;
    case 'VALIDATION_FAILED':
    case 'BAD_REQUEST':
      return 400;
    case 'UNAUTHORIZED':
      return 401;
    case 'FORBIDDEN':
      return 403;
    case 'CONFLICT':
      return 409;
    default:
      return 500;
  }
}
