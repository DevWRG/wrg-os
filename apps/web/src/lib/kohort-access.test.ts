import assert from "node:assert/strict";
import { test } from "node:test";

import type { EffectivePerm } from "./perms";
import { canViewKohort } from "./kohort-access";

const izin = (p: Partial<EffectivePerm>): EffectivePerm => ({ active: true, view: false, create: false, edit: false, delete: false, ...p });

test("tanpa matriks: Direktur/admin/superuser/HoD boleh; AM & anonim tidak", () => {
  assert.equal(canViewKohort({ role: "direktur" }), true);
  assert.equal(canViewKohort({ role: "admin" }), true);
  assert.equal(canViewKohort({ role: "staff", superuser: true }), true);
  assert.equal(canViewKohort({ role: "hod", hod_key: "rocky" }), true);
  assert.equal(canViewKohort({ role: "am" }), false);
  assert.equal(canViewKohort(null), false);
});

test("matriks Akses Grup menang atas fallback", () => {
  const grup = [{ id: 1, key: "g", name: "G" }];
  assert.equal(canViewKohort({ role: "direktur", rbac: true, groups: grup, permissions: { kohort: izin({ view: false }) } }), false);
  assert.equal(canViewKohort({ role: "staff", rbac: true, groups: grup, permissions: { kohort: izin({ view: true }) } }), true);
});
