import type { OrgRole } from '@prisma/client';

export type Permission =
  | 'read'
  | 'test:write'
  | 'bug:delete'
  | 'project:manage'
  | 'members:manage'
  | 'org:manage'
  | 'audit:read';

const ROLE_PERMISSIONS: Record<OrgRole, readonly Permission[]> = {
  OWNER: ['read', 'test:write', 'bug:delete', 'project:manage', 'members:manage', 'org:manage', 'audit:read'],
  ADMIN: ['read', 'test:write', 'bug:delete', 'project:manage', 'members:manage', 'org:manage', 'audit:read'],
  MEMBER: ['read', 'test:write'],
  VIEWER: ['read'],
};

export const hasPermission = (role: OrgRole, permission: Permission) =>
  ROLE_PERMISSIONS[role].includes(permission);
