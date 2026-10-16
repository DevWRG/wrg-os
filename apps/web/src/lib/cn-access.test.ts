import assert from "node:assert/strict";
import { test } from "node:test";

import { canGeserCn, canKelolaKontrakCn, canViewCn, langkahCn, type AccessUser, type TahapCn } from "./cn-access";
import type { EffectivePerm } from "./perms";

const izin = (view: boolean): EffectivePerm => ({ active: true, view, create: false, edit: false, delete: false });
const sales: AccessUser = { role: "am", name: "Andi" };
const rocky: AccessUser = { role: "hod", hod_key: "rocky" };
const yogi: AccessUser = { role: "hod", hod_key: "yogi" };
const mufid: AccessUser = { role: "hod", hod_key: "mufid" };
const arman: AccessUser = { role: "hod", hod_key: "arman" };
const ika: AccessUser = { role: "hod", hod_key: "ika" };
const husni: AccessUser = { role: "hod", hod_key: "husni" };
const admin: AccessUser = { role: "admin" };

const langsung: TahapCn = { status: "diajukan", hod_sales_key: "rocky", hod_business_key: null, requested_by: "Andi" };
const lewatBiz: TahapCn = { ...langsung, hod_business_key: "mufid" };

test("menu tertutup default; terbuka hanya untuk yang dicentang atau admin", () => {
  assert.equal(canViewCn({ role: "am" }), false);
  assert.equal(canViewCn({ role: "admin" }), false); // tanpa data izin: pakai gate lama (false)
  assert.equal(canViewCn({ role: "am", rbac: true, permissions: { cn: izin(true) } }), true);
  assert.equal(canViewCn({ role: "admin", rbac: true, permissions: {} }), true);
});

test("diajukan tanpa HoD Business: hanya HoD Sales terpilih yang menyetujui; HoD Sales lain tidak", () => {
  assert.equal(canGeserCn(rocky, langsung, "disetujui", "x"), true);
  assert.equal(canGeserCn(yogi, langsung, "disetujui", "x"), false);
  assert.equal(canGeserCn(mufid, langsung, "disetujui", "x"), false);
  assert.equal(canGeserCn(sales, langsung, "disetujui", "x"), false);
});

test("lewat HoD Business: peninjau hanya yang dipilih; setelah ditinjau HoD Sales yang approve", () => {
  assert.equal(canGeserCn(mufid, lewatBiz, "ditinjau", "x"), true);
  assert.equal(canGeserCn(arman, lewatBiz, "ditinjau", "x"), false);
  assert.equal(canGeserCn(rocky, lewatBiz, "ditinjau", "x"), false);
  const ditinjau = { ...lewatBiz, status: "ditinjau" as const };
  assert.equal(canGeserCn(rocky, ditinjau, "disetujui", "x"), true);
  assert.equal(canGeserCn(mufid, ditinjau, "disetujui", "x"), false); // peninjau bukan approver akhir
});

test("Finance memvalidasi, GA merealisasikan; tidak tertukar", () => {
  assert.equal(canGeserCn(ika, { ...langsung, status: "disetujui" }, "divalidasi", "x"), true);
  assert.equal(canGeserCn(husni, { ...langsung, status: "disetujui" }, "divalidasi", "x"), false);
  assert.equal(canGeserCn(husni, { ...langsung, status: "divalidasi" }, "terealisasi", "x"), true);
  assert.equal(canGeserCn(ika, { ...langsung, status: "divalidasi" }, "terealisasi", "x"), false);
  assert.equal(canGeserCn({ role: "staff", title: "Finance" }, { ...langsung, status: "disetujui" }, "divalidasi", "x"), true);
});

test("tolak mengikuti pemegang tahap berjalan", () => {
  assert.equal(canGeserCn(rocky, langsung, "ditolak", "x"), true);
  assert.equal(canGeserCn(mufid, lewatBiz, "ditolak", "x"), true);
  assert.equal(canGeserCn(rocky, lewatBiz, "ditolak", "x"), false); // belum gilirannya
  assert.equal(canGeserCn(ika, { ...langsung, status: "disetujui" }, "ditolak", "x"), true);
  assert.equal(canGeserCn(rocky, { ...langsung, status: "disetujui" }, "ditolak", "x"), false);
  assert.equal(canGeserCn(husni, { ...langsung, status: "divalidasi" }, "ditolak", "x"), true);
  assert.equal(canGeserCn(admin, { ...langsung, status: "terealisasi" }, "ditolak", "x"), true); // admin lolos; api yang menolak status final
});

test("batal hanya oleh pengaju sendiri (atau admin)", () => {
  assert.equal(canGeserCn(sales, langsung, "dibatalkan", "Andi"), true);
  assert.equal(canGeserCn(sales, langsung, "dibatalkan", "Budi"), false);
  assert.equal(canGeserCn(rocky, langsung, "dibatalkan", "Rocky"), false);
  assert.equal(canGeserCn(admin, langsung, "dibatalkan", "siapa"), true);
});

test("langkahCn: tombol yang tampil sesuai peran dan status", () => {
  assert.deepEqual(langkahCn(rocky, langsung, "Rocky"), ["disetujui", "ditolak"]);
  assert.deepEqual(langkahCn(sales, langsung, "Andi"), ["dibatalkan"]);
  assert.deepEqual(langkahCn(mufid, lewatBiz, "Mufid"), ["ditinjau", "ditolak"]);
  assert.deepEqual(langkahCn(husni, { ...langsung, status: "divalidasi" }, "H"), ["terealisasi", "ditolak"]);
  assert.deepEqual(langkahCn(admin, { ...langsung, status: "terealisasi" }, "A"), []);
  assert.deepEqual(langkahCn(null, langsung, "x"), []);
});

test("kontrak: hanya Direktur/admin/superuser", () => {
  assert.equal(canKelolaKontrakCn({ role: "direktur" }), true);
  assert.equal(canKelolaKontrakCn({ role: " Direktur " }), true);
  assert.equal(canKelolaKontrakCn({ role: "am", superuser: true }), true);
  assert.equal(canKelolaKontrakCn(rocky), false);
  assert.equal(canKelolaKontrakCn(null), false);
});
