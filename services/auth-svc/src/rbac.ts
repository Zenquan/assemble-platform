import type { PermissionAction, Role } from '@assemble/domain';

/** RBAC 权限矩阵：角色 -> 权限点（与前端路由/接口一一对应） */
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

export function permissionsFor(role: Role): PermissionAction[] {
  return ROLE_PERMISSIONS[role] ?? [];
}
