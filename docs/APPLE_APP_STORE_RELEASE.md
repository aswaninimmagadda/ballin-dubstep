# Apple App Store Release — Member App

> **Verify against current Apple documentation when executing**
> (developer.apple.com → App Store Connect help). Requirements shift;
> below is the durable outline with the India-pilot practicalities.

App identity (configured in `apps/member/app.config.js`):

- Bundle identifier: **`app.gymflow.member`**

## What you need (and what it costs)

| Requirement                        | Needed for                  | Notes                                                                                                                   |
| ---------------------------------- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Apple Developer Program membership | Everything                  | US$99/year (verify) — organization enrollment needs a D-U-N-S number                                                    |
| Apple hardware                     | Not strictly, with EAS      | EAS Build compiles iOS in the cloud; a Mac is still useful for Simulator debugging, and required for local Xcode builds |
| App Store Connect access           | Listing, TestFlight, review | Comes with the membership                                                                                               |

Given the Android-first AP pilot, iOS can trail Android by months without
product impact — budget the $99/yr only when there's real iPhone demand.

## Step-by-step

1. **Enroll** in the Apple Developer Program (organization recommended for
   the commercial phase).
2. **Certificates/provisioning:** let EAS manage them
   (`eas credentials -p ios`) — it creates the distribution certificate and
   provisioning profile against your Apple account; no manual Keychain
   work.
3. **Build:** set the production `apiBaseUrl`, then
   `eas build --platform ios --profile production` → produces an `.ipa`.
4. **App Store Connect:** create the app (bundle id above, name, primary
   language en-IN or en-US, SKU e.g. `gymflow-member`).
5. **TestFlight:** `eas submit -p ios` uploads the build; internal testers
   immediately, external testers after a light beta review. Run the same
   smoke script as Android.
6. **App Privacy** (Connect → App Privacy): declare collection of name +
   phone (account), purchase history (app functionality), linked to the
   user, no tracking. Mirror the published privacy policy URL.
7. **Listing:** screenshots for 6.7" and 6.1" (Simulator OK), description,
   keywords ("gym, membership, fitness, telugu"), support URL, age 4+.
8. **Review notes:** provide a demo login (demo tenant gym code + mobile +
   password) so the reviewer can sign in — Apple rejects apps they can't
   enter. State that accounts are created by the gym (B2B2C pattern) —
   this is accepted when explained.
9. **Release:** manual release after approval recommended for the first
   version; then phased automatic releases.

## Build configuration

`apps/member/eas.json` carries the same profiles as Android. iOS builds run
on Expo's macOS workers, so **a Mac is not required** — but an Apple
Developer account is, and cloud builds do not inherit your shell
environment: set `env.GYMFLOW_API_URL` inside the profile before building,
or the binary keeps the placeholder origin. The production origin must be
`https`; App Transport Security blocks plain HTTP, and the local-network
exception in `app.config.js` is only applied for `http` (LAN testing) builds.

## Current status in this repository

- iOS build **not generated** (no Apple membership in the pilot budget);
  architecture is iOS-ready — Expo project compiles for iOS unchanged, no
  Android-only APIs are used (SecureStore/AsyncStorage/SVG all
  cross-platform).
- Remaining human actions: enrollment, EAS iOS credentials, listing
  assets, privacy declarations, demo credentials for review.
