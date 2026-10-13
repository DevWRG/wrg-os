import assert from "node:assert/strict";
import { test } from "node:test";

import { canViewAdoption } from "./adoption-access.js";

const view = { active: true, view: true, create: false, edit: false, delete: false };
const group = [{ id: 1, key: "g", name: "G" }];

test("P5 admin/superuser/Direktur boleh (fitur belum diatur)", () => {
  assert.equal(canViewAdoption({ role: "admin", rbac: true, groups: [], permissions: {} }), true);
  assert.equal(canViewAdoption({ role: "user", superuser: true, rbac: true, groups: group, permissions: {} }), true);
  assert.equal(canViewAdoption({ role: "direktur", rbac: true, groups: group, permissions: {} }), true);
});
test("N1 tertutup default: HoD, user biasa, dan tanpa sesi ditolak", () => {
  assert.equal(canViewAdoption({ role: "user", is_hod: true, hod_key: "rocky", rbac: true, groups: group, permissions: {} }), false);
  assert.equal(canViewAdoption({ role: "user", rbac: true, groups: group, permissions: {} }), false);
  assert.equal(canViewAdoption(null), false);
});
test("P6 HoD yang dicentang di matriks boleh", () => {
  assert.equal(canViewAdoption({ role: "user", is_hod: true, rbac: true, groups: group, permissions: { adoption: view } }), true);
});
test("matriks yang melepas fitur menang atas gate identitas", () => {
  assert.equal(canViewAdoption({ role: "direktur", rbac: true, groups: group, permissions: { adoption: { ...view, view: false } } }), false);
});
