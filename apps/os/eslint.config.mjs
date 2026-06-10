import { defineConfig } from "eslint/config";
import wrgNext from "@wrg/config/eslint/next";

// Extend the shared WRG Next.js config; add app-specific overrides below.
export default defineConfig([...wrgNext]);
