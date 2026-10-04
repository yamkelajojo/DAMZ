module.exports = {
  preset: 'jest-expo',
  testEnvironment: 'jsdom',
  setupFilesAfterFrame: ['<rootDir>/jest.setup.js'],
  testMatch: ['**/__tests__/**/*.test.ts', '**/__tests__/**/*.test.tsx'],
  transformIgnorePatterns: [
    'node_modules/(?!(react-native|expo|@expo|@react-native|@react-navigation|expo-modules-core|@nozbe\/watermelondb|@nozbe\/watermelondbcipher)/)',
  ],
  moduleNameMapper: {
    '^@damz/ui$': '<rootDir>/../ui/src',
    '^@damz/core$': '<rootDir>/../core/src',
    '^@damz/types$': '<rootDir>/../types/src',
  },
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/*.d.ts',
    '!src/__tests__/**',
  ],
};