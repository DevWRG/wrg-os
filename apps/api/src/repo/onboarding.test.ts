import { test } from "node:test";
import assert from "node:assert/strict";

import { FULL_SCOPE, type DataScope } from "./access-scope.js";
import { OnboardingError, audienceOf, dueDate, parseTemplate, progress, templateMatches } from "./onboarding.js";

// F56 — logika murni onboarding checklist.
const scope = (o: Partial<DataScope>): DataScope => ({ ...FULL_SCOPE, userId: "u1", ...o });

test("audiens: admin/superuser/Direktur = all; HoD ber-cabang = team; lainnya ditolak", () => {
  assert.equal(audienceOf(scope({ role: "admin" })), "all");
  assert.equal(audienceOf(scope({ role: "Direktur" })), "all");
  assert.equal(audienceOf(scope({ superuser: true })), "all");
  assert.equal(audienceOf(scope({ cabangScope: ["MALANG"] })), "team");
  assert.equal(audienceOf(scope({ role: "user" })), null);
  assert.equal(audienceOf(scope({ amOnly: true, amId: "5" })), null);
});

test("HoD tanpa territory (cabangScope kosong) ditolak, bukan lihat semua", () => {
  assert.equal(audienceOf(scope({ cabangScope: [] })), null);
  assert.equal(audienceOf(scope({ cabangScope: null })), null);
});

test("tanpa userId ditolak", () => {
  assert.equal(audienceOf({ ...FULL_SCOPE, role: "admin" }), null);
});

test("template cocok: tanpa batas = semua; dept & pola jabatan saling membatasi", () => {
  const e = { dept: "sales", role: "Account Manager (Marketing) — Area Madura" };
  assert.equal(templateMatches({ dept: null, role_pattern: null }, e), true);
  assert.equal(templateMatches({ dept: "sales", role_pattern: null }, e), true);
  assert.equal(templateMatches({ dept: "gudang", role_pattern: null }, e), false);
  assert.equal(templateMatches({ dept: null, role_pattern: "account manager" }, e), true);
  assert.equal(templateMatches({ dept: "sales", role_pattern: "teknisi" }, e), false);
});

test("template ber-pola tidak cocok untuk karyawan tanpa role/dept", () => {
  assert.equal(templateMatches({ dept: null, role_pattern: "admin" }, { dept: null, role: null }), false);
  assert.equal(templateMatches({ dept: "sales", role_pattern: null }, { dept: null, role: null }), false);
  assert.equal(templateMatches({ dept: null, role_pattern: "  " }, { dept: null, role: null }), true);
});

test("dueDate: lintas bulan, tahun kabisat, 0 hari", () => {
  assert.equal(dueDate("2026-10-30", 3), "2026-11-02");
  assert.equal(dueDate("2028-02-27", 2), "2028-02-29");
  assert.equal(dueDate("2026-12-31", 1), "2027-01-01");
  assert.equal(dueDate("2026-10-13", 0), "2026-10-13");
});

test("progress: dilewati ikut dihitung diputus; terlambat hanya butir 'belum' lewat tenggat", () => {
  const p = progress(
    [
      { status: "selesai", due_date: "2026-10-01" },
      { status: "dilewati", due_date: "2026-10-01" },
      { status: "belum", due_date: "2026-10-12" },
      { status: "belum", due_date: "2026-10-13" },
    ],
    "2026-10-13",
  );
  assert.deepEqual(p, { total: 4, selesai: 1, dilewati: 1, belum: 2, terlambat: 1, persen: 50 });
});

test("progress: kosong = 0%, tanpa pembagian nol", () => {
  assert.equal(progress([], "2026-10-13").persen, 0);
});

test("parseTemplate (create): kategori & judul wajib", () => {
  assert.throws(() => parseTemplate({ judul: "x" }, false), (e) => e instanceof OnboardingError && e.field === "kategori");
  assert.throws(() => parseTemplate({ kategori: "nda", judul: "  " }, false), (e) => e instanceof OnboardingError && e.field === "judul");
  assert.equal(parseTemplate({ kategori: "nda", judul: " NDA " }, false).judul, "NDA");
});

test("parseTemplate: kategori tak dikenal, due_days di luar batas, aktif bukan boolean ditolak", () => {
  assert.throws(() => parseTemplate({ kategori: "lain", judul: "x" }, false), OnboardingError);
  assert.throws(() => parseTemplate({ kategori: "nda", judul: "x", due_days: -1 }, false), (e) => e instanceof OnboardingError && e.field === "due_days");
  assert.throws(() => parseTemplate({ kategori: "nda", judul: "x", due_days: 1.5 }, false), OnboardingError);
  assert.throws(() => parseTemplate({ aktif: "ya" }, true), (e) => e instanceof OnboardingError && e.field === "aktif");
});

test("parseTemplate (patch): hanya field yang dikirim; string kosong → null", () => {
  assert.deepEqual(parseTemplate({ aktif: false }, true), { aktif: false });
  assert.deepEqual(parseTemplate({ dept: "", role_pattern: "  " }, true), { dept: null, role_pattern: null });
});
