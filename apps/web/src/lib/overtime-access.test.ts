import assert from "node:assert/strict";
import { test } from "node:test";

import { canViewOvertime, overtimeScope } from "./overtime-access.js";

const izin = (edit = false) => ({ overtime: { active: true, view: true, create: false, edit, delete: false } });
const grup = [{ id: 1, key: "hr", name: "HR" }];

test("staf HR pemegang fitur 'overtime' melihat semua divisi", () => {
  assert.deepEqual(overtimeScope({ role: "user", rbac: true, groups: grup, permissions: izin() }), { all: true });
});

test("HoD pemegang fitur hanya melihat divisinya; dengan edit = semua", () => {
  const hod = { role: "user", is_hod: true, hod_key: "rocky", rbac: true, groups: grup };
  assert.deepEqual(overtimeScope({ ...hod, permissions: izin() }), { all: false, hodKey: "rocky" });
  assert.deepEqual(overtimeScope({ ...hod, permissions: izin(true) }), { all: true });
});

test("admin & direktur melihat semua", () => {
  assert.deepEqual(overtimeScope({ role: "admin", rbac: true, groups: [], permissions: {} }), { all: true });
  assert.deepEqual(overtimeScope({ role: "direktur", rbac: true, groups: grup, permissions: izin() }), { all: true });
});

test("matriks yang menutup 'overtime' menang atas HoD", () => {
  const tutup = { overtime: { active: true, view: false, create: false, edit: false, delete: false } };
  assert.equal(overtimeScope({ role: "user", is_hod: true, hod_key: "rocky", rbac: true, groups: grup, permissions: tutup }), null);
});

test("fitur belum diatur → hanya HoD yang lolos (fallback), user biasa tidak", () => {
  assert.equal(canViewOvertime({ role: "user", is_hod: true, hod_key: "rocky", rbac: true, groups: grup, permissions: {} }), true);
  assert.equal(canViewOvertime({ role: "user", rbac: true, groups: grup, permissions: {} }), false);
});

test("HoD tanpa hod_key tak bisa di-scope → ditolak", () => {
  assert.equal(overtimeScope({ role: "user", is_hod: true, rbac: true, groups: grup, permissions: izin() }), null);
});
