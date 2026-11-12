import assert from "node:assert/strict";
import { test } from "node:test";

import { Hono } from "hono";

import { signJwt } from "./auth.js";
import { gerbangAuth, nilaiJwt } from "./auth-gate.js";

test("nilaiJwt: hanya role admin, identitas dari sub", () => {
  assert.deepEqual(nilaiJwt(null), { ok: false, status: 401, error: "unauthorized" });
  assert.equal(nilaiJwt({ role: "admin" }).ok, false); // tanpa sub
  const am = nilaiJwt({ sub: "u-am", role: "user" });
  assert.equal(am.ok, false);
  assert.equal(!am.ok && am.status, 403);
  assert.equal(nilaiJwt({ sub: "u-dir", role: "direktur" }).ok, false);
  assert.deepEqual(nilaiJwt({ sub: "u-adm", role: " Admin " }), { ok: true, userId: "u-adm" });
});

function appUji() {
  const app = new Hono();
  app.use("*", gerbangAuth({ enabled: () => true, serviceToken: () => "svc-uji" }));
  app.get("/siapa", (c) => c.json({ user: c.req.header("x-user-id") ?? null }));
  app.post("/putus", (c) => c.json({ user: c.req.header("x-user-id") ?? null }));
  app.get("/health", (c) => c.json({ ok: true }));
  return app;
}

test("gerbangAuth: service token tetap meneruskan x-user-id dari BFF", async () => {
  const r = await appUji().request("/siapa", { headers: { "x-service-token": "svc-uji", "x-user-id": "u-dari-bff" } });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { user: "u-dari-bff" });
});

test("gerbangAuth: JWT non-admin ditolak 403 walau memalsu x-user-id", async () => {
  const tok = signJwt({ sub: "u-am", role: "user" });
  const r = await appUji().request("/putus", { method: "POST", headers: { authorization: `Bearer ${tok}`, "x-user-id": "u-hod" } });
  assert.equal(r.status, 403);
});

test("gerbangAuth: JWT admin → x-user-id dipaksa = pemilik token", async () => {
  const tok = signJwt({ sub: "u-adm", role: "admin" });
  const r = await appUji().request("/siapa", { headers: { authorization: `Bearer ${tok}`, "x-user-id": "u-orang-lain" } });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { user: "u-adm" });
});

test("gerbangAuth: tanpa token / token palsu / service token salah → 401; /health bebas", async () => {
  const app = appUji();
  assert.equal((await app.request("/siapa")).status, 401);
  assert.equal((await app.request("/siapa", { headers: { authorization: "Bearer x.y.z" } })).status, 401);
  assert.equal((await app.request("/siapa", { headers: { "x-service-token": "salah" } })).status, 401);
  assert.equal((await app.request("/health")).status, 200);
});
