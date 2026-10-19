import { test } from "node:test";
import assert from "node:assert/strict";

import { canEditOrderWa, canViewOrderWa } from "./order-wa-access";

const izin = (view: boolean, edit: boolean) => ({ "order-wa": { active: true, view, create: false, edit, delete: false } });

test("lihat: AM/HoD/direktur/admin default; ubah: admin default; matriks menang", () => {
  assert.equal(canViewOrderWa({ role: "user", am_id: "11" }), true);
  assert.equal(canViewOrderWa({ role: "user", is_hod: true }), true);
  assert.equal(canViewOrderWa({ role: "user" }), false);
  assert.equal(canEditOrderWa({ role: "user", am_id: "11" }), false);
  assert.equal(canEditOrderWa({ role: "admin" }), true);
  assert.equal(canViewOrderWa({ role: "user", permissions: izin(true, true) }), true);
  assert.equal(canEditOrderWa({ role: "user", permissions: izin(true, true) }), true);
  assert.equal(canEditOrderWa({ role: "user", am_id: "11", permissions: izin(true, false) }), false);
});
