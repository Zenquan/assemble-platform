/**
 * @assemble/security —— 轻量安全库（纯 TS，零外部依赖，仅 node:crypto）。
 *
 * 提供 HS256 JWT 签发/验证、AES-256-GCM 字段加密、RBAC 授权矩阵、append-only
 * 审计哈希链，是 M4「安全、鉴权、审计与加密」方向（见 docs/SECURITY.md）的共享
 * 安全事实源。auth-svc（签发）与 gateway（验证/鉴权）同源复用。
 */
export * from './jwt.js';
export * from './crypto.js';
export * from './rbac.js';
export * from './audit.js';
