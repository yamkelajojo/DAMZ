import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const apps = ['customer', 'runner', 'converter'];

for (const app of apps) {
  const packageJson = JSON.parse(
    await readFile(new URL(`../apps/${app}/package.json`, import.meta.url), 'utf8'),
  );
  const appConfig = JSON.parse(
    await readFile(new URL(`../apps/${app}/app.json`, import.meta.url), 'utf8'),
  );
  const easConfig = JSON.parse(
    await readFile(new URL(`../apps/${app}/eas.json`, import.meta.url), 'utf8'),
  );
  const appIgnore = await readFile(new URL(`../apps/${app}/.gitignore`, import.meta.url), 'utf8');

  assert.match(packageJson.dependencies.expo, /^~57\./, `${app} Expo SDK must stay pinned to 57`);
  assert.match(
    packageJson.dependencies['expo-dev-client'] ?? '',
    /^~57\./,
    `${app} must install the matching expo-dev-client`,
  );
  assert.equal(
    packageJson.scripts['start:dev-client'],
    'expo start --dev-client',
    `${app} needs a dev-client Metro command`,
  );
  assert.equal(easConfig.build.development.developmentClient, true, `${app} needs a dev client profile`);
  assert.equal(easConfig.build.development.distribution, 'internal', `${app} dev build must be installable internally`);
  assert.ok(appConfig.expo.ios.bundleIdentifier, `${app} needs a unique iOS bundle identifier`);
  assert.match(appIgnore, /^\/android$/m, `${app} must use generated Android native projects`);
  assert.match(appIgnore, /^\/ios$/m, `${app} must use generated iOS native projects`);
}

const customerConfig = JSON.parse(
  await readFile(new URL('../apps/customer/app.json', import.meta.url), 'utf8'),
);
assert.ok(
  customerConfig.expo.plugins.some(
    (plugin) => Array.isArray(plugin) && plugin[0] === 'expo-sqlite' && plugin[1]?.useSQLCipher === true,
  ),
  'Customer must keep its SQLCipher config plugin enabled',
);

const runnerPackage = JSON.parse(
  await readFile(new URL('../apps/runner/package.json', import.meta.url), 'utf8'),
);
const runnerEntry = await readFile(new URL('../apps/runner/index.js', import.meta.url), 'utf8');
const runnerMetro = await readFile(new URL('../apps/runner/metro.config.js', import.meta.url), 'utf8');
const runnerInbox = await readFile(
  new URL('../apps/runner/src/services/payment-notification-inbox.ts', import.meta.url),
  'utf8',
);
const runnerHome = await readFile(new URL('../apps/runner/src/app/index.tsx', import.meta.url), 'utf8');
const runnerEnvExample = await readFile(new URL('../apps/runner/.env.example', import.meta.url), 'utf8');
assert.ok(
  runnerPackage.dependencies['react-native-quick-crypto'],
  'Runner must include its native WebCrypto implementation',
);
assert.ok(
  runnerPackage.dependencies['expo-file-system'],
  'Runner must include Expo FileSystem for Tor state storage',
);
assert.ok(
  runnerPackage.dependencies['react-native-nitro-tor'],
  'Runner must directly include its native Tor implementation for development builds',
);
assert.ok(
  runnerEntry.indexOf("require('react-native-quick-crypto')") <
    runnerEntry.indexOf("require('expo-router/entry')"),
  'Runner must install native WebCrypto before loading Expo Router',
);
assert.match(runnerMetro, /moduleName === 'crypto'/, 'Runner Metro must map Node crypto to QuickCrypto');
assert.match(runnerInbox, /SecureStore\.setItemAsync/, 'Runner must persist its DID key in secure storage');
assert.match(runnerInbox, /receiveNextPaymentNotification/, 'Runner must decrypt and persist relay events');
assert.match(runnerInbox, /openedReplayStore\.getLatest\(\)/, 'Runner must restore the latest saved event after relaunch');
assert.match(runnerInbox, /AppState\.addEventListener/, 'Runner must resume inbox polling with app foreground');
assert.match(runnerHome, /startPaymentNotificationInbox/, 'Runner home must start its encrypted inbox');
assert.match(runnerEnvExample, /EXPO_PUBLIC_DAMZ_RELAY_ONION_URL/);
assert.match(runnerEnvExample, /EXPO_PUBLIC_DAMZ_GATEWAY_DID/);

const runbook = await readFile(new URL('../DEVELOPMENT.md', import.meta.url), 'utf8');
assert.match(runbook, /Expo Go build distributed by[\s\S]*supports SDK 54 and earlier/);
assert.match(runbook, /development build/i);
assert.match(runbook, /EAS runs Expo\s+Prebuild from `app\.json`/);
assert.match(runbook, /`?SecureMemory`?\s+has no iOS or Android implementation yet/);
assert.match(runbook, /GATEWAY_PAYMENT_NOTIFICATIONS_ENABLED=true/);
assert.match(runbook, /not an APNs/);

console.log('mobile development build configuration verified');
