// Deliberately empty stand-in for `expo/src/winter`.
//
// jest-expo@57 requires `expo/src/winter` from its preset setup. That module
// pulls in the Expo native runtime (`getBundleUrl.native` -> `NativeSourceCode`
// TurboModule), which cannot resolve under this repo's pinned react-native@0.76.
// @damz/core unit tests exercise pure TypeScript with all native modules mocked,
// so the Expo winter runtime is unnecessary here.
//
// Remove this file (and the matching moduleNameMapper entry in jest.config.js)
// once react-native is aligned to the Expo SDK 57 pin (0.86.3).
module.exports = {};
