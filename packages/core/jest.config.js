module.exports = {
  preset: 'jest-expo',
  // These suites are pure-JS logic with every native module mocked. The jsdom
  // environment is unnecessary and actively harmful here: it installs its own
  // realm's typed arrays, so `instanceof Uint8Array` fails inside the
  // @digitalbazaar crypto libraries ("\"bytes\" must be a Uint8Array").
  testEnvironment: 'node',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  testMatch: ['**/__tests__/**/*.test.ts', '**/__tests__/**/*.test.tsx'],
  // Bun hoists every dependency into node_modules/.bun/<name>@<version>/node_modules/<name>/.
  // The outer store directory must be treated as "transparent" (allowed), otherwise it
  // matches the ignore branch before the inner node_modules/<pkg>/ can allow-list the package.
  transformIgnorePatterns: [
    'node_modules/(?!(?:\\.bun|react-native|expo|@expo|@react-native|@react-navigation|expo-modules-core|react-native-reanimated|react-native-gesture-handler|react-native-nitro-tor|react-native-libsignal-client|react-native-mymonero-core|@ipfs-meshkit|@ajna-inc|@realreel|@did-tools|@digitalbazaar|base58-universal|base64url-universal|crypto-ld|@noble|@stablelib|multiformats|@multiformats)/)',
  ],
  moduleNameMapper: {
    // jest-expo@57 boots `expo/src/winter` from its preset setup, which reaches
    // RN 0.86-era native specs (`NativeSourceCode`) and throws on this repo's
    // pinned react-native@0.76. These unit tests are pure JS with all native
    // modules mocked, so the Expo runtime is not needed.
    // TODO(react-native-0.86): remove this shim once react-native is aligned to
    // the Expo SDK 57 pin (0.86.3).
    '^expo/src/winter$': '<rootDir>/jest.expo-winter.stub.js',
    // jest-expo's TypeScript mapping points `react-native` at a hoisted
    // <rootDir>/../node_modules/react-native, which does not exist under bun's
    // isolated (per-workspace) linker. Resolve the real package explicitly.
    '^react-native$': require.resolve('react-native'),
    '^@damz/ui$': '<rootDir>/../ui/src',
    '^@damz/core$': '<rootDir>/src',
    '^@damz/types$': '<rootDir>/../types/src',
    '^@damz/db$': '<rootDir>/../db/src',
  },
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/*.d.ts',
    '!src/__tests__/**',
  ],
  coverageThreshold: {
    global: {
      branches: 50,
      functions: 50,
      lines: 50,
      statements: 50,
    },
  },
};