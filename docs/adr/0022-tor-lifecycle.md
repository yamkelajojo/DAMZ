# ADR-0022: Tor Daemon: Foreground Service + Persistent Notification (Always-On)

**Status**: Accepted

## Context

`react-native-nitro-tor` runs Tor in-process. Mobile OS kills background daemons. Grilling chose always-on for reliable order notification delivery.

## Decision

Run Tor as Android Foreground Service + iOS Background App Refresh + PushKit. Persistent notification on Android. User can disable (graceful degradation to on-demand).

## Consequences

- **Android**: `react-native-foreground-service` or custom Kotlin module. Service type `DATA_SYNC`. Notification: "DAMZ: Tor active — protecting your privacy" (ongoing, non-dismissible). `START_STICKY` for restart on kill.
- **iOS**: `react-native-background-fetch` for periodic wake. `react-native-push-notification` + PushKit (VoIP) for incoming message wake. Requires `UIBackgroundModes: voip, fetch, remote-notification`.
- **Battery**: Expect 5-15% daily drain on modern devices. Document in onboarding. Provide "Battery Saver" setting that stops Tor when no active orders (hybrid fallback).
- **Tor config**: `SocksPort 9050`, `ControlPort 9051`, `HiddenServiceDir` for runner's onion (runner app only).
- **Circuit rotation**: Tor handles automatically. App detects circuit change via control port, re-establishes Signal sessions if needed.
- **Testing**: Verify Tor stays alive 24h+ on Android 14 / iOS 17 with screen off.