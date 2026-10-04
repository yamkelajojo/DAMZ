# Distribution: F-Droid + GrapheneOS/CalyxOS from v1 (no Play Store)

**Status**: accepted

Target F-Droid (mainline) and GrapheneOS/CalyxOS app repositories from v1. No Google Play Store submission.

**Context**: SPEC listed Play Store rejection as high risk. Grilling confirmed the user base is privacy-first — GrapheneOS/CalyxOS users who sideload or use F-Droid. Play Store adds review risk, proprietary blob requirements, and telemetry exposure.

**Consequences**:
- **F-Droid**: Requires reproducible builds (same APK hash from source), no proprietary dependencies, metadata in `metadata/com.damz.customer.yml` + `metadata/com.damz.runner.yml`. CI must build on F-Droid's build server or provide reproducible build instructions. All dependencies must be in F-Droid archive or built from source.
- **GrapheneOS Apps repo**: Submit via their GitHub repo; they build and sign. Requires minimal permissions, no Google Play Services, targets hardened malloc/scudo.
- **Direct APK**: GitHub Releases with `apksigner` signatures, SHA256 checksums, and `minSdkVersion` 28.
- **No Play Services**: `react-native-nitro-tor`, `react-native-libsignal-client`, `react-native-mymonero-core` must not pull in Play Services transitive dependencies. Audit `build.gradle` carefully.
- **Auto-update**: F-Droid client handles updates. GrapheneOS Apps repo handles updates. Direct APK: implement in-app update check against GitHub Releases API (over Tor).