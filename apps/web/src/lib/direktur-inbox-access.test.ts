import assert from "node:assert/strict";
import { test } from "node:test";

import { canViewDirekturInbox } from "./direktur-inbox-access";
import type { EffectivePerm } from "./perms";

const izin = (view: boolean): EffectivePerm => ({ active: true, view, create: false, edit: false, delete: false });

test("Direktur, admin, dan superuser boleh; HoD, AM, dan anonim tidak (tanpa matriks grup)", () => {
  assert.equal(canViewDirekturInbox({ role: "direktur" }), true);
  assert.equal(canViewDirekturInbox({ role: " Direktur " }), true);
  assert.equal(canViewDirekturInbox({ role: "admin" }), true);
  assert.equal(canViewDirekturInbox({ role: "am", superuser: true }), true);
  assert.equal(canViewDirekturInbox({ role: "hod", is_hod: true, title: "HoD Sales" }), false);
  assert.equal(canViewDirekturInbox({ role: "am" }), false);
  assert.equal(canViewDirekturInbox(null), false);
  assert.equal(canViewDirekturInbox(undefined), false);
});

test("matriks Akses Grup menang atas fallback: Direktur yang dicabut ditolak, user yang dicentang boleh", () => {
  assert.equal(canViewDirekturInbox({ role: "direktur", rbac: true, permissions: { "direktur-inbox": izin(false) } }), false);
  assert.equal(canViewDirekturInbox({ role: "am", rbac: true, permissions: { "direktur-inbox": izin(true) } }), true);
});
