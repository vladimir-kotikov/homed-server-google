/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
  },
  roots: ["<rootDir>/tests", "<rootDir>/src"],
  collectCoverageFrom: [
    "src/tcp/**/*.ts",
    "!src/**/*.d.ts",
    "!src/types/**/*.ts",
  ],
  testTimeout: 30000,
};
