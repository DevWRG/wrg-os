import assert from "node:assert/strict";
import { test } from "node:test";

import { canViewRiwayatAlat } from "./riwayat-alat-access";
import type { EffectivePerm } from "./perms";

const izin = (view: boolean): EffectivePerm => ({ active: true, view, create: false, edit: false, delete: false });

test("menu tertutup default; fallback direktur/admin/superuser", () => {
  assert.equal(canViewRiwayatAlat(null), false);
  assert.equal(canViewRiwayatAlat({ role: "am" }), false);
  assert.equal(canViewRiwayatAlat({ role: "Direktur" }), true);
  assert.equal(canViewRiwayatAlat({ role: "admin" }), true);
  assert.equal(canViewRiwayatAlat({ role: "staff", superuser: true }), true);
});

test("matriks menang: teknisi dicentang → buka; direktur tanpa centang di matriks → tertutup", () => {
  assert.equal(canViewRiwayatAlat({ role: "staff", rbac: true, permissions: { "riwayat-alat": izin(true) } }), true);
  assert.equal(canViewRiwayatAlat({ role: "staff", rbac: true, permissions: { "riwayat-alat": izin(false) } }), false);
  assert.equal(canViewRiwayatAlat({ role: "direktur", rbac: true, permissions: {} }), false);
});
