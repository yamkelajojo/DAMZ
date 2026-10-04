module.exports = {
  preset: 'jest-expo',
  testEnvironment: 'jsdom',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  testMatch: ['**/__tests__/**/*.test.ts', '**/__tests__/**/*.test.tsx'],
  transformIgnorePatterns: [
    'node_modules/(?!(react-native|expo|@expo|@react-native|@react-navigation|expo-modules-core|react-native-reanimated|react-native-gesture-handler|react-native-nitro-tor|react-native-libsignal-client|react-native-mymonero-core|@ipfs-meshkit|@ajna-inc|@realreel|@did-tools)/)',
  ],
  moduleNameMapper: {
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