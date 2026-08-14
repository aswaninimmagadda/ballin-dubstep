/**
 * Convert internal failures into user-safe messages. Raw driver errors
 * (PostgREST/pg codes) must never reach the UI.
 */

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
  if (/trainer_sessions_no_double_book/.test(message)) {
    return 'The trainer already has a session at this time.';
  }
  if (/row-level security|insufficient_privilege|permission denied/i.test(message)) {
    return 'You do not have permission to do this.';
  }
  if (/append-only|immutable/.test(message)) {
    return 'Financial records cannot be edited. Record a refund or adjustment instead.';
  }
  // Log the technical detail server-side; show a generic message.
  console.error('[gymflow] unexpected error:', message);
  return 'Something went wrong. Please try again.';
}
