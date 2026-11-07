import { test } from "node:test";
import assert from "node:assert/strict";

import { featureAllowed } from "./feature-guard";
import type { SessionUserSrv } from "./admin-guard";

// Gerbang BFF approval/forecast/PO (uji dev 11 Okt 2026): keputusan harus sama
// dengan gerbang halaman, plus aksi tulis mengikuti matriks Akses Grup.
const perm = (p: Partial<{ view: boolean; create: boolean; edit: boolean; delete: boolean }>) => ({
  active: true, view: false, create: false, edit: false, delete: false, ...p,
});
const user = (o: Partial<SessionUserSrv>): SessionUserSrv =>
  ({ id: "u", email: "u@x", role: "user", rbac: true, groups: [], permissions: {}, ...o }) as SessionUserSrv;

test("user login tanpa grup → tertutup (dulu bisa ubah config chain)", () => {
  assert.equal(featureAllowed(user({}), "/approval-requests", "view"), false);
  assert.equal(featureAllowed(user({}), "/forecast-submission", "create"), false);
});

test("admin / superuser → terbuka", () => {
  assert.equal(featureAllowed(user({ role: "admin" }), "/purchase-orders", "delete"), true);
  assert.equal(featureAllowed(user({ superuser: true }), "/approval-requests", "create"), true);
});

test("grup tanpa baris izin fitur ini → tertutup (fitur baru default tertutup)", () => {
  const u = user({ groups: [{ id: 2, key: "op", name: "Operator" }], permissions: { overview: perm({ view: true }) } });
  assert.equal(featureAllowed(u, "/approval-requests", "view"), false);
});

test("izin view saja → boleh lihat, tak boleh create/edit", () => {
  const u = user({ groups: [{ id: 2, key: "op", name: "Operator" }], permissions: { "forecast-submission": perm({ view: true }) } });
  assert.equal(featureAllowed(u, "/forecast-submission", "view"), true);
  assert.equal(featureAllowed(u, "/forecast-submission", "create"), false);
  assert.equal(featureAllowed(u, "/forecast-submission", "edit"), false);
});

test("izin view+create → boleh buat", () => {
  const u = user({ groups: [{ id: 2, key: "sc", name: "SC" }], permissions: { "purchase-orders": perm({ view: true, create: true }) } });
  assert.equal(featureAllowed(u, "/purchase-orders", "create"), true);
  assert.equal(featureAllowed(u, "/purchase-orders", "delete"), false);
});

test("path menu salah ketik → tertutup, bukan terbuka", () => {
  assert.equal(featureAllowed(user({ role: "admin" }), "/tidak-ada-menu-ini", "view"), false);
});
