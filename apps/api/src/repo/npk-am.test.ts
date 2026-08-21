// Tes aturan ROLE NPK AM (078) — bagian yang paling gampang salah dan paling
// mahal kalau salah: siapa boleh melihat NPK siapa. Murni (tanpa DB), jadi bisa
// jalan di mana saja: `node --test apps/api/dist/repo/npk-am.test.js`.

import test from "node:test";
import assert from "node:assert/strict";

import { visibleAms } from "./npk-am.js";
import { FULL_SCOPE, type DataScope } from "./access-scope.js";

const scope = (p: Partial<DataScope>): DataScope => ({ ...FULL_SCOPE, ...p });

test("admin/superuser → semua AM", () => {
  assert.equal(visibleAms(scope({ userId: "u1", superuser: true })), "all");
});

test("HoD → semua AM (bukan hanya cabang timnya)", () => {
  // Sengaja beda dari scope Visits/AR yang dibatasi hod_territory: keputusan
  // pemilik produk = HoD melihat NPK SELURUH sales. cabangScope diisi pun tak
  // boleh mempersempit.
  assert.equal(visibleAms(scope({ userId: "u2", hodKey: "rocky", cabangScope: ["Surabaya"] })), "all");
  assert.equal(visibleAms(scope({ userId: "u3", hodKey: "yogi" })), "all");
});

test("staff AM → hanya dirinya sendiri", () => {
  assert.deepEqual(visibleAms(scope({ userId: "u4", amOnly: true, amId: "42" })), ["42"]);
});

test("non-AM non-HoD (mis. staf office) → tidak melihat siapa pun", () => {
  // NPK = data HR: default TERTUTUP, bukan fail-open seperti menu analitik.
  assert.deepEqual(visibleAms(scope({ userId: "u5" })), []);
  // am_id ter-set tapi bukan role AM di master_user → resolveScope tidak menyalakan
  // amOnly; jangan sampai lolos jadi "lihat semua".
  assert.deepEqual(visibleAms(scope({ userId: "u6", amId: "99", amOnly: false })), []);
});

test("HoD yang juga punya am_id tetap dapat akses HoD (semua AM)", () => {
  assert.equal(visibleAms(scope({ userId: "u7", hodKey: "rocky", amOnly: true, amId: "7" })), "all");
});
