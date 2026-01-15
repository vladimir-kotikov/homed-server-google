/** @type {import('ts-jest').JestConfigWithTsJest} */
const baseConfig = require("./jest.config.base");

module.exports = {
  ...baseConfig,
  roots: ["<rootDir>/tests/integration"],
  testMatch: ["**/tests/integration/**/*.test.ts"],

  // Only run integration tests
  testPathIgnorePatterns: [
    "/node_modules/",
    "/dist/",
    "/tests/unit/", // Ignore unit tests in integration run
  ],

  // Increase timeout for integration tests
  testTimeout: 30000,
};
