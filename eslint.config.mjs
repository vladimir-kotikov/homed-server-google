import eslint from "@eslint/js";
import prettierCompat from "eslint-config-prettier/flat";
import unicorn from "eslint-plugin-unicorn";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig(
  eslint.configs.recommended,
  tseslint.configs.recommended,
  prettierCompat,
  [
    {
      plugins: { unicorn },
      rules: {
        "@typescript-eslint/no-explicit-any": "error",
        "@typescript-eslint/no-unused-vars": [
          "error",
          { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
        ],
        "unicorn/no-null": "error",
        "unicorn/filename-case": [
          "warn",
          {
            case: "camelCase",
          },
        ],
        "unicorn/prevent-abbreviations": [
          "error",
          {
            allowList: {
              args: true,
            },
          },
        ],
      },
    },
  ],
  [
    {
      files: ["tests/**/*.ts"],
      rules: {
        "@typescript-eslint/no-explicit-any": "off",
      },
    },
  ]
);
