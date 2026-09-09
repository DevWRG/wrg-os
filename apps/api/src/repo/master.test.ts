import assert from "node:assert/strict";
import { test } from "node:test";

import { bolehLewat, normalizeWa } from "./master.js";

// `resolveAmByWa` sejak dulu berkomentar "Hanya user aktif", tapi tak satu pun
// dari empat tier resolusi (wa / pushname / body-name / alias) menyaringnya.
// Karyawan yang sudah dinonaktifkan tetap bisa memerintah bot — dan yang keluar
// bukan data sepele: #CEK mengembalikan nomor SO/SJ berikut nilainya, #STOK
// posisi stok, #PRICING price book.

function tangkapWarn(fn: () => boolean): { hasil: boolean; pesan: string[] } {
  const asli = console.warn;
  const pesan: string[] = [];
  console.warn = (...a: unknown[]) => { pesan.push(a.join(" ")); };
  try {
    return { hasil: fn(), pesan };
  } finally {
    console.warn = asli;
  }
}

const AKTIF = { am_id: "AM-01", nama: "Dewi", aktif: true };
const NONAKTIF = { am_id: "AM-99", nama: "Mantan Karyawan", aktif: false };

test("orang aktif lewat, dan TIDAK mengotori log", () => {
  const { hasil, pesan } = tangkapWarn(() => bolehLewat(AKTIF, "phone"));
  assert.equal(hasil, true);
  assert.deepEqual(pesan, []);
});

test("orang non-aktif ditolak", () => {
  const { hasil } = tangkapWarn(() => bolehLewat(NONAKTIF, "phone"));
  assert.equal(hasil, false);
});

test("penolakan MENINGGALKAN JEJAK — ini inti perbaikannya", () => {
  // Kalau `aktif` disaring di dalam query, hasilnya `null` dan tak bisa
  // dibedakan dari "nomor tak dikenal" — padahal dua keadaan itu butuh
  // tindakan berbeda: daftarkan orangnya vs aktifkan kembali.
  const { pesan } = tangkapWarn(() => bolehLewat(NONAKTIF, "phone"));
  assert.equal(pesan.length, 1);
  assert.match(pesan[0], /AM-99/);
  assert.match(pesan[0], /Mantan Karyawan/);
  assert.match(pesan[0], /non-aktif/i);
});

test("jejak menyebut TIER-nya, supaya jalur masuknya bisa ditelusuri", () => {
  for (const via of ["phone", "pushname", "body-name", "alias", "body-fuzzy"]) {
    const { pesan } = tangkapWarn(() => bolehLewat(NONAKTIF, via));
    assert.match(pesan[0], new RegExp(via.replace("-", "\\-")), `tier "${via}" tak disebut: ${pesan[0]}`);
  }
});

test("jejak menyebut cara membalikkannya kalau penolakannya keliru", () => {
  const { pesan } = tangkapWarn(() => bolehLewat(NONAKTIF, "phone"));
  assert.match(pesan[0], /aktif = true/);
});

// normalizeWa ikut diuji di sini karena ia yang menentukan apakah nomor yang
// didaftarkan dengan format bebas (+62 821-4372-6401) benar-benar cocok.
test("normalizeWa: format bebas menuju bentuk yang sama", () => {
  const harap = "6282143726401";
  for (const v of ["+62 821-4372-6401", "6282143726401", "082143726401", "+6282143726401", "0821 4372 6401"]) {
    assert.equal(normalizeWa(v), harap, `gagal untuk ${v}`);
  }
});

test("normalizeWa: awalan 620 dirapikan jadi 62", () => {
  assert.equal(normalizeWa("6208214372640"), "628214372640");
});
