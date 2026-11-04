import { test } from "node:test";
import assert from "node:assert/strict";

import { canViewSalesCommand, salesCommandAccess } from "./sales-command-access";

const izin = (view: boolean) => ({ "sales-command": { active: true, view, create: false, edit: false, delete: false } });

test("Direktur/admin/superuser = full; HoD = hod; AM & user biasa tertutup", () => {
  assert.equal(salesCommandAccess({ role: "direktur" }), "full");
  assert.equal(salesCommandAccess({ role: "admin" }), "full");
  assert.equal(salesCommandAccess({ role: "user", superuser: true }), "full");
  assert.equal(salesCommandAccess({ role: "user", hod_key: "hodx" }), "hod");
  assert.equal(canViewSalesCommand({ role: "user", am_id: "11" }), false);
  assert.equal(canViewSalesCommand({ role: "user" }), false);
});

test("matriks Akses Grup menang; izin dari matriks tanpa identitas = hod (subset teraman)", () => {
  assert.equal(canViewSalesCommand({ role: "user", hod_key: "hodx", permissions: izin(false) }), false);
  assert.equal(salesCommandAccess({ role: "user", permissions: izin(true) }), "hod");
});
