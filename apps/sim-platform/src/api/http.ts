/**
 * 前端 HTTP 客户端 —— 解析后端统一信封（@assemble/http 约定）。
 *
 * 成功 `{ ok: true, data }`，失败 `{ ok: false, code, message }`。
 * 所有返回都做运行时判别，业务不裸 any；错误聚合成带 code 的可读错误。
 */

export interface HttpErrorShape {
  code: string;
  message: string;
  status: number;
}

/** 通用请求错误（网络失败 / 非 2xx / 信封失败统一收敛） */
export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(shape: HttpErrorShape) {
    super(`[${shape.code}] ${shape.message}`);
    this.code = shape.code;
    this.status = shape.status;
    this.name = 'ApiError';
  }
}

interface EnvelopeLike<T> {
  ok: boolean;
  data?: T;
  code?: string;
  message?: string;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** 是否带凭证（默认不带；后续网关鉴权再开） */
  headers?: Record<string, string>;
}

async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const method = opts.method ?? 'GET';
  const headers: Record<string, string> = { Accept: 'application/json', ...opts.headers };
  let body: string | undefined;
  if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }

  let res: Response;
  try {
    res = await fetch(path, { method, headers, body });
  } catch (cause) {
    throw new ApiError({ code: 'NETWORK_ERROR', message: '无法连接服务，请确认后端已启动', status: 0 });
  }

  const text = await res.text();
  if (!text) {
    if (res.ok) return undefined as T;
    throw new ApiError({ code: 'EMPTY_RESPONSE', message: `服务返回空响应 (${res.status})`, status: res.status });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ApiError({ code: 'BAD_JSON', message: `响应非合法 JSON (${res.status})`, status: res.status });
  }

  const env = parsed as EnvelopeLike<T>;
  if (!res.ok || env.ok === false) {
    throw new ApiError({
      code: env.code ?? 'HTTP_ERROR',
      message: env.message ?? `请求失败 (${res.status})`,
      status: res.status,
    });
  }
  return env.data as T;
}

export const http = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body: unknown) => request<T>(path, { method: 'POST', body }),
};
