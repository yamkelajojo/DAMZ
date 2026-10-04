module.exports = {
  testEnvironment: 'node',
  testMatch: [
    '<rootDir>/src/**/__tests__/**/*.test.ts',
    '<rootDir>/src/**/__tests__/**/*.test.tsx',
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
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        diagnostics: false,
        tsconfig: {
          target: 'ES2022',
          module: 'CommonJS',
          moduleResolution: 'Node',
          esModuleInterop: true,
          experimentalDecorators: true,
          strict: true,
        },
      },
    ],
  },
  clearMocks: true,
};
