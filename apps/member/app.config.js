/**
 * Expo configuration.
 *
 * The API origin is read from GYMFLOW_API_URL at build/start time so nobody
 * has to hand-edit a checked-in file to point the app at their machine or at
 * production:
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
const API_BASE_URL = process.env.GYMFLOW_API_URL ?? 'http://localhost:3000';
const NEEDS_CLEARTEXT = API_BASE_URL.startsWith('http://');

module.exports = () => ({
  expo: {
    name: 'GymFlow',
    slug: 'gymflow-member',
    scheme: 'gymflow',
    version: '0.1.0',
    orientation: 'portrait',
    icon: './assets/icon.png',
    userInterfaceStyle: 'light',
    backgroundColor: '#f8fafc',
    ios: {
      supportsTablet: false,
      bundleIdentifier: 'app.gymflow.member',
      // The iOS equivalent of the Android cleartext switch.
      infoPlist: NEEDS_CLEARTEXT
        ? { NSAppTransportSecurity: { NSAllowsLocalNetworking: true } }
        : undefined,
    },
    android: {
      package: 'app.gymflow.member',
      adaptiveIcon: {
        backgroundColor: '#16a34a',
        foregroundImage: './assets/android-icon-foreground.png',
        backgroundImage: './assets/android-icon-background.png',
        monochromeImage: './assets/android-icon-monochrome.png',
      },
      predictiveBackGestureEnabled: false,
    },
    plugins: NEEDS_CLEARTEXT
      ? [['expo-build-properties', { android: { usesCleartextTraffic: true } }]]
      : [],
    extra: {
      apiBaseUrl: API_BASE_URL,
    },
  },
});
