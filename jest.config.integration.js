/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests/integration'],
  testMatch: ['**/tests/integration/**/*.test.ts'],

  // Only run integration tests
  testPathIgnorePatterns: [
    '/node_modules/',
    '/dist/',
    '/tests/unit/', // Ignore unit tests in integration run
  ],

  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },

  // Increase timeout for integration tests
  testTimeout: 30000,

  // Use setup/teardown for Docker lifecycle
  globalSetup: '<rootDir>/tests/integration/jest.setup.ts',
  globalTeardown: '<rootDir>/tests/integration/jest.teardown.ts',
};
