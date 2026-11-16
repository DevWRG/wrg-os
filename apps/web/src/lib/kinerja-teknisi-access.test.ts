import assert from "node:assert/strict";
import { test } from "node:test";

import { canViewKinerjaSemua, canViewKinerjaTeknisi } from "./kinerja-teknisi-access";
import type { EffectivePerm } from "./perms";

const izin = (view: boolean): EffectivePerm => ({ active: true, view, create: false, edit: false, delete: false });

test("menu tertutup default; fallback direktur/admin/superuser", () => {
  assert.equal(canViewKinerjaTeknisi(null), false);
  assert.equal(canViewKinerjaTeknisi({ role: "am" }), false);
  assert.equal(canViewKinerjaTeknisi({ role: "direktur" }), true);
  assert.equal(canViewKinerjaTeknisi({ role: "staff", superuser: true }), true);
});

test("matriks menang: teknisi dicentang menu tapi tak 'semua'", () => {
  const tek = { role: "staff", rbac: true, permissions: { "kinerja-teknisi": izin(true) } };
  assert.equal(canViewKinerjaTeknisi(tek), true);
  assert.equal(canViewKinerjaSemua(tek), false);
  const hod = { role: "hod", rbac: true, permissions: { "kinerja-teknisi": izin(true), "kinerja-teknisi-semua": izin(true) } };
  assert.equal(canViewKinerjaSemua(hod), true);
  assert.equal(canViewKinerjaTeknisi({ role: "direktur", rbac: true, permissions: {} }), false);
});
