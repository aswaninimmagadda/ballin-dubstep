-- Review round 2:
--  * Refunds gain an idempotency key so a double-submitted refund form can
--    never record twice (payments/memberships already had this).
--  * Trainers gain the availability note field required by the brief.

ALTER TABLE refunds ADD COLUMN idempotency_key text;
CREATE UNIQUE INDEX refunds_idem_unique ON refunds(tenant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

ALTER TABLE trainers ADD COLUMN availability text;
