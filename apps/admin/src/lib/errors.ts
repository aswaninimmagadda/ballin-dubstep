/**
 * Convert internal failures into user-safe messages. Raw driver errors
 * (PostgREST/pg codes) must never reach the UI.
 */
import { randomBytes } from 'node:crypto';
import { log, logWithRequest } from './log';

export class UserFacingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UserFacingError';
  }
}

export function toUserMessage(err: unknown): string {
  if (err instanceof UserFacingError) return err.message;
  const message = err instanceof Error ? err.message : String(err);
  if (/duplicate key.*idem/i.test(message)) {
    return 'This action was already recorded. Refresh to see the result.';
  }
  if (/memberships_one_running_per_member|memberships_one_pending_per_member/.test(message)) {
    return 'This member already has an active membership. Renew or cancel it instead.';
  }
  if (/members_tenant_mobile_unique/.test(message)) {
    return 'A member with this mobile number already exists.';
  }
  if (/membership_plans_tenant_id_name_key|addon_packages_tenant_id_name_key/.test(message)) {
    return 'A plan or package with this name already exists. Change its price instead of creating a duplicate, or pick a different name.';
  }
  if (/trainer_sessions_no_double_book/.test(message)) {
    return 'The trainer already has a session at this time.';
  }
  if (/row-level security|insufficient_privilege|permission denied/i.test(message)) {
    return 'You do not have permission to do this.';
  }
  if (/append-only|immutable/.test(message)) {
    return 'Financial records cannot be edited. Record a refund or adjustment instead.';
  }
  // Anything left is a real fault. The staff member gets a generic message —
  // driver text tells an attacker about the schema — but it carries a
  // reference, and that reference is in the log line with the request id, the
  // route and the gym. "It said something went wrong" used to be the end of
  // the investigation; now it is the start of one.
  const ref = randomBytes(4).toString('hex');
  logWithRequest('error', 'unhandled_error', { ref, error: message });
  return `Something went wrong. Please try again. Reference: ${ref}`;
}

/**
 * Record a fault that never reaches a screen — a background job, a webhook, a
 * route that answers with a status code instead of a message.
 */
export function logFailure(
  event: string,
  err: unknown,
  fields: Record<string, unknown> = {},
): void {
  log.error(event, { ...fields, error: err instanceof Error ? err.message : String(err) });
}
