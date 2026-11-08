import type { OrgRole } from '@qtm/shared';

// UI hints only; the API enforces every permission independently.
export const canManage = (role: OrgRole | undefined) => role === 'OWNER' || role === 'ADMIN';
export const canWrite = (role: OrgRole | undefined) => role !== undefined && role !== 'VIEWER';
