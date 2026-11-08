import assert from "node:assert/strict";
import { test } from "node:test";

import { canGeserCn, canKelolaKontrakCn, canViewCn, isFinanceCn, isGaCn, langkahCn, type AccessUser, type PeranCn, type TahapCn } from "./cn-access";
import type { EffectivePerm } from "./perms";

const izin = (view: boolean): EffectivePerm => ({ active: true, view, create: false, edit: false, delete: false });
const sales: AccessUser = { role: "am", name: "Andi" };
const hodS1: AccessUser = { role: "hod", hod_key: "hod-s1" };
const hodS2: AccessUser = { role: "hod", hod_key: "hod-s2" };
const hodB1: AccessUser = { role: "hod", hod_key: "hod-b1" };
const hodB2: AccessUser = { role: "hod", hod_key: "hod-b2" };
// Finance/GA TIDAK dari hod_key di kode: lewat peran master_hod (api /cn/peran) atau grup akses.
const peran: PeranCn = { finance_hod_keys: ["hodfin"], ga_hod_keys: ["hodga"] };
const fin: AccessUser = { role: "hod", hod_key: "hodfin" };
const gaHod: AccessUser = { role: "hod", hod_key: "hodga" };
const grupFinance: AccessUser = { role: "staff", groups: [{ id: 1, key: "finance-hod", name: "Finance HoD" }] };
const grupGa: AccessUser = { role: "staff", groups: [{ id: 2, key: "ga", name: "GA" }] };
const admin: AccessUser = { role: "admin" };

const langsung: TahapCn = { status: "diajukan", hod_sales_key: "hod-s1", hod_business_key: null, requested_by: "Andi" };
const lewatBiz: TahapCn = { ...langsung, hod_business_key: "hod-b1" };

test("menu tertutup default; terbuka hanya untuk yang dicentang atau admin", () => {
  assert.equal(canViewCn({ role: "am" }), false);
  assert.equal(canViewCn({ role: "admin" }), false); // tanpa data izin: pakai gate lama (false)
  assert.equal(canViewCn({ role: "am", rbac: true, permissions: { cn: izin(true) } }), true);
  assert.equal(canViewCn({ role: "admin", rbac: true, permissions: {} }), true);
});

test("diajukan tanpa HoD Business: hanya HoD Sales terpilih yang menyetujui; HoD Sales lain tidak", () => {
  assert.equal(canGeserCn(hodS1, langsung, "disetujui", "x"), true);
  assert.equal(canGeserCn(hodS2, langsung, "disetujui", "x"), false);
  assert.equal(canGeserCn(hodB1, langsung, "disetujui", "x"), false);
  assert.equal(canGeserCn(sales, langsung, "disetujui", "x"), false);
});

test("lewat HoD Business: peninjau hanya yang dipilih; setelah ditinjau HoD Sales yang approve", () => {
  assert.equal(canGeserCn(hodB1, lewatBiz, "ditinjau", "x"), true);
  assert.equal(canGeserCn(hodB2, lewatBiz, "ditinjau", "x"), false);
  assert.equal(canGeserCn(hodS1, lewatBiz, "ditinjau", "x"), false);
  const ditinjau = { ...lewatBiz, status: "ditinjau" as const };
  assert.equal(canGeserCn(hodS1, ditinjau, "disetujui", "x"), true);
  assert.equal(canGeserCn(hodB1, ditinjau, "disetujui", "x"), false); // peninjau bukan approver akhir
});

test("Finance memvalidasi, GA merealisasikan; tidak tertukar", () => {
  assert.equal(canGeserCn(fin, { ...langsung, status: "disetujui" }, "divalidasi", "x", peran), true);
  assert.equal(canGeserCn(gaHod, { ...langsung, status: "disetujui" }, "divalidasi", "x", peran), false);
  assert.equal(canGeserCn(gaHod, { ...langsung, status: "divalidasi" }, "terealisasi", "x", peran), true);
  assert.equal(canGeserCn(fin, { ...langsung, status: "divalidasi" }, "terealisasi", "x", peran), false);
  assert.equal(canGeserCn({ role: "staff", title: "Finance" }, { ...langsung, status: "disetujui" }, "divalidasi", "x"), true);
});

test("Finance/GA lewat grup akses atau peran master_hod; hod_key saja tanpa peran/grup TIDAK berlaku", () => {
  const disetujui = { ...langsung, status: "disetujui" as const };
  const divalidasi = { ...langsung, status: "divalidasi" as const };
  assert.equal(canGeserCn(grupFinance, disetujui, "divalidasi", "x"), true);
  assert.equal(canGeserCn(grupGa, divalidasi, "terealisasi", "x"), true);
  assert.equal(canGeserCn(grupGa, disetujui, "divalidasi", "x"), false);
  assert.equal(canGeserCn(fin, disetujui, "divalidasi", "x"), false); // tanpa peran
  assert.equal(canGeserCn(gaHod, divalidasi, "terealisasi", "x"), false);
  const hodLain1: AccessUser = { role: "hod", hod_key: "hod-x1" };
  const hodLain2: AccessUser = { role: "hod", hod_key: "hod-x2" };
  assert.equal(isFinanceCn(hodLain1), false);
  assert.equal(isFinanceCn(hodLain1, peran), false);
  assert.equal(isGaCn(hodLain2), false);
  assert.equal(canGeserCn(hodLain1, disetujui, "divalidasi", "x", peran), false);
  assert.equal(isFinanceCn(fin, peran), true);
  assert.equal(isGaCn(gaHod, peran), true);
  assert.equal(isGaCn(fin, peran), false);
});

test("tolak mengikuti pemegang tahap berjalan", () => {
  assert.equal(canGeserCn(hodS1, langsung, "ditolak", "x"), true);
  assert.equal(canGeserCn(hodB1, lewatBiz, "ditolak", "x"), true);
  assert.equal(canGeserCn(hodS1, lewatBiz, "ditolak", "x"), false); // belum gilirannya
  assert.equal(canGeserCn(fin, { ...langsung, status: "disetujui" }, "ditolak", "x", peran), true);
  assert.equal(canGeserCn(hodS1, { ...langsung, status: "disetujui" }, "ditolak", "x"), false);
  assert.equal(canGeserCn(gaHod, { ...langsung, status: "divalidasi" }, "ditolak", "x", peran), true);
  assert.equal(canGeserCn(admin, { ...langsung, status: "terealisasi" }, "ditolak", "x"), true); // admin lolos; api yang menolak status final
});

test("batal hanya oleh pengaju sendiri (atau admin)", () => {
  assert.equal(canGeserCn(sales, langsung, "dibatalkan", "Andi"), true);
  assert.equal(canGeserCn(sales, langsung, "dibatalkan", "Budi"), false);
  assert.equal(canGeserCn(hodS1, langsung, "dibatalkan", "HOD-S1"), false);
  assert.equal(canGeserCn(admin, langsung, "dibatalkan", "siapa"), true);
});

test("langkahCn: tombol yang tampil sesuai peran dan status", () => {
  assert.deepEqual(langkahCn(hodS1, langsung, "HOD-S1"), ["disetujui", "ditolak"]);
  assert.deepEqual(langkahCn(sales, langsung, "Andi"), ["dibatalkan"]);
  assert.deepEqual(langkahCn(hodB1, lewatBiz, "HOD-B1"), ["ditinjau", "ditolak"]);
  assert.deepEqual(langkahCn(gaHod, { ...langsung, status: "divalidasi" }, "H", peran), ["terealisasi", "ditolak"]);
  assert.deepEqual(langkahCn(admin, { ...langsung, status: "terealisasi" }, "A"), []);
  assert.deepEqual(langkahCn(null, langsung, "x"), []);
});

test("kontrak: hanya Direktur/admin/superuser", () => {
  assert.equal(canKelolaKontrakCn({ role: "direktur" }), true);
  assert.equal(canKelolaKontrakCn({ role: " Direktur " }), true);
  assert.equal(canKelolaKontrakCn({ role: "am", superuser: true }), true);
  assert.equal(canKelolaKontrakCn(hodS1), false);
  assert.equal(canKelolaKontrakCn(null), false);
});
