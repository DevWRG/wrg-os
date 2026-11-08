import assert from "node:assert/strict";
import { test } from "node:test";

import type { EffectivePerm } from "./perms";
import { canEditDocTracker, canViewDocTracker } from "./doc-tracker-access";

const izin = (view: boolean): EffectivePerm => ({ active: true, view, create: false, edit: false, delete: false });

test("Direktur, admin, dan superuser boleh; AM, HoD, dan anonim tidak (tanpa matriks grup)", () => {
  assert.equal(canViewDocTracker({ role: "direktur" }), true);
  assert.equal(canViewDocTracker({ role: " Admin " }), true);
  assert.equal(canViewDocTracker({ role: "am", superuser: true }), true);
  assert.equal(canViewDocTracker({ role: "am" }), false);
  assert.equal(canViewDocTracker({ role: "hod", is_hod: true }), false);
  assert.equal(canViewDocTracker(null), false);
});

test("matriks Akses Grup menang atas fallback: Direktur dicabut ditolak, Shipping dicentang boleh", () => {
  assert.equal(canViewDocTracker({ role: "direktur", rbac: true, permissions: { "doc-tracker": izin(false) } }), false);
  assert.equal(canViewDocTracker({ role: "shipping", rbac: true, permissions: { "doc-tracker": izin(true) } }), true);
});

test("edit: ikut izin lihat bila matriks belum mengatur; bila diatur, wajib centang edit", () => {
  assert.equal(canEditDocTracker({ role: "admin" }), true);
  assert.equal(canEditDocTracker({ role: "am" }), false);
  assert.equal(canEditDocTracker({ role: "shipping", rbac: true, permissions: { "doc-tracker": izin(true) } }), false); // lihat saja
  assert.equal(
    canEditDocTracker({ role: "shipping", rbac: true, permissions: { "doc-tracker": { active: true, view: true, create: false, edit: true, delete: false } } }),
    true,
  );
});
