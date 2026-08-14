# Google Play Release — Member App

> **Verify against current official documentation when executing** —
> Play Console policies, target API requirements and fees change; the flow
> below is the stable skeleton, the specifics must be re-checked at release
> time (play.google.com/console → Policy & programmes, and the "target API
> level" requirements page).

App identity (already configured in `apps/member/app.json`):

- Package name: **`app.gymflow.member`** (permanent once published — rename
  only _before_ first upload if the brand changes)
- Version: 0.1.0 (Expo manages `versionCode` per build via EAS)

## Step-by-step

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

4. **Build the AAB.**

   ```bash
   npm i -g eas-cli && eas login
   cd apps/member
   eas build --platform android --profile production   # produces .aab
   ```

   First run creates `eas.json`; set `production` to `"autoIncrement": true`
   for versionCode. Point `expo.extra.apiBaseUrl` at the **production**
   admin origin before building. (EAS free tier queues builds; local
   alternative: `npx expo prebuild && ./gradlew bundleRelease` with your own
   Android SDK.)

5. **Internal testing track** first: upload the AAB, add tester emails,
   install via the opt-in link, run the smoke script (login with a demo
   member, QR renders and scans at reception, offline banner appears in
   airplane mode).

6. **Closed testing** (required for new personal accounts): promote the
   build, meet the tester/day requirements, fix what testers find.

7. **Store listing.** Short description (≤80 chars): "Your gym membership,
   pass and receipts in one app." Full description: emphasize
   membership status, QR check-in, receipts, Telugu support. Assets: icon
   512×512, feature graphic 1024×500, ≥2 phone screenshots (take from a
   demo tenant — never real member data). Category: Health & Fitness.
   Contact email + the published privacy policy URL (host
   docs/PRIVACY.md's policy on the gym/product site — required).

8. **App content declarations** (Policy → App content): privacy policy URL;
   ads: none; content rating questionnaire (utility app → Everyone); target
   audience 18+; **Data safety** form — declare: collects phone number +
   name (account management), payment history (app functionality, not
   shared, encrypted in transit, deletable via request); no location, no
   ads SDKs, no tracking.

9. **Production rollout.** Promote from closed testing → staged rollout
   (start 20%) → 100%. Review times vary (hours to ~7 days).

10. **Updates.** Bump `version` in app.json, `eas build`, upload to a test
    track, promote. Keep release notes in the console (bilingual EN/TE is
    a nice touch for members).

## Current status in this repository

- AAB **not yet generated** (requires an Expo/EAS account + the production
  API origin; the Metro bundle is verified in CI so the JS side is
  build-ready).
- Package id, adaptive-icon assets (template), app config: done.
- Remaining human actions: developer account, EAS credentials, production
  `apiBaseUrl`, listing assets, the two console declaration forms.
