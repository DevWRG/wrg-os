import { test } from "node:test";
import assert from "node:assert/strict";

import { featureAllowed } from "./feature-guard";
import type { SessionUserSrv } from "./admin-guard";

// Gerbang BFF per fitur menu (asal: uji dev F11/PO 11 Okt 2026; di main diuji lewat /print-spec): keputusan harus sama
// dengan gerbang halaman, plus aksi tulis mengikuti matriks Akses Grup.
const perm = (p: Partial<{ view: boolean; create: boolean; edit: boolean; delete: boolean }>) => ({
  active: true, view: false, create: false, edit: false, delete: false, ...p,
});
const user = (o: Partial<SessionUserSrv>): SessionUserSrv =>
  ({ id: "u", email: "u@x", role: "user", rbac: true, groups: [], permissions: {}, ...o }) as SessionUserSrv;

test("user login tanpa grup → tertutup (dulu bisa ubah config chain)", () => {
  assert.equal(featureAllowed(user({}), "/print-spec", "view"), false);
  assert.equal(featureAllowed(user({}), "/print-spec", "create"), false);
});

test("admin / superuser → terbuka", () => {
  assert.equal(featureAllowed(user({ role: "admin" }), "/print-spec", "delete"), true);
  assert.equal(featureAllowed(user({ superuser: true }), "/print-spec", "create"), true);
});

test("grup tanpa baris izin fitur ini → tertutup (fitur baru default tertutup)", () => {
  const u = user({ groups: [{ id: 2, key: "op", name: "Operator" }], permissions: { overview: perm({ view: true }) } });
  assert.equal(featureAllowed(u, "/print-spec", "view"), false);
});

test("izin view saja → boleh lihat, tak boleh create/edit", () => {
  const u = user({ groups: [{ id: 2, key: "op", name: "Operator" }], permissions: { "print-spec": perm({ view: true }) } });
  assert.equal(featureAllowed(u, "/print-spec", "view"), true);
  assert.equal(featureAllowed(u, "/print-spec", "create"), false);
  assert.equal(featureAllowed(u, "/print-spec", "edit"), false);
});

test("izin view+create → boleh buat", () => {
  const u = user({ groups: [{ id: 2, key: "sc", name: "SC" }], permissions: { "print-spec": perm({ view: true, create: true }) } });
  assert.equal(featureAllowed(u, "/print-spec", "create"), true);
  assert.equal(featureAllowed(u, "/print-spec", "delete"), false);
});

test("path menu salah ketik → tertutup, bukan terbuka", () => {
  assert.equal(featureAllowed(user({ role: "admin" }), "/tidak-ada-menu-ini", "view"), false);
});
