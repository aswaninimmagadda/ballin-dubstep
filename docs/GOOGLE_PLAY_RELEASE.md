# Google Play Release — Member App

> **Verify against current official documentation when executing** —
> Play Console policies, target API requirements and fees change; the flow
> below is the stable skeleton, the specifics must be re-checked at release
> time (play.google.com/console → Policy & programmes, and the "target API
> level" requirements page).

App identity (already configured in `apps/member/app.config.js`):

- Package name: **`app.gymflow.member`** (permanent once published — rename
  only _before_ first upload if the brand changes)
- Version: 0.1.0 (Expo manages `versionCode` per build via EAS)

## The 14 steps (account → rollout → updates)

1. **Google Play developer account.** play.google.com/console → sign up as
   an organization if you'll charge gyms later (needs D-U-N-S) or
   individual for the pilot; one-time registration fee (US$25 historically —
   verify); identity verification can take days — start early. New personal
   accounts must run a closed test with ≥12 testers for 14 days before
   production access (verify current numbers).

2. **Create the app** in the console: name "GymFlow" (working name —
   decide the commercial name first; renaming later is allowed but
   confusing), default language en-IN, App (not game), Free.

3. **App signing.** Use **Play App Signing** (default): Google holds the
   app signing key; your upload key is managed by EAS
   (`eas credentials`). Never commit keystores; if you self-manage, store
   the keystore + passwords in the operator's password manager and back it
   up — losing a self-managed key without Play App Signing is fatal.

4. **Adaptive icon & splash screen.** Both are configured in
   `apps/member/app.config.js` — `android.adaptiveIcon`
   (foreground/background/monochrome) and the `expo-splash-screen` plugin —
   with template assets in `apps/member/assets/`. Replace the templates with
   the commercial brand before the first upload: the adaptive icon must read
   clearly in a circle mask, and the splash must not carry text that needs
   translating. `node scripts/check-android-manifest.mjs` (also run in CI)
   asserts that both are actually generated into the Android project, since
   a `expo export` bundle cannot show you either.

5. **Build the AAB.**

   ```bash
   npm i -g eas-cli && eas login
   cd apps/member
   # set env.GYMFLOW_API_URL in eas.json's production profile FIRST
   eas build --platform android --profile production   # produces .aab
   ```

   `apps/member/eas.json` already defines the `preview` (APK) and
   `production` (AAB, auto-incrementing versionCode) profiles. **Edit the
   `env.GYMFLOW_API_URL` in the profile you are building** — EAS builds run
   in Expo's cloud and do **not** inherit your shell environment, so a value
   exported in your terminal is ignored and the binary would silently keep
   the placeholder. Production must be `https`: it is the real origin, and an
   https origin also keeps Android cleartext off, which Play expects (see
   `app.config.js`). (EAS free tier queues builds; local alternative:
   `npx expo prebuild && ./gradlew bundleRelease` with your own Android SDK.)

6. **Testing tracks.** Internal testing first: upload the AAB, add tester
   emails, install via the opt-in link, run the smoke script (login with a
   demo member, QR renders and scans at reception, offline banner appears
   in airplane mode). Then closed testing (required for new personal
   accounts): promote the build, meet the tester/day requirements, fix what
   testers find.

7. **Store listing — descriptions & category.** Short description
   (≤80 chars): "Your gym membership, pass and receipts in one app." Full
   description: emphasize membership status, QR check-in, receipts, Telugu
   support. Category: Health & Fitness. Contact email is required.

8. **Screenshots & graphics.** Icon 512×512, feature graphic 1024×500,
   ≥2 phone screenshots — take them from a **demo tenant, never real member
   data** (§85). Localized Telugu screenshots are optional but effective
   for the AP market.

9. **Privacy policy.** The app ships its own policy at
   `https://<your-admin-origin>/privacy` — a public, no-login page. Enter that
   URL in Store listing AND Policy → App content. It is also linked from
   inside the app (Overview tab), which both stores expect.

   Do **not** submit `docs/PRIVACY.md`: that is a different document with a
   different author — a template for the **gym** to publish as data
   controller, written in the gym's voice and still carrying `[Gym name]`
   placeholders. A reviewer opening a URL with unfilled placeholders is a
   rejection. The gym publishes that one on its own site; the app publishes
   `/privacy`.

10. **Content rating questionnaire** (Policy → App content): utility app,
    no user-generated content, no gambling → rates Everyone. Target
    audience 18+ (gym members); not a child-directed app.

11. **Data safety form + account deletion** (Policy → App content).
    Declare every category the app actually fetches — under-declaring is what
    gets an app pulled after release, not at review:

    | Category                                      | Purpose            | Endpoint                    |
    | --------------------------------------------- | ------------------ | --------------------------- |
    | Name, phone number                            | Account management | `/api/member/v1/me`         |
    | Purchase history (payments, receipts)         | App functionality  | `/api/member/v1/payments`   |
    | **App activity — gym check-ins (date/time)**  | App functionality  | `/api/member/v1/attendance` |
    | **App activity — personal-training sessions** | App functionality  | `/api/member/v1/pt`         |

    All four are linked to the user and none are shared with third parties;
    all are encrypted in transit; no location, no ads SDKs, no tracking, no
    advertising ID. Play also requires the **account-deletion declaration**:
    the in-app path is Overview tab → "Delete my account", and the public URL
    to enter is `https://<your-admin-origin>/account-deletion` — a no-login
    page shipped with the admin app that also resolves the member's gym from
    the gym code and gives them its phone and WhatsApp, so a user without the
    app has a real route rather than an instruction to "ask reception".
    Declare honestly that the login is deleted while financial records are
    retained by the gym for the statutory period — partial deletion is an
    accepted answer on that form, a false "everything is deleted" is not.

12. **App access** (Policy → App content) — mandatory, and easy to miss
    because nothing prompts for it. This app is entirely behind a login, has
    no self-registration and no self-service password reset, so a reviewer
    cannot get past the first screen without help. Choose "All or some
    functionality is restricted" and provide:

    - gym code, mobile number and password for a **demo tenant** member
      (never a real member — §85),
    - a one-line note: "Accounts are created by the gym at the front desk;
      there is no public sign-up. The credentials above are for a demo gym
      with sample data."

    Re-issue the demo password before each submission (member page → _Reset
    app password_) and keep it valid until the review finishes — an expired
    reviewer login is a rejection that costs a full review cycle.

13. **Production rollout.** Promote from closed testing → staged rollout
    (start 20%) → 100%. Review times vary (hours to ~7 days).

14. **Updates.** Bump `version` in app.config.js, `eas build`, upload to a test
    track, promote. Keep release notes in the console (bilingual EN/TE is
    a nice touch for members).

## Permissions the binary requests

Exactly two survive into the release manifest: `INTERNET` and `VIBRATE`.
`READ_EXTERNAL_STORAGE`, `WRITE_EXTERNAL_STORAGE` (pulled in transitively by
`expo-file-system`) and `SYSTEM_ALERT_WINDOW` (Expo's dev-menu template) are
stripped via `android.blockedPermissions` — the app uses none of them, and an
unexplained storage or draw-over-other-apps permission is a review question.
`scripts/check-android-manifest.mjs` fails CI if any other permission appears.

## Before the first build: link the EAS project

`eas.json` sets `appVersionSource: "remote"`, so EAS owns `versionCode` and
auto-increments it per build. That requires the project to be linked, which
`app.config.js` deliberately does **not** hard-code (a checked-in `projectId`
belongs to whoever ran `eas init`, not to whoever forks this):

```bash
cd apps/member
eas init          # creates the project, writes extra.eas.projectId + owner
eas build:configure
```

Run this once per publishing account. Without it `eas build --profile
production` fails at the version step.

## White-labelling for one gym's own store listing

No fork required — app identity is read from the environment, alongside the
API origin:

| Variable                  | Default              | What it changes                 |
| ------------------------- | -------------------- | ------------------------------- |
| `GYMFLOW_APP_NAME`        | `GymFlow`            | Launcher and store display name |
| `GYMFLOW_APP_SLUG`        | `gymflow-member`     | Expo project slug               |
| `GYMFLOW_APP_SCHEME`      | `gymflow`            | Deep-link scheme                |
| `GYMFLOW_ANDROID_PACKAGE` | `app.gymflow.member` | Play package id (permanent)     |
| `GYMFLOW_IOS_BUNDLE_ID`   | `app.gymflow.member` | App Store bundle id (permanent) |
| `GYMFLOW_BRAND_COLOR`     | `#16a34a`            | Adaptive-icon background        |

Set them in the EAS build profile next to `GYMFLOW_API_URL`, and replace the
icon assets. Each branded app is a separate Play listing under its own
package id.

## Current status in this repository

- AAB **not yet generated** (requires an Expo/EAS account + the production
  API origin).
- What CI does verify on every push: the Metro bundle builds, the Android
  project generates, the release manifest carries only the two expected
  permissions, the splash and adaptive icons are produced, cleartext is off
  for an https origin, and a production build is **refused** if
  `GYMFLOW_API_URL` is still the `eas.json` placeholder or is plain http.
  What it cannot verify is how the app looks and behaves on a real device —
  see `docs/KNOWN_LIMITATIONS.md`.
- Package id, icon assets (template), splash, app config, permission
  stripping, safe-area handling: done.
- Remaining human actions: developer account, `eas init`, EAS credentials,
  the production `GYMFLOW_API_URL` in `eas.json`, listing assets, demo
  reviewer credentials, and the three console declaration forms (content
  rating, data safety + deletion, app access).
