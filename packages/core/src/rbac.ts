import type { Permission, SystemRoleKey } from '@gymflow/types';
import { PERMISSIONS } from '@gymflow/types';

/**
 * Default permission sets for system roles. Stored in the database at tenant
 * creation (roles are rows, not code) — this map only seeds them and serves
 * as the documented baseline. Custom roles are tenant-defined rows.
 */
export const SYSTEM_ROLE_PERMISSIONS: Record<Exclude<SystemRoleKey, 'member'>, Permission[]> = {
  owner: [...PERMISSIONS],
  branch_manager: [
    'members.view',
    'members.create',
    'members.edit',
    'members.export',
    'memberships.sell',
    'memberships.renew',
    'memberships.freeze',
    'memberships.cancel',
    'plans.view',
    'plans.manage',
    'payments.view',
    'payments.record',
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
    'reports.export',
    'staff.view',
    'settings.view',
    'audit.view',
    'import.run',
    'notifications.manage',
  ],
  receptionist: [
    'members.view',
    'members.create',
    'members.edit',
    'memberships.sell',
    'memberships.renew',
    'plans.view',
    'payments.view',
    'payments.record',
    'discounts.apply',
    'promotions.view',
    'leads.view',
    'leads.manage',
    'attendance.view',
    'attendance.checkin',
    'trainers.view',
    // Receptionists sell PT packages at the desk (spec scenario 1).
    'pt.view',
    'pt.manage',
  ],
  trainer: [
    'members.view',
    'attendance.view',
    'attendance.checkin',
    'trainers.view',
    'pt.view',
    'pt.manage',
  ],
  accountant: [
    'members.view',
    'payments.view',
    'payments.record',
    'payments.refund',
    'plans.view',
    'reports.view',
    'reports.financial',
    'reports.export',
    'audit.view',
  ],
};

/** The one permission check. UI and API both call this — never role names. */
export function hasPermission(granted: ReadonlySet<string>, needed: Permission): boolean {
  return granted.has(needed);
}

export function hasAnyPermission(granted: ReadonlySet<string>, needed: Permission[]): boolean {
  return needed.some((p) => granted.has(p));
}

export function assertPermission(granted: ReadonlySet<string>, needed: Permission): void {
  if (!hasPermission(granted, needed)) {
    const err = new Error(`Missing permission: ${needed}`) as Error & { code: string };
    err.code = 'FORBIDDEN';
    throw err;
  }
}
