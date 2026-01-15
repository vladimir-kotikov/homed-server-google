import eslint from "@eslint/js";
import prettierCompat from "eslint-config-prettier/flat";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig(
  eslint.configs.recommended,
  tseslint.configs.recommended,
  prettierCompat,
  [
    {
      rules: {
        "@typescript-eslint/no-explicit-any": "warn",
      },
    },
  ]
);
