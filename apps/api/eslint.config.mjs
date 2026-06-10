import { defineConfig } from "eslint/config";
import wrgBase from "@wrg/config/eslint/base";

// Extend the shared WRG base (non-Next) config; add api-specific overrides below.
export default defineConfig([...wrgBase]);
