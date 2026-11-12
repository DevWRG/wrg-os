import assert from "node:assert/strict";
import { test } from "node:test";

import type { EffectivePerm } from "./perms";
import { canEditHppKonversi, canViewHppKonversi } from "./hpp-konversi-access";

const izin = (p: Partial<EffectivePerm>): EffectivePerm => ({ active: true, view: false, create: false, edit: false, delete: false, ...p });
const grupFinance = [{ id: 1, key: "finance-hod", name: "Finance HoD" }];

test("tanpa matriks: Setup Harga (HoD Business/Purchasing/admin) + Finance boleh; AM & anonim tidak", () => {
  assert.equal(canEditHppKonversi({ role: "staff", title: "HoD Business" }), true);
  assert.equal(canEditHppKonversi({ role: "staff", title: "Purchasing" }), true);
  assert.equal(canEditHppKonversi({ role: "admin" }), true);
  assert.equal(canEditHppKonversi({ role: "hod", groups: grupFinance }), true);
  assert.equal(canEditHppKonversi({ role: "staff", title: "Finance" }), true);
  assert.equal(canViewHppKonversi({ role: "staff", title: "AM" }), false);
  assert.equal(canViewHppKonversi(null), false);
});

test("matriks diatur → matriks menang (view tanpa edit = baca saja)", () => {
  const u = { role: "hod", rbac: true, groups: grupFinance, permissions: { "hpp-konversi-satuan": izin({ view: true }) } };
  assert.equal(canViewHppKonversi(u), true);
  assert.equal(canEditHppKonversi(u), false);
  const dicabut = { ...u, permissions: { "hpp-konversi-satuan": izin({ active: false }) } };
  assert.equal(canViewHppKonversi(dicabut), false);
});

test("user ber-grup tanpa baris izin & bukan Finance/Setup Harga → tertutup", () => {
  const u = { role: "staff", title: "AM", rbac: true, groups: [{ id: 2, key: "am", name: "AM" }], permissions: {} };
  assert.equal(canViewHppKonversi(u), false);
});
