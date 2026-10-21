import assert from "node:assert/strict";
import { test } from "node:test";

import type { EffectivePerm } from "./perms";
import { canViewProfitabilitasArea, profitabilitasAccess } from "./profitabilitas-area-access";

const izin = (p: Partial<EffectivePerm>): EffectivePerm => ({ active: true, view: false, create: false, edit: false, delete: false, ...p });

test("tanpa matriks: Direktur/admin penuh, HoD terbatas, AM & anonim tertutup", () => {
  assert.equal(profitabilitasAccess({ role: "direktur" }), "full");
  assert.equal(profitabilitasAccess({ role: "admin" }), "full");
  assert.equal(profitabilitasAccess({ role: "staff", superuser: true }), "full");
  assert.equal(profitabilitasAccess({ role: "hod", hod_key: "rocky" }), "hod");
  assert.equal(profitabilitasAccess({ role: "am" }), null);
  assert.equal(canViewProfitabilitasArea(null), false);
});

test("matriks menang; izin tanpa identitas → level hod, bukan full", () => {
  const grup = [{ id: 1, key: "g", name: "G" }];
  const dicabut = { role: "direktur", rbac: true, groups: grup, permissions: { "profitabilitas-area": izin({ view: false }) } };
  assert.equal(profitabilitasAccess(dicabut), null);
  const staf = { role: "staff", rbac: true, groups: grup, permissions: { "profitabilitas-area": izin({ view: true }) } };
  assert.equal(profitabilitasAccess(staf), "hod");
});
