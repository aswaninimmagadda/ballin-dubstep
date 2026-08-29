#!/usr/bin/env node
/**
 * Generate the member app's Android project and assert the things that decide
 * whether a build is submittable to Google Play.
 *
 * CI used to run `expo export` only, which type-checks and bundles the
 * JavaScript and never produces an Android manifest. That is how the app
 * reached "release ready" declaring storage permissions it does not use, with
 * no splash screen while two documents said one was configured, and with no
 * safe-area handling under mandatory edge-to-edge — the bottom tab bar
 * rendering behind the system navigation bar on Android 15. None of it is
 * visible from the JS bundle.
 *
 * This does not replace a device run (see KNOWN_LIMITATIONS), but everything
 * asserted here is a property of the binary, not of the source.
 *
 * Usage: node scripts/check-android-manifest.mjs
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const APP = new URL('../apps/member/', import.meta.url).pathname;
const ANDROID = join(APP, 'android');

let passed = 0;
const failures = [];
function check(name, cond, detail = '') {
  if (cond) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failures.push(name);
    console.error(`  ✗ ${name} ${detail}`);
  }
}

console.log('Generating the Android project (expo prebuild) …');
rmSync(ANDROID, { recursive: true, force: true });
execFileSync('npx', ['expo', 'prebuild', '--platform', 'android', '--no-install', '--clean'], {
  cwd: APP,
  // A real origin: the production guard in app.config.js refuses the
  // placeholder, and we want this to exercise the https path.
  env: { ...process.env, GYMFLOW_API_URL: 'https://admin.example-ci.test' },
  stdio: 'pipe',
});

const manifest = readFileSync(join(ANDROID, 'app/src/main/AndroidManifest.xml'), 'utf8');
const gradleProps = readFileSync(join(ANDROID, 'gradle.properties'), 'utf8');

console.log('\n[permissions]');
check('INTERNET is declared', /android\.permission\.INTERNET"\s*\/>/.test(manifest));
for (const perm of ['READ_EXTERNAL_STORAGE', 'WRITE_EXTERNAL_STORAGE', 'SYSTEM_ALERT_WINDOW']) {
  // These arrive from transitive dependencies and Expo's own template. They
  // are questions a Play reviewer asks, so they must be stripped at merge time.
  check(
    `${perm} is removed from the release manifest`,
    new RegExp(`android\\.permission\\.${perm}"\\s+tools:node="remove"`).test(manifest),
    'not marked tools:node="remove"',
  );
}
const declared = [
  ...manifest.matchAll(/android:name="android\.permission\.([A-Z_]+)"(?![^>]*remove)/g),
].map((m) => m[1]);
check(
  'no unexpected permission survives into the release manifest',
  declared.every((p) => ['INTERNET', 'VIBRATE'].includes(p)),
  declared.join(', '),
);

console.log('\n[edge-to-edge and safe areas]');
// Android 15 makes edge-to-edge mandatory; Expo turns it on here. That is
// exactly why the app must use real insets.
check('edge-to-edge is enabled by the template', /edgeToEdgeEnabled=true/.test(gradleProps));
const appTsx = readFileSync(join(APP, 'App.tsx'), 'utf8');
check(
  'the app uses react-native-safe-area-context, not the deprecated RN SafeAreaView',
  appTsx.includes("from 'react-native-safe-area-context'") &&
    !/SafeAreaView[^\n]*from 'react-native'/.test(appTsx),
);
check(
  'the shell applies the bottom inset to the tab bar',
  /paddingBottom: insets\.bottom/.test(appTsx),
);
check('the shell applies the top inset', /paddingTop: insets\.top/.test(appTsx));
const pkg = JSON.parse(readFileSync(join(APP, 'package.json'), 'utf8'));
check(
  'react-native-safe-area-context is a real dependency',
  Boolean(pkg.dependencies?.['react-native-safe-area-context']),
);

console.log('\n[branding]');
check(
  'a splash screen is generated',
  existsSync(join(ANDROID, 'app/src/main/res/drawable/splashscreen_logo.xml')) ||
    existsSync(join(ANDROID, 'app/src/main/res/drawable-hdpi/splashscreen_logo.png')),
);
check(
  'the launcher icon is generated',
  existsSync(join(ANDROID, 'app/src/main/res/mipmap-hdpi/ic_launcher.webp')) ||
    existsSync(join(ANDROID, 'app/src/main/res/mipmap-hdpi/ic_launcher.png')),
);
check(
  'the adaptive icon is generated',
  existsSync(join(ANDROID, 'app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml')),
);

console.log('\n[release configuration]');
check(
  'cleartext traffic is off for an https origin',
  !/usesCleartextTraffic="true"/.test(manifest),
);
const strings = readFileSync(join(ANDROID, 'app/src/main/res/values/strings.xml'), 'utf8');
check('the app name comes through', /GymFlow/.test(strings), strings.slice(0, 200));

// The production guard must actually fire — this is the difference between
// shipping to a domain nobody owns and failing the build.
console.log('\n[production build guards]');
for (const [label, url] of [
  ['the eas.json placeholder origin', 'https://admin.example.in'],
  ['a plain-http origin', 'http://192.168.1.4:3000'],
]) {
  let threw = false;
  try {
    execFileSync('node', ['-e', "require('./app.config.js')()"], {
      cwd: APP,
      env: { ...process.env, EAS_BUILD_PROFILE: 'production', GYMFLOW_API_URL: url },
      stdio: 'pipe',
    });
  } catch {
    threw = true;
  }
  check(`a production build is refused for ${label}`, threw);
}

console.log('\n[iOS release configuration]');
// Cheap to assert from the config and each one is a submission blocker or a
// stalled upload, so they are checked here rather than left to a manual pass.
// app.config.js reads GYMFLOW_API_URL at module load, and its default is the
// local http dev origin — which legitimately turns the ATS exception on. Set a
// production-shaped origin before importing so this checks a release build.
process.env.GYMFLOW_API_URL = 'https://admin.example-ci.test';
const iosConfig = (await import(join(APP, 'app.config.js'))).default;
const httpsExpo = iosConfig().expo;
check(
  'ITSAppUsesNonExemptEncryption is declared',
  httpsExpo.ios?.infoPlist?.ITSAppUsesNonExemptEncryption === false,
  'every upload otherwise stalls on Missing Compliance',
);
check(
  'both shipped languages are declared for the store listing',
  JSON.stringify(httpsExpo.ios?.infoPlist?.CFBundleLocalizations ?? []) === '["en","te"]',
);
check(
  'an https build carries no App Transport Security exception',
  !('NSAppTransportSecurity' in (httpsExpo.ios?.infoPlist ?? {})),
  JSON.stringify(httpsExpo.ios?.infoPlist?.NSAppTransportSecurity),
);
check(
  'app identity is environment-driven, not hard-coded',
  httpsExpo.ios?.bundleIdentifier === 'app.gymflow.member' &&
    httpsExpo.android?.package === 'app.gymflow.member',
);

rmSync(ANDROID, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.error('FAILURES:', failures.join(' | '));
  process.exitCode = 1;
}
