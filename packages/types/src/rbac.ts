import type { UUID, ISODateTime } from './ids.js';

/**
 * The full permission catalog. Permissions are granular strings grouped by
 * module. Roles are sets of permissions; UI and API must check permissions,
 * never role names.
 */
export const PERMISSIONS = [
  'members.view',
  'members.create',
  'members.edit',
  'members.delete',
  'members.export',
  'members.merge',
  'members.health.view',
  'memberships.sell',
  'memberships.renew',
  'memberships.freeze',
  'memberships.cancel',
  'memberships.override',
  'plans.view',
  'plans.manage',
  'payments.view',
  'payments.record',
  'payments.refund',
  'discounts.apply',
  'discounts.approve',
  'promotions.view',
  'promotions.manage',
  'leads.view',
  'leads.manage',
  'attendance.view',
  'attendance.checkin',
  'trainers.view',
  'trainers.manage',
  'pt.view',
  'pt.manage',
  'reports.view',
  'reports.financial',
  'reports.export',
  'staff.view',
  'staff.manage',
  'settings.view',
  'settings.manage',
  'audit.view',
  'import.run',
  'notifications.manage',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/** Built-in role keys. Tenants may also create custom roles. */
export type SystemRoleKey =
  | 'owner'
  | 'branch_manager'
  | 'receptionist'
  | 'trainer'
  | 'accountant'
  | 'member';

export interface Role {
  id: UUID;
  tenantId: UUID | null; // null = platform-defined system role template
  key: string;
  name: string;
  isSystem: boolean;
  createdAt: ISODateTime;
}

export type UserKind = 'platform_admin' | 'staff' | 'member';

export interface User {
  id: UUID;
  kind: UserKind;
  tenantId: UUID | null; // null only for platform admins
  email: string | null;
  phone: string | null;
  displayName: string;
  language: 'en' | 'te';
  isActive: boolean;
  lastLoginAt: ISODateTime | null;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export interface StaffBranchAccess {
  userId: UUID;
  branchId: UUID;
}
