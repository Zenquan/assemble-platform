/**
 * RBAC 权限矩阵 —— 授权单一事实源。
 *
 * 从 `services/auth-svc/src/rbac.ts` 迁入共享包：gateway（本地鉴权）与 auth-svc
 * （签发/校验）都从这里读同一份矩阵，杜绝两处漂移（见 docs/SECURITY.md §4）。
 */
import type { PermissionAction, Role } from '@assemble/domain';

/** 角色 -> 权限点（与前端路由/接口一一对应） */
export const ROLE_PERMISSIONS: Record<Role, PermissionAction[]> = {
  super_admin: [
    'line:read', 'line:write', 'model:read', 'model:upload',
    'assembly:run', 'assembly:edit', 'interference:run', 'interference:offline',
    'takt:view', 'takt:write', 'user:manage', 'audit:view',
  ],
  production_engineer: [
    'line:read', 'model:read', 'assembly:run', 'interference:run', 'takt:view',
  ],
  simulation_engineer: [
    'line:read', 'line:write', 'model:read', 'model:upload',
    'assembly:run', 'assembly:edit', 'interference:run', 'interference:offline',
    'takt:view', 'takt:write',
  ],
  trainer: ['line:read', 'assembly:run', 'interference:run', 'takt:view'],
  manager: ['line:read', 'model:read', 'assembly:run', 'takt:view', 'audit:view'],
  viewer: ['line:read'],
};

/** 角色允许的权限集（未知角色返回空集） */
export function permissionsFor(role: Role): PermissionAction[] {
  return ROLE_PERMISSIONS[role] ?? [];
}

/** 任一角色拥有该权限即放行 */
export function hasPermission(roles: readonly Role[], permission: PermissionAction): boolean {
  return roles.some((r) => ROLE_PERMISSIONS[r]?.includes(permission) ?? false);
}
