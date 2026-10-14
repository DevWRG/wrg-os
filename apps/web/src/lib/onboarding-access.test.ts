import { test } from "node:test";
import assert from "node:assert/strict";

import { canManageOnboardingTemplates, canViewOnboarding } from "./onboarding-access";

const grup = { id: 1, key: "g", name: "G" };
const perm = (view: boolean) => ({ active: true, view, create: false, edit: false, delete: false });

test("gate lama: admin/Direktur/superuser/HoD boleh; user biasa tidak", () => {
  assert.equal(canViewOnboarding({ role: "admin" }), true);
  assert.equal(canViewOnboarding({ role: "direktur" }), true);
  assert.equal(canViewOnboarding({ role: "user", superuser: true }), true);
  assert.equal(canViewOnboarding({ role: "user", is_hod: true, rbac: true, groups: [grup], permissions: {} }), true);
  assert.equal(canViewOnboarding({ role: "user", rbac: true, groups: [grup], permissions: {} }), false);
  // user tanpa grup = tanpa akses, walau HoD
  assert.equal(canViewOnboarding({ role: "user", is_hod: true, rbac: true, permissions: {} }), false);
  assert.equal(canViewOnboarding(null), false);
});

test("begitu matriks punya baris 'onboarding', matriks yang menentukan", () => {
  assert.equal(canViewOnboarding({ role: "user", rbac: true, groups: [grup], permissions: { onboarding: perm(true) } }), true);
  assert.equal(canViewOnboarding({ role: "user", is_hod: true, rbac: true, groups: [grup], permissions: { onboarding: perm(false) } }), false);
});

test("template hanya admin/Direktur/superuser — HoD tidak", () => {
  assert.equal(canManageOnboardingTemplates({ role: "user", is_hod: true }), false);
  assert.equal(canManageOnboardingTemplates({ role: "Direktur" }), true);
  assert.equal(canManageOnboardingTemplates(null), false);
});
