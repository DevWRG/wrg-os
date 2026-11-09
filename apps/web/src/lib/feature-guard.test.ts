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

// /api/users (roster karyawan, 9 Nov 2026): dulu cukup login — viewer bisa upsert
// roster termasuk role & nomor WA. Upsert = create DAN edit di menu Users.
test("roster /users: viewer tanpa izin tertutup; upsert butuh create + edit", () => {
  const viewer = user({ role: "viewer", groups: [{ id: 3, key: "v", name: "Viewer" }], permissions: { overview: perm({ view: true }) } });
  assert.equal(featureAllowed(viewer, "/users", "view"), false);
  assert.equal(featureAllowed(viewer, "/users", "create"), false);
  const hr = user({ groups: [{ id: 4, key: "hr", name: "HR" }], permissions: { users: perm({ view: true, create: true }) } });
  assert.equal(featureAllowed(hr, "/users", "create"), true);
  assert.equal(featureAllowed(hr, "/users", "edit"), false); // create saja tak cukup untuk upsert
  assert.equal(featureAllowed(user({ superuser: true }), "/users", "edit"), true);
});

test("roster dibaca form cuti: izin lihat Manage Leave cukup untuk GET", () => {
  const u = user({ groups: [{ id: 5, key: "hrd", name: "HRD" }], permissions: { leave: perm({ view: true }) } });
  assert.equal(featureAllowed(u, "/leave", "view"), true);
  assert.equal(featureAllowed(u, "/users", "view"), false);
});

// Gelombang 2 penambalan BFF (9 Nov 2026): draft penagihan, cuti, hari libur.
test("Collection Drafts: approve/send/cancel butuh edit; lihat saja tak cukup", () => {
  const u = user({ groups: [{ id: 6, key: "fin", name: "Finance" }], permissions: { "collection-drafts": perm({ view: true }) } });
  assert.equal(featureAllowed(u, "/collection-drafts", "view"), true);
  assert.equal(featureAllowed(u, "/collection-drafts", "edit"), false);
  assert.equal(featureAllowed(user({}), "/collection-drafts", "view"), false);
});

test("Manage Leave & Holidays: tiap aksi tulis ikut matriks", () => {
  const u = user({ groups: [{ id: 7, key: "hrd", name: "HRD" }], permissions: {
    leave: perm({ view: true, create: true, edit: true }),
    holidays: perm({ view: true, create: true }),
  } });
  assert.equal(featureAllowed(u, "/leave", "edit"), true); // putuskan cuti
  assert.equal(featureAllowed(u, "/leave", "delete"), false);
  assert.equal(featureAllowed(u, "/holidays", "create"), true);
  assert.equal(featureAllowed(u, "/holidays", "edit"), false); // upsert libur butuh edit juga
  assert.equal(featureAllowed(u, "/holidays", "delete"), false);
});
