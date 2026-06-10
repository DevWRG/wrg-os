// Shared base ESLint flat config for non-Next TypeScript packages (Node services, libs).
// Consume from a package's eslint.config.mjs:
//   import wrgBase from "@wrg/config/eslint/base";
//   export default wrgBase;  // or defineConfig([...wrgBase, ...overrides])
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import { defineConfig, globalIgnores } from "eslint/config";

const config = defineConfig([
  js.configs.recommended,
  ...tseslint.configs.recommended,
  globalIgnores(["dist/**", "node_modules/**"]),
]);

export default config;
