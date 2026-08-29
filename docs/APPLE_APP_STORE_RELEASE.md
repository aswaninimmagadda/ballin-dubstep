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
3. **Build:** set `env.GYMFLOW_API_URL` in `eas.json`'s production profile
   (EAS does not inherit your shell environment), then
   `eas build --platform ios --profile production` → produces an `.ipa`. The
   build **fails** if that value is still the placeholder or is plain http —
   see `app.config.js`.
4. **App Store Connect:** create the app (bundle id above, name, primary
   language en-IN or en-US, SKU e.g. `gymflow-member`).
5. **TestFlight:** `eas submit -p ios` uploads the build; internal testers
   immediately, external testers after a light beta review. Run the same
   smoke script as Android.
6. **App Privacy** (Connect → App Privacy): declare everything the app
   actually fetches — name + phone (account), purchase history (app
   functionality), **gym check-in history** and **personal-training session
   history** (both app functionality, both linked to the user). No tracking,
   no advertising identifier, no location. The privacy-policy URL is
   `https://<your-admin-origin>/privacy`, a public no-login page shipped with
   the admin app and linked from the app's Overview tab — not
   `docs/PRIVACY.md`, which is the template the _gym_ publishes as controller
   and still carries placeholders.
7. **Listing:** screenshots for 6.7" and 6.1" (Simulator OK), description,
   keywords ("gym, membership, fitness, telugu"), support URL, age 4+.
8. **Review notes:** provide a demo login (demo tenant gym code + mobile +
   password) so the reviewer can sign in — Apple rejects apps they can't
   enter. State that accounts are created by the gym at the desk (B2B2C
   pattern) and there is no public sign-up; this is accepted when explained.
   Issue the demo password from the member page's _Reset app password_ action
   immediately before submitting, use a **demo tenant only** (§85), and keep
   it valid until review completes.
9. **Release:** manual release after approval recommended for the first
   version; then phased automatic releases.

## Give the reviewer TWO demo logins

Guideline 5.1.1(v) requires in-app account deletion, so the reviewer will test
it — and testing it destroys the login they were given. There is no
self-service sign-up to make another, so a single demo account leaves the
review dead in the water on the very screen Apple asked you to provide.

Create two demo members in the demo tenant, hand over both, and say in the
review notes: "The second login is provided because testing account deletion
removes the first." If they get stuck anyway, reception can reissue a password
from the member page (_Reset app password_) — but do not rely on a round trip
through App Review to find that out.

## Account deletion (guideline 5.1.1(v)) — required

Apps that support account creation must let the user delete the account from
inside the app. Ours does: **Overview tab → "Delete my account"**, which
removes the login (credentials, roles, sessions, user row), signs the member
out everywhere and files a data-deletion request with the gym. Point the
reviewer at that path in App Review notes, and say plainly that membership
and payment records are retained by the gym as the controller, because the
law requires it — Apple accepts retention that is legally mandated when it is
disclosed. The same explanation is public at `/account-deletion` on the admin
origin.

## White-labelling

App identity is environment-driven (`GYMFLOW_APP_NAME`, `GYMFLOW_APP_SLUG`,
`GYMFLOW_APP_SCHEME`, `GYMFLOW_IOS_BUNDLE_ID`, `GYMFLOW_BRAND_COLOR`) so a
gym-branded build needs no source fork — see the table in
`docs/GOOGLE_PLAY_RELEASE.md`. The bundle identifier is permanent once
published, so decide it before the first upload.

## Build configuration

`apps/member/eas.json` carries the same profiles as Android. iOS builds run
on Expo's macOS workers, so **a Mac is not required** — but an Apple
Developer account is, and cloud builds do not inherit your shell
environment: set `env.GYMFLOW_API_URL` inside the profile before building,
or the binary keeps the placeholder origin. The production origin must be
`https`; App Transport Security blocks plain HTTP, and the local-network
exception in `app.config.js` is only applied for `http` (LAN testing) builds.

## What CI verifies

`scripts/check-android-manifest.mjs` also asserts the iOS release settings
that are cheap to get wrong and expensive to discover at submission:
`ITSAppUsesNonExemptEncryption` is declared (otherwise every upload stalls on
Missing Compliance), both `en` and `te` are declared as bundle localizations so
the product page advertises Telugu, and an https build carries no App Transport
Security exception. CI also runs `expo export --platform ios`, so the
"iOS-ready" claim below has a guard behind it.

One correction worth recording: the LAN-testing ATS exception used to be
`NSAllowsLocalNetworking` alone, described in both the code and this document
as the equivalent of Android's `usesCleartextTraffic`. It is not —
`NSAllowsLocalNetworking` covers `.local` names and link-local addresses, not
`http://192.168.x.x`, so a LAN build would have had every request blocked. It
now sets `NSAllowsArbitraryLoads` too, and the production guard makes it
impossible for that branch to reach a release build.

## Current status in this repository

- iOS build **not generated** (no Apple membership in the pilot budget);
  architecture is iOS-ready — the Expo project compiles for iOS unchanged and
  no Android-only APIs are used (SecureStore/AsyncStorage/SVG/safe-area-context
  are all cross-platform). Safe areas use `react-native-safe-area-context`,
  which is what handles the iPhone notch and home indicator as well as
  Android's edge-to-edge insets.
- Remaining human actions: enrollment, EAS iOS credentials, listing
  assets, privacy declarations, demo credentials for review.
