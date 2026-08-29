# Observability

What to look at when a gym rings up, and what should wake somebody at night.

The product writes **one JSON object per line to stdout**. That is the whole
integration surface: no agent to install, no SDK, no vendor. Whatever collects
container logs where GymFlow is deployed — `journald`, Docker's json-file
driver, Loki, CloudWatch, Datadog — already understands it.

## The line

```json
{
  "level": "info",
  "time": "2026-08-29T11:28:31.496Z",
  "event": "api.request",
  "service": "gymflow-admin",
  "env": "production",
  "requestId": "38c958f3-1c60-4e36-9434-0c433e1e462b",
  "route": "/api/member/v1/me",
  "method": "GET",
  "status": 200,
  "ms": 17,
  "memberUserId": "f0324c6b-…",
  "tenantId": "dd1a857a-…"
}
```

| Field       | Meaning                                                                                  |
| ----------- | ---------------------------------------------------------------------------------------- |
| `level`     | `debug` \| `info` \| `warn` \| `error`. Set the floor with `LOG_LEVEL` (default `info`). |
| `event`     | Stable, greppable name. Alert rules key on this, never on prose.                         |
| `requestId` | Ties the line to one HTTP request — see below.                                           |
| `alert`     | Present and `true` on every `error` line. This is the alert predicate.                   |
| `ref`       | The short reference shown to the person on screen.                                       |

### Request ids

Middleware stamps `x-request-id` on every request and echoes it on the
response. An inbound `x-request-id` from a reverse proxy is kept (so the proxy
access log and the application log share one id), but only if it is a
plausible id — 8–64 characters of `[A-Za-z0-9_-]` — so a caller cannot write
punctuation or newlines into the log.

### References

A staff member who hits an unexpected fault sees
_"Something went wrong. Please try again. Reference: 4f2a9c1e."_ A member app
call that faults gets `{"error":"server_error","reference":"4f2a9c1e"}`.
Either way:

```
grep 4f2a9c1e /var/log/gymflow/*.log
```

lands on the `unhandled_error` (or `api.request`) line, which carries the
request id, route, gym and staff user. Ask for the reference first; it turns
"it said something went wrong" into a five-second lookup.

## Events worth knowing

| Event               | Level        | Fires when                                       |
| ------------------- | ------------ | ------------------------------------------------ |
| `api.request`       | info / error | Every member API call. `error` at status ≥ 500.  |
| `unhandled_error`   | error        | A fault reached a screen. Carries `ref`.         |
| `auth.login`        | info         | Staff signed in. `userId`, `tenantId`, `kind`.   |
| `auth.login_failed` | info         | Wrong password, disabled account, suspended gym. |
| `auth.throttled`    | warn         | Login refused before the password was checked.   |

## Alerting

Three rules cover the failure modes that actually reach a customer:

1. **Any error.** `level == "error"` (equivalently `alert == true`). Page on
   more than 5 in 5 minutes; a single one is a ticket, not a page.
2. **Health check.** `GET /api/health` returns `503` when the database is
   unreachable. Poll it every 30s from outside the box. Two consecutive
   failures is a page — that is the whole gym down, at the counter.
3. **Login storm.** `event == "auth.throttled"` more than 20 times in 10
   minutes across distinct `emailHash` values means credential stuffing. A
   handful from one `emailHash` is a receptionist who forgot their password;
   send that to whoever answers the support line, not to on-call.

Latency is worth a dashboard rather than a page: `api.request` carries `ms`,
so p95 per `route` is a one-line query. `/api/member/v1/me` is the one that
matters — it is what the app opens with.

## What is deliberately not in the logs

A gym's member list is the most valuable thing in this database, and logs
leave the machine. The logger enforces two rules, unit-tested in
`packages/core/test/log.test.ts`:

- Values under a key that reads as personal or secret — anything matching
  `password`, `secret`, `token`, `session`, `cookie`, `mobile`, `phone`,
  `email`, `gstin`, `aadhaar`, `dob`, `address`, `hash` — are replaced with
  `[redacted]`. The key stays so the shape of the line does not change.
- Anything that _looks_ like a mobile number, an email address, a GSTIN, or a
  long credential is masked wherever it appears, including inside free text,
  nested objects and error messages, even under an innocent key name.

So names, phone numbers and email addresses never reach the log. Identifiers
do: `tenantId`, `userId`, `memberUserId`. Those are opaque UUIDs, and they are
what makes an investigation possible — resolve them against the database when
you actually need a name, with the access controls that implies.

`emailHash` on the auth events is the first 12 characters of a SHA-256 of the
address. It is enough to see that the same account is being hammered; it is
not enough to recover the address.

## Retention

Logs contain gym and staff identifiers, so they are personal data under the
DPDP Act by association. Keep them 30 days unless there is an open
investigation, and delete on schedule. `audit_logs` in the database — not
these lines — is the permanent record of who changed what; see
[SECURITY.md](SECURITY.md).
