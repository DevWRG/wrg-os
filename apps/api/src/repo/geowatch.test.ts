// Tes pesan sweep harian "foto visit tanpa koordinat". Murni (tanpa DB):
// `pnpm --filter @wrg/api test`.
//
// Yang dijaga di sini: (1) job harian yang tetap berkicau saat bersih akan
// diabaikan dalam sepekan, jadi bersih HARUS berarti tidak ada pesan; (2) dua
// sebab tak boleh digabung — obatnya beda, dan menggabungkannya menyuruh AM
// yang overlay-nya sudah benar melakukan kunjungan ulang.

import test from "node:test";
import assert from "node:assert/strict";

import { buildGeoSweepMessage, type GeoSweepAm } from "./geowatch.js";

const am = (nama: string, tanpaOverlay: string[], ocrGagal: string[] = []): GeoSweepAm => ({
  am_id: nama.toLowerCase(),
  nama,
  tanpa_overlay: tanpaOverlay,
  ocr_gagal: ocrGagal,
});

test("tidak ada temuan → TIDAK mengirim pesan sama sekali", () => {
  assert.equal(buildGeoSweepMessage("2026-09-09", []), null);
});

test("judul memuat tanggal + nama hari, dan total lintas AM", () => {
  const s = buildGeoSweepMessage("2026-09-09", [am("Arif", ["RS A", "RS B"]), am("Luri", ["PKM C"])])!;
  // 2026-09-09 = Rabu
  assert.match(s, /Foto visit tanpa koordinat — Rabu 2026-09-09/);
  assert.match(s, /3 kunjungan dari 2 AM belum terhitung di menu Visits/);
});

test("dua sebab dipisah per AM, tiap customer di baris yang benar", () => {
  const s = buildGeoSweepMessage("2026-09-09", [am("Iqbal", ["RS A"], ["RS B", "RS C"])])!;
  assert.match(s, /\*Iqbal\* \(3\)/);
  assert.match(s, /• Tanpa overlay geotag: RS A/);
  assert.match(s, /• Koordinat gagal dibaca: RS B, RS C/);
});

test("AM yang cuma punya satu sebab tidak dapat baris kosong sebab lainnya", () => {
  const s = buildGeoSweepMessage("2026-09-09", [am("Ari", [], ["RS X"])])!;
  assert.match(s, /Koordinat gagal dibaca: RS X/);
  assert.doesNotMatch(s, /Tanpa overlay geotag:/);
});

test("kaki pesan menerangkan dua obat yang berbeda", () => {
  const s = buildGeoSweepMessage("2026-09-09", [am("Arif", ["RS A"], ["RS B"])])!;
  // tanpa overlay = foto ulang; galeri tak menolong karena overlay tak ikut
  assert.match(s, /\*Tanpa overlay\* → foto ulang pakai Geo-Tagging Camera/);
  assert.match(s, /galeri tak menolong/);
  // OCR gagal = cukup kirim ulang foto yang sama, bukan kunjungan ulang
  assert.match(s, /\*Koordinat gagal dibaca\* → kirim ulang foto yang sama/);
  assert.match(s, /7 hari ke belakang/);
});

test("AM diurutkan dari temuan terbanyak", () => {
  const s = buildGeoSweepMessage("2026-09-09", [
    am("Zulu", ["RS A"]),
    am("Alpha", ["RS B", "RS C", "RS D"]),
  ])!;
  assert.ok(s.indexOf("*Alpha*") < s.indexOf("*Zulu*"), "AM dgn temuan terbanyak harus di atas");
});
