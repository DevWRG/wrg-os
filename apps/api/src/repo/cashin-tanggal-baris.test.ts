// pisahTanggalBaris — penjaga "satu statement = SATU tanggal".
//
// Dua kegagalan yang WAJIB dibedakan, karena jawabannya berlawanan:
//
//   ekspor rentang  → selisih HARI   → kesalahan pengirim → TAHAN statement
//   galat parser    → selisih ABAD   → cacat kode         → jangan tahan
//
// 15 Okt 2026 keduanya disamakan: satu baris MDR 038 terbaca bertahun 8000,
// penjaga membacanya sebagai "2 tanggal berbeda", Rp 90.484.117 uang masuk
// yang checksum-nya cocok tertahan, dan renika disuruh "ekspor ulang" — saran
// yang tak mungkin berhasil. Dia mengirim ulang dua kali, hasilnya sama.
//
//   pnpm --filter @wrg/api test

import test from "node:test";
import assert from "node:assert/strict";

import { AMBANG_HARI_MASUK_AKAL, pisahTanggalBaris } from "./cashin.js";

test("satu tanggal, sama dengan statement → tak ada temuan", () => {
  const r = pisahTanggalBaris("2026-10-15", ["2026-10-15 09:00:00", "2026-10-15 16:00:07"]);
  assert.deepEqual(r.masukAkal, ["2026-10-15"]);
  assert.deepEqual(r.mustahil, []);
});

test("ekspor rentang (9 & 10 Okt) tetap terdeteksi — ini alasan penjaga dibuat", () => {
  const r = pisahTanggalBaris("2026-10-09", ["2026-10-09 08:00:00", "2026-10-10 11:15:48"]);
  assert.deepEqual(r.masukAkal, ["2026-10-09", "2026-10-10"]);
  assert.deepEqual(r.mustahil, []);
});

test("tahun sampah dari nomor referensi TIDAK dihitung sebagai tanggal kedua", () => {
  // Kasus nyata MDR 038 15 Okt: referensi berakhiran "8000" bersebelahan jam.
  const r = pisahTanggalBaris("2026-10-15", ["2026-10-15 02:15:05", "8000-10-15 16:00:07"]);
  assert.deepEqual(r.masukAkal, ["2026-10-15"], "statement tidak boleh tertahan");
  assert.deepEqual(r.mustahil, ["8000-10-15"], "tapi cacatnya tetap dilaporkan");
});

test("tahun sampah lain yang sempat lolos diam-diam (8521, 5369)", () => {
  for (const [stmt, sampah] of [["2026-10-02", "8521-10-02"], ["2026-10-08", "5369-10-08"]]) {
    const r = pisahTanggalBaris(stmt, [`${stmt} 10:00:00`, `${sampah} 13:35:37`]);
    assert.deepEqual(r.masukAkal, [stmt]);
    assert.deepEqual(r.mustahil, [sampah]);
  }
});

test("rentang sungguhan DAN sampah bisa muncul bersamaan — keduanya dilaporkan apa adanya", () => {
  // MDR 038 2 Okt: tahun 8521 pada satu baris MENUTUPI dua baris 3 Okt yang asli.
  const r = pisahTanggalBaris("2026-10-02", [
    "2026-10-02 09:00:00",
    "8521-10-02 20:09:38",
    "2026-10-03 11:07:33",
  ]);
  assert.deepEqual(r.masukAkal, ["2026-10-02", "2026-10-03"], "rentang tetap menahan");
  assert.deepEqual(r.mustahil, ["8521-10-02"]);
});

test("baris tanpa tanggal diabaikan, bukan dianggap salah (HANA/INDEX)", () => {
  const r = pisahTanggalBaris("2026-10-15", [null, null, "2026-10-15 09:00:00", null]);
  assert.deepEqual(r.masukAkal, ["2026-10-15"]);
  assert.deepEqual(r.mustahil, []);
});

test("batas ambang: tepat di ambang masih masuk akal, lewat sehari jadi mustahil", () => {
  const hari = 86_400_000;
  const patokan = Date.parse("2026-10-15T00:00:00Z");
  const iso = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
  const tepat = iso(patokan - AMBANG_HARI_MASUK_AKAL * hari);
  const lewat = iso(patokan - (AMBANG_HARI_MASUK_AKAL + 1) * hari);
  assert.deepEqual(pisahTanggalBaris("2026-10-15", [`${tepat} 09:00:00`]).mustahil, []);
  assert.deepEqual(pisahTanggalBaris("2026-10-15", [`${lewat} 09:00:00`]).mustahil, [lewat]);
});

test("tanggal statement tak sah → jangan vonis apa pun mustahil (perilaku lama utuh)", () => {
  const r = pisahTanggalBaris("bukan-tanggal", ["2026-10-15 09:00:00", "8000-10-15 16:00:07"]);
  assert.deepEqual(r.mustahil, []);
  assert.equal(r.masukAkal.length, 2);
});
