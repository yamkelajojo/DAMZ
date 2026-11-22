# ADR-0044: Privacy-Preserving Location Maps

**Status**: Accepted
**Date**: 2026-11-22

## Context

DAMZ will eventually need a Customer address picker and Runner navigation. The
exact delivery address belongs in the encrypted order chat. A Runner may keep a
coarse geohash locally, and the Customer may receive only a coarse location or
proof result. Sending exact coordinates to a map tile, geocoding, routing, or
live-tracking service would create a location disclosure outside that boundary.

Two local projects were reviewed as references:

- **CannaCollective mobile** has a MapLibre Native style backed by bundled local
  PMTiles archives (`durbanOfflineMap.ts`). Its November 18, 2026 proof report
  says the small 2 km² PMTiles fixture was generated, but rendering it offline
  in the native app was not verified. The small fixture is not suitable for
  default coverage.
- **CannaCollective Arena mobile** has a `react-native-maps` route preview and
  tests for normalizing decimal-string coordinates before passing them to
  native map props. Its live location and API-backed route patterns belong to
  that app's centralized delivery model and are not a fit for DAMZ.

## Decision

Use a locally rendered, offline-capable map for DAMZ address picking and Runner
navigation. Keep delivery coordinates on the device and inside the encrypted
peer-to-peer order flow. Do not send them to third-party geocoding, tile, or
routing services. Customer-visible runner location remains coarse, and must
never use a live GPS trail. This accepts the architecture; it does not certify
the current reference assets or claim that an offline router has been selected.

The CannaCollective PMTiles asset-loading and MapLibre style approach is a
candidate implementation reference. The Arena coordinate-normalization and
missing-coordinate fallback patterns are candidate UI references. Reimplement
the small pieces needed in DAMZ; do not import either project's live location
polling or their app-specific screens.

The local `.opensrc` cache also includes Ferrostar's React Native core and
MapLibre UI packages. Its custom route-provider API could support a future
on-device router, but the cached example targets Expo 55 / React Native 0.83,
while DAMZ currently targets Expo SDK 57 / React Native 0.86; compatibility has
not been established. The cached `maplibre-gl` package is the web renderer and
is not a direct native dependency. Neither source provides DAMZ with a verified
offline map archive, coverage data, or a tested offline route provider, so no
map dependency or asset is added yet.

## Consequences and gates

- DAMZ needs a custom development build for the map renderer and its native
  dependencies; Expo Go is not the map validation environment.
- A Runner map must remain useful without network access. A blank or missing
  local asset must show an explicit address-only fallback, never a fake route.
- A production map archive needs documented source, coverage bounds, zoom
  limits, OSM attribution, and a reproducible build/update process. The current
  tiny proof archive does not satisfy this gate.
- Offline routing is a separate capability from drawing offline map tiles. Do
  not imply turn-by-turn routing until a compatible on-device router and data
  set are selected and tested.
- Before adding a map dependency, verify compatibility with Expo SDK 57,
  React Native 0.86, iOS 16.4+, and the Android target, then validate the actual
  iPhone build with networking disabled.

## References

- Existing privacy boundary: `THREAT-MODEL.md` and `DB_LAYOUT_AND_ARCH.md`.
- CannaCollective reference: `mobile/src/features/rider/durbanOfflineMap.ts`
  and `docs/superpowers/reports/2026-11-18-mobile-map-pmtiles-proof.md`.
- CannaCollective Arena reference:
  `mobile/src/components/shared/RouteMap.tsx` and
  `mobile/src/components/shared/__tests__/RouteMap.decimal-coords.test.tsx`.
