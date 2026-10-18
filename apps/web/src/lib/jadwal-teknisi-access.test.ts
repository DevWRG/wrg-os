import { test } from "node:test";
import assert from "node:assert/strict";

import { canEditJadwalTeknisi, canViewJadwalTeknisi } from "./jadwal-teknisi-access";

const izin = (view: boolean, edit: boolean) => ({ "jadwal-teknisi": { active: true, view, create: false, edit, delete: false } });

test("lihat/ubah: admin, direktur, HoD Aftersales default; lainnya tidak; matriks menang", () => {
  assert.equal(canViewJadwalTeknisi({ role: "admin" }), true);
  assert.equal(canViewJadwalTeknisi({ role: "direktur" }), true);
  assert.equal(canViewJadwalTeknisi({ role: "user", hod_key: "muhid" }), true);
  assert.equal(canViewJadwalTeknisi({ role: "user", title: "HoD Aftersales" }), true);
  assert.equal(canViewJadwalTeknisi({ role: "user", hod_key: "rocky", is_hod: true }), false);
  assert.equal(canViewJadwalTeknisi({ role: "user", permissions: izin(true, false) }), true);
  assert.equal(canEditJadwalTeknisi({ role: "user", permissions: izin(true, false) }), false);
  assert.equal(canEditJadwalTeknisi({ role: "user", permissions: izin(true, true) }), true);
  assert.equal(canViewJadwalTeknisi(null), false);
});
