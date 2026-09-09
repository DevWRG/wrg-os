import assert from "node:assert/strict";
import { test } from "node:test";

import { laporBatasHalaman } from "./accurateSync.js";

// Batas halaman di syncer master ADA supaya loop tak pernah tak berujung.
// Yang jadi masalah bukan batasnya, tapi DIAMNYA: sebelum ini, `break` karena
// batas dan `break` karena halaman terakhir sama-sama membalas ok:true, jadi
// hasil terpotong menyamar jadi sapuan lengkap.
//
// Itu bukan hipotesis — persis begitu yang terjadi pada backfill faktur
// (#1177): berhenti di 10.000 dari 11.323 baris, respons tetap ok, runner
// mencetak hijau. Katalog item sekarang 5.893 dari kapasitas 10.000.

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

test("di bawah batas → false, dan DIAM (tak mengotori log tiap halaman)", () => {
  const { hasil, pesan } = tangkapWarn(() => laporBatasHalaman("item", 37, 100, 100));
  assert.equal(hasil, false);
  assert.deepEqual(pesan, []);
});

test("tepat di batas → true DAN berbunyi", () => {
  const { hasil, pesan } = tangkapWarn(() => laporBatasHalaman("item", 100, 100, 100));
  assert.equal(hasil, true);
  assert.equal(pesan.length, 1);
});

test("melewati batas → tetap tertangkap (bukan cuma sama-dengan)", () => {
  // Kalau asersinya `page === maxPages`, loop yang menaikkan page sebelum
  // pemeriksaan akan melewatinya diam-diam.
  const { hasil } = tangkapWarn(() => laporBatasHalaman("vendor", 51, 50, 100));
  assert.equal(hasil, true);
});

test("pesan menyebut nama syncer, batas, DAN jumlah baris", () => {
  const { pesan } = tangkapWarn(() => laporBatasHalaman("vendor", 50, 50, 100));
  const p = pesan[0];
  assert.match(p, /vendor/);
  assert.match(p, /50 halaman/);
  assert.match(p, /5000 baris/);   // 50 x 100 — supaya besarannya langsung terbaca
});

test("pesan menyatakan TERPOTONG, bukan sekadar 'batas tercapai'", () => {
  // Bedanya bukan gaya bahasa: "batas tercapai" terbaca netral, sementara yang
  // sebenarnya terjadi adalah data hilang. Kata itu yang bikin orang bertindak.
  const { pesan } = tangkapWarn(() => laporBatasHalaman("customer", 100, 100, 100));
  assert.match(pesan[0], /TERPOTONG/);
});

test("perPage ikut menentukan angka baris yang dilaporkan", () => {
  const { pesan } = tangkapWarn(() => laporBatasHalaman("faktur", 200, 200, 50));
  assert.match(pesan[0], /10000 baris/);
});
