import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { canViewRaportList } from "./raport-access.js";

const view = { active: true, view: true, create: false, edit: false, delete: false };
const group = [{ id: 1, key: "direksi", name: "Direksi" }];

test("Direktur dgn izin 'karyawan' di matriks Akses Grup boleh lihat daftar raport", () => {
  assert.equal(canViewRaportList({ role: "direktur", rbac: true, groups: group, permissions: { karyawan: view } }), true);
});

test("matriks yang melepas 'karyawan' menang atas HoD", () => {
  const off = { ...view, view: false };
  assert.equal(canViewRaportList({ role: "user", is_hod: true, rbac: true, groups: group, permissions: { karyawan: off } }), false);
});

test("fitur belum diatur di matriks → gate lama: HoD/admin ya, user biasa tidak", () => {
  assert.equal(canViewRaportList({ role: "user", is_hod: true, rbac: true, groups: group, permissions: {} }), true);
  assert.equal(canViewRaportList({ role: "user", rbac: true, groups: group, permissions: {} }), false);
  assert.equal(canViewRaportList({ role: "admin", rbac: true, groups: [], permissions: {} }), true);
});

// Halaman /karyawan dan API BFF-nya WAJIB satu gerbang. Dulu API memakai
// requireHodOrAdmin: Direktur lolos ke halaman via matriks, API 403, halaman
// tampil kosong "Hanya HoD/admin…".
test("route BFF raport memakai canViewRaportList, bukan requireHodOrAdmin", () => {
  for (const f of ["../app/api/raport/list/route.ts", "../app/api/raport/[amId]/route.ts"]) {
    const src = readFileSync(new URL(f, import.meta.url), "utf8");
    assert.match(src, /canViewRaportList\(me\)/, f);
    assert.doesNotMatch(src, /requireHodOrAdmin\(/, f);
  }
});
