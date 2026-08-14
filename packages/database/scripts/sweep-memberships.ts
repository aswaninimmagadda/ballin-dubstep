/**
 * Daily membership state sweep (run from cron, e.g. 01:00 IST):
 *   1. pending → active   once the start date arrives (pre-sold renewals)
 *   2. active  → expired  once the grace window is over
 *   3. member.status kept in step (with status history rows)
 *
 * Reads/derived statuses are already correct without this — the apps derive
 * live status from dates on every read — but stored states drive list
 * filters and reports, so they are trued up once a day. Dates are evaluated
 * against each tenant's own calendar day, not the server's UTC day.
 */
import pg from 'pg';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

(async () => {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query('BEGIN');

    const activated = await client.query(
      `UPDATE memberships ms SET state = 'active'
       FROM tenants t
       WHERE t.id = ms.tenant_id AND ms.state = 'pending'
         AND ms.start_date <= (now() AT TIME ZONE t.default_timezone)::date
       RETURNING ms.id, ms.tenant_id, ms.member_id`,
    );
    const expired = await client.query(
      `UPDATE memberships ms SET state = 'expired'
       FROM tenants t
       WHERE t.id = ms.tenant_id AND ms.state = 'active'
         AND (ms.end_date + ms.grace_period_days) < (now() AT TIME ZONE t.default_timezone)::date
       RETURNING ms.id, ms.tenant_id, ms.member_id`,
    );

    // Member status follows the memberships that remain live. The FROM
    // self-join exposes the pre-update status for the history row.
    const memberUp = await client.query(
      `WITH changed AS (
         UPDATE members m SET status = 'active'
         FROM members old
         WHERE old.id = m.id AND m.status IN ('expired','pending_activation')
           AND EXISTS (SELECT 1 FROM memberships WHERE member_id = m.id AND state = 'active')
         RETURNING m.tenant_id, m.id, old.status AS from_status
       )
       INSERT INTO member_status_history (tenant_id, member_id, from_status, to_status, reason)
       SELECT tenant_id, id, from_status, 'active', 'daily sweep' FROM changed
       RETURNING member_id`,
    );
    const memberDown = await client.query(
      `WITH changed AS (
         UPDATE members m SET status = 'expired'
         FROM members old
         WHERE old.id = m.id AND m.status IN ('active','pending_activation')
           AND EXISTS (SELECT 1 FROM memberships WHERE member_id = m.id)
           AND NOT EXISTS (SELECT 1 FROM memberships
                           WHERE member_id = m.id AND state IN ('active','frozen','pending'))
         RETURNING m.tenant_id, m.id, old.status AS from_status
       )
       INSERT INTO member_status_history (tenant_id, member_id, from_status, to_status, reason)
       SELECT tenant_id, id, from_status, 'expired', 'daily sweep' FROM changed
       RETURNING member_id`,
    );

    await client.query('COMMIT');
    console.log(
      `Sweep complete: ${activated.rowCount} membership(s) activated, ` +
        `${expired.rowCount} expired; member status: ${memberUp.rowCount} → active, ` +
        `${memberDown.rowCount} → expired.`,
    );
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    await client.end();
  }
})().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
