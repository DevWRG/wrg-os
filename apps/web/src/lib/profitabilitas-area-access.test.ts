import assert from "node:assert/strict";
import { test } from "node:test";

import type { EffectivePerm } from "./perms";
import { canViewProfitabilitasArea, profitabilitasAccess } from "./profitabilitas-area-access";

const izin = (p: Partial<EffectivePerm>): EffectivePerm => ({ active: true, view: false, create: false, edit: false, delete: false, ...p });

test("tanpa matriks: hanya Direktur/admin/superuser (penuh); HoD, AM & anonim tertutup", () => {
  assert.equal(profitabilitasAccess({ role: "direktur" }), "full");
  assert.equal(profitabilitasAccess({ role: "admin" }), "full");
  assert.equal(profitabilitasAccess({ role: "staff", superuser: true }), "full");
  assert.equal(profitabilitasAccess({ role: "hod", hod_key: "rocky" }), null);
  assert.equal(canViewProfitabilitasArea({ role: "hod", hod_key: "rocky" }), false);
  assert.equal(profitabilitasAccess({ role: "am" }), null);
  assert.equal(canViewProfitabilitasArea(null), false);
});

test("fitur belum diatur di matriks: HoD bergrup tetap tertutup, Direktur bergrup terbuka", () => {
  const grup = [{ id: 1, key: "g", name: "G" }];
  const hod = { role: "hod", hod_key: "rocky", rbac: true, groups: grup, permissions: {} };
  assert.equal(profitabilitasAccess(hod), null);
  const dir = { role: "direktur", rbac: true, groups: grup, permissions: {} };
  assert.equal(profitabilitasAccess(dir), "full");
});

test("matriks menang; izin tanpa identitas Direktur/admin → level hod, bukan full", () => {
  const grup = [{ id: 1, key: "g", name: "G" }];
  const dicabut = { role: "direktur", rbac: true, groups: grup, permissions: { "profitabilitas-area": izin({ view: false }) } };
  assert.equal(profitabilitasAccess(dicabut), null);
  const staf = { role: "staff", rbac: true, groups: grup, permissions: { "profitabilitas-area": izin({ view: true }) } };
  assert.equal(profitabilitasAccess(staf), "hod");
  // HoD yang dicentang lewat matriks → tetap dibatasi ke cabangnya sendiri.
  const hod = { role: "hod", hod_key: "rocky", rbac: true, groups: grup, permissions: { "profitabilitas-area": izin({ view: true }) } };
  assert.equal(profitabilitasAccess(hod), "hod");
});
