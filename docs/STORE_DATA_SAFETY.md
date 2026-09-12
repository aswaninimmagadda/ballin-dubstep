# Store privacy declarations (Play Data Safety · Apple App Privacy)

Both stores ask the same underlying question in two different forms: what
does the app collect, who gets it, and can the user have it deleted. This
page holds the answers **and the evidence for each**, so that the next
person can re-derive them instead of trusting a form filled in once.

Scope: the **member app** (`apps/member`). The staff admin app is a web
PWA and is not submitted to either store, so neither form covers it.

Getting these wrong is the most common cause of a Play release being
pulled after the fact — a mismatch between the declaration and what the
binary actually does. Everything below was read out of the code on
2026-09-12, at commit `814a51d`.

## The evidence

| Question                        | Answer                                                                                                                                       |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Third-party SDKs                | **None.** No analytics, crash reporting, ads or attribution. `apps/member/package.json` is Expo core + `react-native-svg`/`qrcode-svg` only. |
| Permissions in the shipped APK  | **`INTERNET` and `VIBRATE` only.** Verified in the generated `AndroidManifest.xml`.                                                          |
| Permissions explicitly stripped | `READ_EXTERNAL_STORAGE`, `WRITE_EXTERNAL_STORAGE`, `SYSTEM_ALERT_WINDOW` — present from transitive deps, removed via `blockedPermissions`.   |
| Camera / location / contacts    | **Not requested.** The member app _displays_ a QR pass; scanning happens in the staff web app.                                               |
| Device identifiers              | **None sent.** No device, advertising or installation ID anywhere in `apps/member/src`.                                                      |
| Transport                       | **HTTPS.** `app.config.js` throws on a production build whose `GYMFLOW_API_URL` is not `https://`.                                           |
| On-device storage               | Auth tokens in `expo-secure-store` (OS keystore); language, brand colour, feature flags and cached responses in AsyncStorage.                |

Regenerate the permission evidence with:

```bash
node scripts/check-android-manifest.mjs     # also runs in CI
```

## What the app actually handles

Every member-facing endpoint and the personal data it carries:

| Endpoint             | Data                                                       |
| -------------------- | ---------------------------------------------------------- |
| `POST /login`        | gym code, mobile number, password (sent by the member)     |
| `GET /me`            | name, membership number, branch, membership dates + status |
| `GET /payments`      | amount, method, status, date, receipt number               |
| `GET /attendance`    | gym check-in timestamps (last 60)                          |
| `GET /pt`            | personal-training packages, sessions used, trainer name    |
| `GET /notifications` | messages the gym sent this member                          |
| `GET /offers`        | promotions — not personal data                             |
| `GET /pass`          | rotating HMAC token, 60s — **contains no personal data**   |
| `PATCH /me`          | language choice                                            |
| `DELETE /account`    | deletes the member's login                                 |

Note `photoPath` appears in the `/me` response type but no screen renders
it and the app has no upload path, so **Photos is not declared**. If a
member photo is ever shown, that changes and this page must be revisited.

## Google Play — Data Safety

**Data collected** (none of it shared with third parties, none used for
tracking or advertising; all of it "Required", since the app cannot
function logged out):

| Category           | Type                  | Purpose                               |
| ------------------ | --------------------- | ------------------------------------- |
| Personal info      | Name                  | App functionality, Account management |
| Personal info      | Phone number          | App functionality, Account management |
| Personal info      | User IDs              | App functionality, Account management |
| Financial info     | Purchase history      | App functionality                     |
| Health and fitness | Fitness info          | App functionality                     |
| Messages           | Other in-app messages | App functionality                     |
| App activity       | Other actions         | App functionality                     |

**Not collected:** Location, Email address, Address, Contacts, Calendar,
Photos and videos, Audio, Files and docs, Web browsing history, Device or
other IDs, App info and performance (no crash SDK).

**Security section**

- Is all user data encrypted in transit? — **Yes**
- Do you provide a way for users to request that their data be deleted? — **Yes**
- Data deletion URL: `https://<your-domain>/account-deletion`
- Privacy policy URL: `https://<your-domain>/privacy`
- Independent security review: **No** (do not claim one; the audit in
  SECURITY_REVIEW.md is a first-party review)
- Play Families Policy: **No** — the app is not child-directed

### The two judgement calls

Both are deliberate, and both err towards over-declaring, because the
penalty for under-declaring is removal and the penalty for
over-declaring is nothing.

1. **Health and fitness → Fitness info.** Check-in history and PT session
   counts are records of physical activity. A gym app declaring no
   fitness data would invite a reviewer's question.
2. **Personal data the member does not type.** Their name, payments and
   attendance are entered by gym staff in the admin app; the member app
   only reads them. Play's definition of "collected" is transmission off
   the device, so a narrow reading would exclude these. We declare them
   anyway: the app is the surface through which that data reaches the
   member, and the distinction is not one worth arguing during a review.

## Apple — App Privacy

Same facts, Apple's three buckets:

- **Data Used to Track You:** none. There is no tracking, no advertising
  identifier, no data shared with data brokers.
- **Data Linked to You:** Name, Phone Number, User ID, Purchase History,
  Fitness, Other Data (in-app messages), Product Interaction.
- **Data Not Linked to You:** none.

Guideline **5.1.1(v)** requires in-app account deletion — implemented on
the Profile screen, calling `DELETE /api/member/v1/account`, with the
public web page above as the second route. Give the reviewer two demo
logins as described in APPLE_APP_STORE_RELEASE.md.

## What deletion actually does — say this plainly

Account deletion removes the member's **login**: the `users` row goes,
every session and refresh token is revoked, and `members.user_id` becomes
null. It does **not** erase the gym's membership and payment records,
which are that business's financial history and are retained for the
statutory period.

Both stores accept this, and both require it to be disclosed rather than
implied. It is stated on `/privacy` and on `/account-deletion`, and the
in-app confirmation says the same before the member confirms. Do not
describe the feature as "delete all my data" anywhere in the listing.

## When these answers stop being true

Re-open this page if any of the following lands:

- **Any third-party SDK** — analytics, Sentry, a push provider. Push in
  particular adds a device token, which means declaring Device or other IDs.
- **Member photos** — an upload path makes Photos and videos collected.
- **A payment provider in the app** — moves Financial info from
  "purchase history we display" to payment data the app handles.
- **Anything location-aware**, including "find a branch near me".
- **A member web build** — would not change these forms, but would need
  its own cookie/consent story.
