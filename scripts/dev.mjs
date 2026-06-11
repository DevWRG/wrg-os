#!/usr/bin/env node
// Dev launcher: load the monorepo-root .env into the environment, then run
// `turbo run dev` in loose env-mode so every app inherits the FULL environment.
//
// Why this exists: Turbo 2.x defaults to *strict* env-mode, where tasks only
// receive a built-in passlist of env vars. `globalDependencies: [".env"]` only
// adds .env to the cache hash — it does NOT load it into the environment. So a
// plain `turbo run dev` leaves AUTH_ENABLED / API_SERVICE_TOKEN / JWT_SECRET /
// DATABASE_URL unset, and the auth gate silently stays off after every restart.
//
// This script parses the root .env itself and runs Turbo with --env-mode=loose
// (the dev task is cache:false, so loose mode has no caching downside), so
// apps/api (tsx) and apps/web (next dev) both see the same env that was proven
// to enable AUTH end-to-end.
//
// Precedence: a real shell env var always wins over .env, so overrides like
// `AUTH_ENABLED=false pnpm dev` still work. A missing .env is fine (CI / fresh
// clone) — the script just runs Turbo with whatever the shell already provides.
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Minimal KEY=VALUE .env parser (no dependency). Returns count loaded. */
function loadDotEnv(path) {
  let raw;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return 0; // no .env — nothing to load
  }
  let n = 0;
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq < 0) continue;
    const key = t.slice(0, eq).trim();
    if (!key || key in process.env) continue; // shell env wins over .env
    let val = t.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    process.env[key] = val;
    n++;
  }
  return n;
}

const loaded = loadDotEnv(join(root, ".env"));
const authOn = (process.env.AUTH_ENABLED ?? "").toLowerCase() === "true";
console.log(`[dev] loaded ${loaded} var(s) from .env · AUTH_ENABLED=${authOn}`);

// --env-mode=loose → pass the full parent environment through to every task.
const args = ["run", "dev", "--env-mode=loose", ...process.argv.slice(2)];
const child = spawn("turbo", args, { stdio: "inherit", env: process.env, cwd: root });

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => child.kill(sig));
}
