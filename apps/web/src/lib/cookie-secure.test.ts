import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { cookieSecure } from "./cookie-secure.js";

const DEV_DB = "postgres:///wrg_os_dev";
const PROD_DB = "postgres:///wrg_os_prod";

function senyap<T>(fn: () => T): T {
  const asli = console.warn;
  console.warn = () => {};
  try {
    return fn();
  } finally {
    console.warn = asli;
  }
}

test("produksi tanpa flag → Secure (default aman)", () => {
  assert.equal(cookieSecure({ NODE_ENV: "production" } as NodeJS.ProcessEnv), true);
  assert.equal(
    cookieSecure({ NODE_ENV: "production", DATABASE_URL: PROD_DB } as NodeJS.ProcessEnv),
    true,
  );
});

test("bukan produksi → tidak Secure (perilaku lama tak berubah)", () => {
  assert.equal(cookieSecure({ NODE_ENV: "development" } as NodeJS.ProcessEnv), false);
  assert.equal(cookieSecure({} as NodeJS.ProcessEnv), false);
});

test("tumpukan dev: NODE_ENV=production + COOKIE_SECURE=false + DB dev → tidak Secure", () => {
  // Inti perbaikan ini: inilah kombinasi yang dipakai wrg-dev-web.
  assert.equal(
    cookieSecure({
      NODE_ENV: "production",
      COOKIE_SECURE: "false",
      DATABASE_URL: DEV_DB,
    } as NodeJS.ProcessEnv),
    false,
  );
  assert.equal(
    cookieSecure({
      NODE_ENV: "production",
      COOKIE_SECURE: "false",
      DATABASE_URL: "postgres:///wrg_os_demo",
    } as NodeJS.ProcessEnv),
    false,
  );
});

test("PENJAGA: COOKIE_SECURE=false DIABAIKAN kalau DB bukan dev/demo", () => {
  // Skenario nyata: seseorang menyalin blok env dev ke .env.prod. Kalau opt-out
  // dihormati di sana, cookie sesi produksi bisa dibaca lewat HTTP biasa.
  for (const db of [PROD_DB, "", "postgres://user@host/wrg_os_production", "postgres:///dev_wrg_os"]) {
    assert.equal(
      senyap(() =>
        cookieSecure({
          NODE_ENV: "production",
          COOKIE_SECURE: "false",
          DATABASE_URL: db,
        } as NodeJS.ProcessEnv),
      ),
      true,
      `opt-out tak boleh dihormati untuk DATABASE_URL=${JSON.stringify(db)}`,
    );
  }
});

test("penjaga yang menolak opt-out WAJIB mengatakan sebabnya", () => {
  // Penjaga yang diam berarti orang mengira COOKIE_SECURE=false-nya bekerja.
  const pesan: string[] = [];
  const asli = console.warn;
  console.warn = (...a: unknown[]) => pesan.push(a.map(String).join(" "));
  try {
    cookieSecure({
      NODE_ENV: "production",
      COOKIE_SECURE: "false",
      DATABASE_URL: PROD_DB,
    } as NodeJS.ProcessEnv);
  } finally {
    console.warn = asli;
  }
  assert.match(pesan.join("\n"), /COOKIE_SECURE=false DIABAIKAN/);
  assert.match(pesan.join("\n"), /DATABASE_URL/);
});

test("COOKIE_SECURE=true memaksa Secure walau bukan produksi", () => {
  assert.equal(
    cookieSecure({ NODE_ENV: "development", COOKIE_SECURE: "true" } as NodeJS.ProcessEnv),
    true,
  );
});

test("hanya string 'false' yang dianggap opt-out — bukan nilai mirip-falsy", () => {
  // "0"/"no"/"" gampang ditulis orang dan gampang disalahartikan. Yang tak
  // dikenali harus jatuh ke sisi AMAN, bukan ke sisi terbuka.
  for (const v of ["0", "no", "", "FALSE", "off"]) {
    assert.equal(
      cookieSecure({
        NODE_ENV: "production",
        COOKIE_SECURE: v,
        DATABASE_URL: DEV_DB,
      } as NodeJS.ProcessEnv),
      true,
      `COOKIE_SECURE=${JSON.stringify(v)} tak boleh membuka Secure`,
    );
  }
});

test("login route memakai cookieSecure(), bukan cek NODE_ENV inline", () => {
  // Tanpa ini, seseorang bisa mengembalikan `secure: NODE_ENV === "production"`
  // ke route-nya dan seluruh berkas ini jadi hiasan.
  const p = fileURLToPath(new URL("../app/api/auth/login/route.ts", import.meta.url));
  const src = readFileSync(p, "utf8");
  assert.match(src, /cookieSecure\(\)/, "login route harus memanggil cookieSecure()");
  assert.doesNotMatch(
    src,
    /secure:\s*process\.env\.NODE_ENV\s*===/,
    "cek NODE_ENV inline sudah kembali — itu bug yang diperbaiki PR ini",
  );
});
