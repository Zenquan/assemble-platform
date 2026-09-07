/**
 * 鉴权 / RBAC 领域模型 —— 对应方案 7.1（AuthSvc / OIDC + RBAC/ABAC）
 */

export type Role =
  | 'super_admin'
  | 'production_engineer'
  | 'simulation_engineer'
  | 'trainer'
  | 'manager'
  | 'viewer';

/** 资源动作（与前端路由/接口权限点一一对应） */
export type PermissionAction =
  | 'line:read'
  | 'line:write'
  | 'model:read'
  | 'model:upload'
  | 'assembly:run'
  | 'assembly:edit'
  | 'interference:run'
  | 'interference:offline'
  | 'takt:view'
  | 'takt:write'
  | 'user:manage'
  | 'audit:view';

export interface AuthPrincipal {
  /** OIDC subject */
  userId: string;
  name: string;
  roles: Role[];
  permissions: PermissionAction[];
  /** ABAC 额外属性：所属产线集合（数据级授权） */
  scopedLineIds?: string[];
  tokenType: 'bearer';
  issuedAt: string;
  expiresAt: string;
}

export interface AuditLogEntry {
  id: string;
  ts: string;
  actorId: string;
  action: string;
  resource: string;
  detail: string;
  ip?: string;
  /** append-only 哈希链：本条摘要（SHA-256），防篡改（见 @assemble/security） */
  hash?: string;
  /** append-only 哈希链：前一条摘要（首条为 GENESIS） */
  prevHash?: string;
}
