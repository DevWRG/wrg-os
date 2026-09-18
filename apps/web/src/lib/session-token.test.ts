import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";

import { sessionTokenValid } from "./session-token";

// Aman dipasang SESUDAH impor: modulnya membaca JWT_SECRET saat panggilan
// pertama, bukan saat evaluasi modul (dan cache kuncinya dikunci ke nilai
// rahasia, jadi perubahan nilai tak pernah terpakai basi).
process.env.JWT_SECRET = "rahasia-uji";

// Tiruan signJwt() apps/api/src/auth.ts — sengaja ditulis ulang, bukan diimpor:
// kalau keduanya berbagi implementasi, tes ini akan tetap hijau walau formatnya
// berubah di satu sisi saja.
function signJwt(payload: Record<string, unknown>, secret = "rahasia-uji"): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const data = `${header}.${body}`;
  const sig = createHmac("sha256", secret).update(data).digest("base64url");
  return `${data}.${sig}`;
}

const nanti = Math.floor(Date.now() / 1000) + 3600;
const tadi = Math.floor(Date.now() / 1000) - 3600;

test("token sah + belum kedaluwarsa → lolos", async () => {
  assert.equal(await sessionTokenValid(signJwt({ sub: "u1", exp: nanti })), true);
});

test("cookie asal-asalan → ditolak (ini lubang yang ditambal)", async () => {
  assert.equal(await sessionTokenValid("ngasal"), false);
  assert.equal(await sessionTokenValid("a.b.c"), false);
});

test("tanda tangan dari rahasia lain → ditolak", async () => {
  assert.equal(await sessionTokenValid(signJwt({ sub: "u1", exp: nanti }, "rahasia-lain")), false);
});

test("payload diubah tanpa tanda tangan ulang → ditolak", async () => {
  const asli = signJwt({ sub: "viewer", exp: nanti });
  const [h, , s] = asli.split(".");
  const palsu = Buffer.from(JSON.stringify({ sub: "admin", exp: nanti })).toString("base64url");
  assert.equal(await sessionTokenValid(`${h}.${palsu}.${s}`), false);
});

test("token kedaluwarsa → ditolak", async () => {
  assert.equal(await sessionTokenValid(signJwt({ sub: "u1", exp: tadi })), false);
});

test("token tanpa exp → ditolak, bukan dianggap abadi", async () => {
  assert.equal(await sessionTokenValid(signJwt({ sub: "u1" })), false);
});

test("kosong / undefined → ditolak tanpa melempar", async () => {
  assert.equal(await sessionTokenValid(""), false);
  assert.equal(await sessionTokenValid(undefined), false);
  assert.equal(await sessionTokenValid(null), false);
});
