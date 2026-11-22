# Mobile development and iPhone testing

## Choose the right client

The three apps currently target Expo SDK 57. The Expo Go build distributed by
Apple's App Store supports SDK 54 and earlier; it cannot open this SDK 57
project. Expo documents a separately built Expo Go app through TestFlight for
SDK 54+, but it still would not contain DAMZ's configured SQLCipher build or
native Tor, QuickCrypto, and wallet libraries. Keep the SDK at 57 and use a
DAMZ development build for device work.

Expo Go remains useful for projects whose native requirements are already in
Expo Go. It is not a valid way to check DAMZ's SQLCipher configuration, Tor,
wallet, or native map integration. Customer and Converter still have scaffold
home routes; Runner now has an encrypted payment-inbox status screen.

Sources: [Expo Go SDK mismatch guidance](https://docs.expo.dev/troubleshooting/expo-go-version-mismatch/),
[Expo custom native code guidance](https://docs.expo.dev/workflow/customizing/).

## Build Customer for iPhone 17

EAS configuration is kept inside each app folder, as required for an Expo
monorepo. Run the iOS commands from `apps/customer`:

```powershell
Set-Location C:\Users\Acer\Documents\Software\2026\DAMZ\apps\customer
bunx eas-cli@latest login
bunx eas-cli@latest init
bunx eas-cli@latest device:create
bunx eas-cli@latest build --platform ios --profile development
```

The first build needs an Expo account and an Apple Developer account so EAS can
sign an iOS development build and register the iPhone. Enable Developer Mode
on the iPhone when iOS asks. Install the finished build from the EAS build page
using its install link or QR code.

Each app ignores its generated `android` and `ios` folders so EAS runs Expo
Prebuild from `app.json`. The incomplete native folders currently present on
this workstation are left untouched and are not used as build inputs. Keep
future hand-maintained native modules in a workspace package and wire them
through Expo autolinking/config plugins; do not rely on edits inside generated
folders surviving a clean prebuild.

Then start Metro from the same app folder:

```powershell
bun run start:dev-client
```

Keep the iPhone and development computer on the same network. If local network
discovery is unavailable, start Expo with its tunnel option:

```powershell
bunx expo start --dev-client --tunnel
```

Open the installed **DAMZ Customer** development app and select the running
Metro server. The dev build is a native binary: rebuild it after changing a
native dependency, config plugin, or native app setting. JavaScript and screen
changes can then reload from Metro.

The map direction is documented in [ADR-0044](docs/adr/0044-offline-location-visualization.md).
No map screen or production map archive is included in the current scaffold.

For Runner or Converter, repeat the EAS commands from `apps/runner` or
`apps/converter`; each app has a separate EAS project and bundle identifier.

The Runner includes `react-native-quick-crypto` for HPKE's native WebCrypto
operations and Ed25519-to-X25519 derivation. Its `index.js` installs the native
crypto runtime before Expo Router starts, and Metro maps Noble's `crypto`
import to that native implementation. Build Runner as a development client;
Expo Go does not include this native dependency. Rebuild Runner after changing
QuickCrypto, Nitro Modules, or its native config.

To enable the Runner's encrypted payment inbox during local development, copy
`apps/runner/.env.example` to `apps/runner/.env` and set the public relay v3
onion URL and pinned Gateway DID. Expo inlines these `EXPO_PUBLIC_` values
when Metro builds the app bundle. For an EAS cloud build that must work from
its embedded bundle without a local Metro server, add the same values to the
EAS project's `development` environment; ignored local `.env` files are not
available to remote build jobs. These two values are public configuration;
never put a private key in an `EXPO_PUBLIC_` variable. On first launch, Runner
creates a `did:key`, saves its private key in device-only secure storage,
starts Tor, and displays the DID and relay recipient hash for payment setup.
The inbox polls while the app is open and checks again when it returns to the
foreground; iOS can suspend polling in the background, so this is not an APNs
push notification.

Gateway-to-Runner payment notifications remain disabled by default. After the
Gateway auth/replay checks, Runner durable replay checks, and Rust/TypeScript
interoperability check pass, enable
`GATEWAY_PAYMENT_NOTIFICATIONS_ENABLED=true` only on an isolated development
Gateway to perform the iPhone 17 receive/decrypt smoke check. Keep it disabled
in production: Gateway payments are still mock-mode and in-memory, and the
device run does not make this a production payment integration.

## What this launch proves

The development client includes the native runtime required by config plugins
and native libraries. A successful launch proves that the installed binary can
load the current JavaScript bundle. It does not prove that SQLCipher actually
encrypts the database, Tor routes traffic correctly, or wallet operations are
safe. In particular, `SecureMemory` has no iOS or Android implementation yet;
wallet actions must stay unavailable until that native module is implemented
and tested on-device.

### iPhone smoke-check record

Record these observations after the first physical-device run:

- Build ID and source revision:
- iOS version:
- Customer app opens from its icon:
- Placeholder home route renders:
- Theme preference loads and changes:
- Metro reload works after a JavaScript edit:
- Any crash, red screen, or native-module warning:
- Features intentionally unavailable in this build:

Do not record wallet seeds, private keys, order addresses, or other user data
in this checklist.

### Runner encrypted-inbox smoke-check

After the automated relay and notification gates pass, use an isolated
development Gateway and record these observations on the iPhone 17:

- Runner build ID and source revision:
- iOS version:
- Tor starts and the inbox reaches ready:
- A signed test callback returns `202` from the Gateway:
- Runner displays the matching payment confirmation:
- The saved event returns after restarting Runner:
- The relay item is acknowledged after the encrypted database write:
- Any crash, red screen, or native-module warning:

Record only pass/fail and service/build identifiers. Do not copy DID private
keys, relay secrets, real payment data, or order addresses into the report.
