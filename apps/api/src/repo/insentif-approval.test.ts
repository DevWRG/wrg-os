// Tes wewenang rantai persetujuan insentif (F67 §VI, migrasi 183).
//
// Yang diuji di sini SATU fungsi: siapa boleh menandatangani langkah apa. Ia murni
// (tanpa DB) justru supaya bisa diuji — sisanya (urutan status, jejak, siklus) hidup di
// basis data dan diuji lewat jalur integrasi.
//
// Jalankan: pnpm --filter @wrg/api exec node --import tsx --test src/repo/insentif-approval.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import { berwenang, type LangkahApproval } from "./insentif-approval.js";

const pengajuan: LangkahApproval = {
  step: 1, status_dari: "draft", status_ke: "submitted",
  label: "Ajukan", group_key: null, keterangan: null,
};
const reviewHod: LangkahApproval = {
  step: 2, status_dari: "submitted", status_ke: "hod_review",
  label: "Review HOD Sales", group_key: "sales-hod", keterangan: null,
};

const opts = (o: Partial<Parameters<typeof berwenang>[1]>) => ({
  selfAmId: null, amId: "AM01", grup: [] as string[], superuser: false, ...o,
});

test("pengajuan: hanya AM yang bersangkutan", () => {
  assert.equal(berwenang(pengajuan, opts({ selfAmId: "AM01" })).ok, true);
  assert.equal(berwenang(pengajuan, opts({ selfAmId: "AM02" })).ok, false);
  assert.equal(berwenang(pengajuan, opts({ selfAmId: null })).ok, false);
});

test("pengajuan: superuser tetap bisa (anti-lockout saat AM belum punya akun)", () => {
  assert.equal(berwenang(pengajuan, opts({ superuser: true })).ok, true);
});

test("langkah bergrup: anggota grup yang tepat boleh", () => {
  assert.equal(berwenang(reviewHod, opts({ grup: ["sales-hod"] })).ok, true);
});

test("langkah bergrup: grup lain ditolak, dan alasannya menyebut grup yang benar", () => {
  const r = berwenang(reviewHod, opts({ grup: ["finance-hod"] }));
  assert.equal(r.ok, false);
  assert.match(r.alasan ?? "", /sales-hod/);
});

// Inti segregation of duties. Kalau tes ini gagal, seorang AM yang kebetulan juga
// anggota grup HoD bisa menyetujui pembayaran insentifnya sendiri.
test("AM yang bersangkutan TIDAK boleh menyetujui langkah lanjutan walau anggota grupnya", () => {
  const r = berwenang(reviewHod, opts({ selfAmId: "AM01", grup: ["sales-hod"] }));
  assert.equal(r.ok, false);
  assert.match(r.alasan ?? "", /sendiri/i);
});

test("superuser pun tidak boleh menyetujui insentif atas namanya sendiri", () => {
  // Admin yang juga punya am_id: anti-lockout berlaku untuk orang lain, bukan untuk
  // berkasnya sendiri. Urutan cek di berwenang() yang menjamin ini.
  const r = berwenang(reviewHod, opts({ selfAmId: "AM01", superuser: true }));
  assert.equal(r.ok, false);
});

test("superuser boleh menyetujui langkah bergrup milik orang lain", () => {
  assert.equal(berwenang(reviewHod, opts({ selfAmId: "AM02", superuser: true })).ok, true);
});
