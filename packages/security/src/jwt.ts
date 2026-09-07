/**
 * 轻量 JWT —— HS256（对称 HMAC）签发与验证，零外部依赖（只用 node:crypto）。
 *
 * 与 OBSERVABILITY 方向「轻量自研」口径一致：当前无企业 OIDC IdP 可接，HS256 +
 * env 注入密钥即可自证安全；未来接 OIDC 切 RS256 时，仅替换本模块实现，
 * 调用方（auth-svc 签发 / gateway 验证）接口不变。
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

const DEFAULT_TTL_SECONDS = 3600; // 短效 Access Token，默认 1h

function b64url(input: string | Buffer): string {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input, 'utf8');
  return buf.toString('base64url');
}

function sign(input: string, secret: string): string {
  return createHmac('sha256', secret).update(input).digest('base64url');
}

export interface SignJwtOptions {
  /** 有效期秒数（默认 3600） */
  ttlSeconds?: number;
  /** 签发者（写入 iss claim） */
  issuer?: string;
}

export interface VerifyJwtOptions {
  /** 期望的签发者（不传则不校验 iss） */
  issuer?: string;
  /** 校验用当前时间（测试注入；默认取系统时间） */
  nowSeconds?: number;
}

/** 签发 HS256 JWT。payload 为任意 JSON 可序列化对象，自动补 iat/exp。 */
export function signJwt(
  payload: Record<string, unknown>,
  secret: string,
  options: SignJwtOptions = {},
): string {
  const now = Math.floor(Date.now() / 1000);
  const claims: Record<string, unknown> = {
    ...payload,
    iat: now,
    exp: now + (options.ttlSeconds ?? DEFAULT_TTL_SECONDS),
  };
  if (options.issuer !== undefined) claims['iss'] = options.issuer;

  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify(claims));
  const signature = sign(`${header}.${body}`, secret);
  return `${header}.${body}.${signature}`;
}

/** 验证 HS256 JWT：验签（常量时间）、验期（exp/iat）、可选验 iss。失败抛错。 */
export function verifyJwt(
  token: string,
  secret: string,
  options: VerifyJwtOptions = {},
): Record<string, unknown> {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('JWT 格式非法');
  const [header, body, signature] = parts as [string, string, string];

  const expected = sign(`${header}.${body}`, secret);
  const sigBuf = Buffer.from(signature);
  const expectedBuf = Buffer.from(expected);
  if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) {
    throw new Error('JWT 签名校验失败');
  }

  let claims: Record<string, unknown>;
  try {
    claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Record<string, unknown>;
  } catch {
    throw new Error('JWT 载荷非法');
  }

  const now = options.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (typeof claims['exp'] === 'number' && claims['exp'] <= now) throw new Error('JWT 已过期');
  if (typeof claims['iat'] === 'number' && claims['iat'] > now) throw new Error('JWT 尚未生效');
  if (options.issuer !== undefined && claims['iss'] !== options.issuer) {
    throw new Error('JWT 签发者不匹配');
  }
  return claims;
}

/**
 * 从 `Authorization` 头提取 Bearer token（大小写不敏感）。
 * 无该头或格式非法时返回 undefined，供 auth-svc / gateway 统一复用。
 */
export function extractBearerToken(authorization: string | undefined): string | undefined {
  if (!authorization) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
  return match?.[1]?.trim() || undefined;
}

/** 开发/测试环境默认密钥（本地自证安全；生产必须显式 AUTH_JWT_SECRET） */
export const DEV_JWT_SECRET = 'assemble-dev-insecure-jwt-secret-000000';

export interface ResolvedJwtSecret {
  secret: string;
  isProd: boolean;
  /** 是否回退到了开发默认密钥（调用方应告警） */
  usingDev: boolean;
}

/**
 * 解析 JWT 签名密钥。auth-svc（签发）与 gateway（验证）共用同一份规则，杜绝漂移：
 * - 显式提供 `explicit`（AUTH_JWT_SECRET）→ 使用；生产环境要求 ≥32 字节；
 * - 生产未显式配置或过短 → 抛错（fail-fast，拒绝以弱密钥运行）；
 * - 开发未配置 → 回退 `DEV_JWT_SECRET`（`usingDev=true`，调用方告警）。
 */
export function resolveJwtSecret(
  opts: { nodeEnv?: string; explicit?: string } = {},
): ResolvedJwtSecret {
  const env = opts.nodeEnv ?? 'development';
  const isProd = env === 'production';
  const explicit = opts.explicit;
  if (explicit) {
    if (isProd && explicit.length < 32) {
      throw new Error('AUTH_JWT_SECRET 长度 < 32 字节，生产环境拒绝');
    }
    return { secret: explicit, isProd, usingDev: false };
  }
  if (isProd) {
    throw new Error('生产环境必须显式配置 AUTH_JWT_SECRET（≥32 字节）');
  }
  return { secret: DEV_JWT_SECRET, isProd, usingDev: true };
}
