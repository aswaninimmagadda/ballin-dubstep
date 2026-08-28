/**
 * Expo configuration.
 *
 * Everything a customised build needs comes from the environment, so shipping
 * the app under a gym's own name and icon never requires a fork of this
 * repository — which is the commercialisation criterion for the product.
 *
 *   GYMFLOW_API_URL=http://192.168.1.4:3000 pnpm dev:member     # LAN testing
 *   GYMFLOW_API_URL=https://admin.yourgym.in eas build …        # release
 *
 * Cleartext note (this is why the file is JS and not JSON): Android 9+ blocks
 * plain HTTP in release builds, and Expo only enables it in the *debug*
 * manifest. A release APK pointed at http://<LAN-IP>:3000 would therefore fail
 * every request. So when — and only when — the configured origin is plain
 * http, we enable usesCleartextTraffic for that build. Point the app at an
 * https origin (as production must be) and cleartext stays off.
 */
const PLACEHOLDER_ORIGIN = 'https://admin.example.in';
const API_BASE_URL = process.env.GYMFLOW_API_URL ?? 'http://localhost:3000';
const NEEDS_CLEARTEXT = API_BASE_URL.startsWith('http://');

/**
 * A release binary carries its API origin forever — there is no runtime
 * setting to correct it, and a wrong one means an app that installs, opens and
 * then fails every request. eas.json ships a placeholder so the profile is
 * readable, and EAS builds do NOT inherit your shell environment, so the
 * failure mode is silent: you edit nothing, the build succeeds, and the store
 * gets an app pointed at a domain nobody owns. Fail the build instead.
 */
if (process.env.EAS_BUILD_PROFILE === 'production') {
  if (API_BASE_URL === PLACEHOLDER_ORIGIN) {
    throw new Error(
      `GYMFLOW_API_URL is still the placeholder ${PLACEHOLDER_ORIGIN}. Set the real origin in ` +
        "eas.json's production profile (EAS does not inherit your shell environment).",
    );
  }
  if (!API_BASE_URL.startsWith('https://')) {
    throw new Error(
      `A production build needs an https origin; GYMFLOW_API_URL is "${API_BASE_URL}". ` +
        'App Transport Security and the Play cleartext policy both block plain HTTP.',
    );
  }
}

// White-label knobs. Defaults are the GymFlow-branded build.
const APP_NAME = process.env.GYMFLOW_APP_NAME ?? 'GymFlow';
const APP_SLUG = process.env.GYMFLOW_APP_SLUG ?? 'gymflow-member';
const APP_SCHEME = process.env.GYMFLOW_APP_SCHEME ?? 'gymflow';
const ANDROID_PACKAGE = process.env.GYMFLOW_ANDROID_PACKAGE ?? 'app.gymflow.member';
const IOS_BUNDLE_ID = process.env.GYMFLOW_IOS_BUNDLE_ID ?? 'app.gymflow.member';
const BRAND_COLOR = process.env.GYMFLOW_BRAND_COLOR ?? '#16a34a';

module.exports = () => ({
  expo: {
    name: APP_NAME,
    slug: APP_SLUG,
    scheme: APP_SCHEME,
    version: '0.1.0',
    orientation: 'portrait',
    icon: './assets/icon.png',
    userInterfaceStyle: 'light',
    backgroundColor: '#f8fafc',
    ios: {
      supportsTablet: false,
      bundleIdentifier: IOS_BUNDLE_ID,
      // The iOS equivalent of the Android cleartext switch.
      infoPlist: NEEDS_CLEARTEXT
        ? { NSAppTransportSecurity: { NSAllowsLocalNetworking: true } }
        : undefined,
    },
    android: {
      package: ANDROID_PACKAGE,
      adaptiveIcon: {
        backgroundColor: BRAND_COLOR,
        foregroundImage: './assets/android-icon-foreground.png',
        backgroundImage: './assets/android-icon-background.png',
        monochromeImage: './assets/android-icon-monochrome.png',
      },
      predictiveBackGestureEnabled: false,
      // expo-file-system is a transitive dependency of expo and declares
      // READ/WRITE_EXTERNAL_STORAGE in its manifest. This app never reads or
      // writes shared storage, and an unexplained storage permission is both a
      // Play review question and a needless install-time ask.
      blockedPermissions: [
        'android.permission.READ_EXTERNAL_STORAGE',
        'android.permission.WRITE_EXTERNAL_STORAGE',
        // Expo's template declares "Display over other apps" for the dev menu.
        // Blocking it here strips it from release builds while the debug
        // flavour, which declares it in its own manifest, keeps the dev menu.
        'android.permission.SYSTEM_ALERT_WINDOW',
      ],
    },
    plugins: [
      [
        'expo-splash-screen',
        {
          image: './assets/splash-icon.png',
          imageWidth: 180,
          resizeMode: 'contain',
          backgroundColor: '#f8fafc',
        },
      ],
      ...(NEEDS_CLEARTEXT
        ? [['expo-build-properties', { android: { usesCleartextTraffic: true } }]]
        : []),
    ],
    extra: {
      apiBaseUrl: API_BASE_URL,
    },
  },
});
