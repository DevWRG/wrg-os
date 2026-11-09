import assert from "node:assert/strict";
import { test } from "node:test";

import { canViewApThreeWay } from "./ap-three-way-access";
import type { EffectivePerm } from "./perms";

const izin = (view: boolean): EffectivePerm => ({ active: true, view, create: false, edit: false, delete: false });

test("menu tertutup default; terbuka hanya untuk yang dicentang atau admin", () => {
  assert.equal(canViewApThreeWay(null), false);
  assert.equal(canViewApThreeWay({ role: "am" }), false);
  assert.equal(canViewApThreeWay({ role: "admin" }), false); // tanpa data izin: gate lama (false)
  assert.equal(canViewApThreeWay({ role: "am", rbac: true, permissions: { "ap-three-way": izin(true) } }), true);
  assert.equal(canViewApThreeWay({ role: "am", rbac: true, permissions: { "ap-three-way": izin(false) } }), false);
  assert.equal(canViewApThreeWay({ role: "admin", rbac: true, permissions: {} }), true);
});

test("user tanpa grup = tanpa akses walau role direktur (by design canOrLegacy)", () => {
  assert.equal(canViewApThreeWay({ role: "direktur", rbac: true, permissions: {}, groups: [] }), false);
});
