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

## The 13 steps (account → rollout → updates)

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
   `apps/member/app.config.js` (`android.adaptiveIcon` foreground/background,
   `backgroundColor`) with template assets in `apps/member/assets/`. Replace
   the templates with the commercial brand before the first upload — the
   adaptive icon must read clearly in a circle mask, the splash must not
   carry text that needs translating.

5. **Build the AAB.**

   ```bash
   npm i -g eas-cli && eas login
   cd apps/member
   GYMFLOW_API_URL=https://admin.yourgym.in \
     eas build --platform android --profile production   # produces .aab
   ```

   First run creates `eas.json`; set `production` to `"autoIncrement": true`
   for versionCode. `GYMFLOW_API_URL` is baked into the binary at build time
   — it **must** be the production origin and it **must** be `https` (an
   https origin also keeps Android cleartext off, which Play expects; see
   `app.config.js`). Set the same variable in the EAS build profile's `env`
   so cloud builds get it. (EAS free tier queues builds; local alternative:
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

9. **Privacy policy.** Host docs/PRIVACY.md's policy on the gym/product
   site and enter the URL in Store listing AND Policy → App content — Play
   requires a working public URL.

10. **Content rating questionnaire** (Policy → App content): utility app,
    no user-generated content, no gambling → rates Everyone. Target
    audience 18+ (gym members); not a child-directed app.

11. **Data safety form** (Policy → App content): declares — collects phone
    number + name (account management), payment history (app
    functionality); not shared with third parties; encrypted in transit;
    deletable via request (PRIVACY.md flow); no location, no ads SDKs, no
    tracking.

12. **Production rollout.** Promote from closed testing → staged rollout
    (start 20%) → 100%. Review times vary (hours to ~7 days).

13. **Updates.** Bump `version` in app.config.js, `eas build`, upload to a test
    track, promote. Keep release notes in the console (bilingual EN/TE is
    a nice touch for members).

## Current status in this repository

- AAB **not yet generated** (requires an Expo/EAS account + the production
  API origin; the Metro bundle is verified in CI so the JS side is
  build-ready).
- Package id, adaptive-icon assets (template), app config: done.
- Remaining human actions: developer account, EAS credentials, production
  `apiBaseUrl`, listing assets, the two console declaration forms.
