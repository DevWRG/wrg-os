import assert from "node:assert/strict";
import { test } from "node:test";

import type { EffectivePerm } from "./perms";
import { canViewTukarFaktur } from "./tukar-faktur-access";

const izin = (view: boolean): EffectivePerm => ({ active: true, view, create: false, edit: false, delete: false });

test("Direktur, admin, dan superuser boleh; AM, HoD, dan anonim tidak (tanpa matriks grup)", () => {
  assert.equal(canViewTukarFaktur({ role: "direktur" }), true);
  assert.equal(canViewTukarFaktur({ role: " Admin " }), true);
  assert.equal(canViewTukarFaktur({ role: "am", superuser: true }), true);
  assert.equal(canViewTukarFaktur({ role: "am" }), false);
  assert.equal(canViewTukarFaktur({ role: "hod", is_hod: true }), false);
  assert.equal(canViewTukarFaktur(null), false);
  assert.equal(canViewTukarFaktur(undefined), false);
});

test("matriks Akses Grup menang atas fallback: Direktur dicabut ditolak, Finance dicentang boleh", () => {
  assert.equal(canViewTukarFaktur({ role: "direktur", rbac: true, permissions: { "tukar-faktur": izin(false) } }), false);
  assert.equal(canViewTukarFaktur({ role: "finance", rbac: true, permissions: { "tukar-faktur": izin(true) } }), true);
});
