// Tes peringatan selisih tanggal header #REPORT vs tanggal pesan.
//
// parsers/tanggal.ts sudah menjaring salah-TAHUN (>= 365 hari) dan tanggal masa
// depan (> 7 hari), tapi sengaja memberi ruang 180 hari ke belakang. Celah itu
// meloloskan salah ketik BULAN tanpa suara: audit export grup The ALLIANCE vs
// prod (9 Sep 2026) menemukan 22 kunjungan difile 8-49 hari di belakang tanggal
// sebenarnya, plus ~76 baris duplikat. Kasus nyata yang dipakai di tes bawah.
//
// Murni (tanpa DB): `pnpm --filter @wrg/api test`.

import test from "node:test";
import assert from "node:assert/strict";

import { buildPeringatanTanggal, AMBANG_SELISIH_TANGGAL } from "./inbound.js";

test("selisih 0 hari (laporan hari itu) → diam", () => {
  assert.equal(buildPeringatanTanggal("2026-07-22", "2026-07-22"), null);
});

test("laporan H-1 (kirim subuh utk hari sebelumnya) → diam", () => {
  assert.equal(buildPeringatanTanggal("2026-07-21", "2026-07-22"), null);
});

test("laporan H-2 (Senin utk Sabtu) → diam, jangan berisik utk pola normal", () => {
  assert.equal(buildPeringatanTanggal("2026-07-25", "2026-07-27"), null);
});

test("Luri: kirim 22 Jul tulis 14/7 (selisih 8 hari) → diperingatkan", () => {
  const s = buildPeringatanTanggal("2026-07-14", "2026-07-22");
  assert.ok(s, "harus ada peringatan");
  assert.match(s!, /Cek tanggal/);
  assert.match(s!, /2026-07-14/);
  assert.match(s!, /2026-07-22/);
  assert.match(s!, /selisih 8 hari/);
  assert.match(s!, /lebih tua/);
  // tanggalnya TIDAK diubah paksa — AM yang mengoreksi
  assert.match(s!, /dicatat ke \*2026-07-14\* sesuai yang kamu tulis/i);
  assert.match(s!, /kirim ulang #REPORT/);
});

test("Luri: kirim 29 Jul tulis 10/6 (selisih 49 hari) → diperingatkan", () => {
  const s = buildPeringatanTanggal("2026-06-10", "2026-07-29");
  assert.match(s!, /selisih 49 hari/);
});

test("Yugo: kirim 6 Agu tulis 6/7 (selisih 31 hari) → diperingatkan", () => {
  const s = buildPeringatanTanggal("2026-07-06", "2026-08-06");
  assert.match(s!, /selisih 31 hari/);
});

test("tanggal di MASA DEPAN relatif pesan → diperingatkan, arahnya disebut", () => {
  const s = buildPeringatanTanggal("2026-08-04", "2026-07-28");
  assert.match(s!, /selisih 7 hari/);
  assert.match(s!, /di masa depan/);
});

test("tepat di ambang (3 hari) → sudah diperingatkan", () => {
  assert.ok(buildPeringatanTanggal("2026-07-19", "2026-07-22"));
  // dan satu hari di bawah ambang masih diam
  assert.equal(buildPeringatanTanggal("2026-07-20", "2026-07-22"), null);
});

test("ambangnya 3 hari", () => {
  assert.equal(AMBANG_SELISIH_TANGGAL, 3);
});

test("input tak valid → diam, jangan bikin balasan rusak", () => {
  assert.equal(buildPeringatanTanggal("bukan-tanggal", "2026-07-22"), null);
  assert.equal(buildPeringatanTanggal("2026-07-22", "ngawur"), null);
});
