import { test } from "node:test";
import assert from "node:assert/strict";

import { canEditBonSparepart, canViewBonSparepart } from "./bon-sparepart-access";

const izin = (view: boolean, edit: boolean) => ({ "bon-sparepart": { active: true, view, create: false, edit, delete: false } });

test("default: admin/direktur/Aftersales/Gudang boleh; AM biasa tidak; matriks menang", () => {
  assert.equal(canViewBonSparepart({ role: "admin" }), true);
  assert.equal(canViewBonSparepart({ role: "direktur" }), true);
  assert.equal(canViewBonSparepart({ role: "user", title: "Admin Gudang / PJ Barang" }), true);
  assert.equal(canViewBonSparepart({ role: "user", title: "HoD Aftersales" }), true);
  assert.equal(canViewBonSparepart({ role: "user", am_id: "11" }), false);
  assert.equal(canViewBonSparepart(null), false);
  assert.equal(canEditBonSparepart({ role: "user", title: "Admin Gudang" }), true);
  assert.equal(canViewBonSparepart({ role: "user", am_id: "11", permissions: izin(true, false) }), true);
  assert.equal(canEditBonSparepart({ role: "user", am_id: "11", permissions: izin(true, false) }), false);
});
