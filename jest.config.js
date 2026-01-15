/** @type {import('ts-jest').JestConfigWithTsJest} */
const baseConfig = require("./jest.config.base");

module.exports = {
  ...baseConfig,
  roots: ["<rootDir>/tests", "<rootDir>/src"],
  testMatch: ["**/__tests__/**/*.ts", "**/?(*.)+(spec|test).ts"],

  // Exclude integration tests from default test run
  testPathIgnorePatterns: ["/node_modules/", "/dist/", "/tests/integration/"],

  collectCoverageFrom: [
    "src/tcp/**/*.ts",
    "!src/**/*.d.ts",
    "!src/types/**/*.ts",
  ],
  coverageThreshold: {
    global: {
      branches: 60,
      functions: 80,
      lines: 75,
      statements: 75,
    },
  },
};
