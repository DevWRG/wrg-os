// Shared Next.js + TypeScript ESLint flat config for WRG monorepo apps.
// Consume from an app's eslint.config.mjs:
//   import wrgNext from "@wrg/config/eslint/next";
//   export default wrgNext;  // or spread into defineConfig([...wrgNext, ...overrides])
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const config = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts"]),
]);

export default config;
