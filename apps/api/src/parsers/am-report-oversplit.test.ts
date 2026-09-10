// Regresi over-split #REPORT AM: laporan NARATIF tak boleh pecah jadi kunjungan.
//
// Latar: cabang "customer baru" dulu menerima SETIAP baris tak berlabel begitu
// `hasil` terisi. Laporan bergaya rinci — satu faskes, paragraf panjang, daftar
// alat & kompetitor — karenanya pecah: tiap baris lahir jadi kunjungan palsu.
// Di produksi terhitung 363 baris sampah (135 bullet, 195 kalimat, 33 kosong),
// semuanya `is_unmatched`, sehingga angka kepatuhan menggelembung.
//
// Semua fixture di bawah disalin dari pesan NYATA di `wa_message` produksi.
// Diadu ke 1.393 pesan #REPORT jalur AM: 463 item palsu tak lagi lahir, NOL
// nama baru muncul, dan dari 346 nama yang tak lagi lahir hanya 1 yang
// menyerupai rencana — itu pun catatan perjalanan, bukan faskes.

import test from "node:test";
import assert from "node:assert/strict";

import { parseAmReport } from "./am.js";

const NOW = Date.parse("2026-08-20T05:00:00Z");
const nama = (b: string) => parseAmReport(b, NOW).items.map((i) => i.customer);

// Potongan asli laporan Sidqi (RS PKU Muh. Wonosobo). Bentuknya: satu `Cust:`,
// label `Hasil:` KOSONG, lalu prosa mengalir + daftar alat ber-bullet.
const LAPORAN_NARATIF = `#REPORT

Cust: RS PKU Muh. Wonosobo

Hasil:

> Instalasi Laboratorium

Bertemu Pak Josef (Korlab) disampaikan u/ dr. Tri Novi, Sp.PK hanya Selasa dan Kamis 15.00-17.00.

Hematologi
- Dymind DH-800 - KSO via PT Multi Medika Raharjo @Rp15-16rban/tes
Kimia Klinik
- Indiko Plus - KSO via PT Radno
BGA
- Siemens - KSO
LIS
- Vans Lab - subscribe bulanan via PT Dexa

Next: Arrange meeting kebutuhan fitur dari Lab RS untuk LIS.`;

test("laporan naratif satu faskes tidak pecah jadi banyak kunjungan", () => {
  const r = parseAmReport(LAPORAN_NARATIF, NOW);
  assert.deepEqual(
    r.items.map((i) => i.customer),
    ["Cust: RS PKU Muh. Wonosobo"],
  );
  // Isi laporan TIDAK dibuang — ia menempel jadi `hasil`, jadi yang hilang
  // hanya baris palsunya.
  assert.match(r.items[0].hasil, /Bertemu Pak Josef/);
  assert.match(r.items[0].hasil, /Dymind DH-800/);
  assert.match(r.items[0].hasil, /Vans Lab/);
  assert.equal(r.items[0].next_action, "Arrange meeting kebutuhan fitur dari Lab RS untuk LIS.");
});

test("baris ber-bullet adalah inventaris alat, bukan faskes baru", () => {
  const n = nama("#REPORT\nCust: RS Anu\nHasil: bertemu analis\n- Mindray BC-5130 - KSO PT Citramed\n- Ichroma - KSO via PT PBSM");
  assert.deepEqual(n, ["Cust: RS Anu"]);
});

test("kalimat panjang (>60) tidak pernah jadi nama faskes", () => {
  // Nama terpanjang yang terbukti nyata di produksi: 48 karakter di sales_plan,
  // 52 di activity_log yang terikat rencana. Nol baris melewati 60 di keduanya.
  const r = parseAmReport(
    "#REPORT\nCust: RS Anu\nHasil: ketemu dr\nKemudian lanjut kordinasi dengan admin urus MOU RS mitra sehat sekaligus buat format",
    NOW,
  );
  assert.deepEqual(r.items.map((i) => i.customer), ["Cust: RS Anu"]);
  assert.match(r.items[0].hasil, /Kemudian lanjut kordinasi/);
});

test("`*` TETAP nama faskes sah — bukan bullet", () => {
  // AM memakai `*` sebagai penanda tebal pada nama ASLI, dan sebagian baris itu
  // memang terikat rencana di produksi (`*Rsud Ar-Rozy`, `*Update Klinik
  // Panggih Griya Husada`). Karena itu `*` sengaja tak diperlakukan sebagai
  // bullet, berbeda dari `-` dan `•`.
  const n = nama("#REPORT\nCust: *Rsud Ar-Rozy\nHasil: bertemu Bu Ana");
  assert.deepEqual(n, ["Cust: *Rsud Ar-Rozy"]);
});

test("gaya baris polos Irul tetap utuh: label berisi membuka faskes berikutnya", () => {
  const n = nama("#Report Irul 18/8/2026\nrsu muh babat\nhasil: ketemu analis\nRs nu babat\nhasil: fwup");
  assert.deepEqual(n, ["rsu muh babat", "Rs nu babat"]);
});

test("`hadir|visit selesai|...` sesudah baris bernomor adalah hasil, bukan faskes", () => {
  // Kasus Irul: baris kedua bersegmen tapi masih isi entri yang sedang berjalan.
  const r = parseAmReport(
    "#Report Irul 15/6/2026\n1. Rsab Bojonegoro\nhadir|visit selesai| laboratorium dr is sppk terkait SPH imun\nnext : komunikasi intens dg dr is sppk",
    NOW,
  );
  assert.deepEqual(r.items.map((i) => i.customer), ["Rsab Bojonegoro"]);
  assert.match(r.items[0].hasil, /visit selesai/);
  assert.equal(r.items[0].next_action, "komunikasi intens dg dr is sppk");
});

test("daftar bersegmen tanpa nomor tetap pecah per faskes", () => {
  const n = nama("#Report Ari 19/8/2026\nRS Al-Islam — ketemu dr Andi — demo Jumat\nRS Bethesda — ketemu analis — kirim SPH");
  assert.deepEqual(n, ["RS Al-Islam", "RS Bethesda"]);
});

test("daftar bernomor tetap pecah per faskes", () => {
  const n = nama("#Report Sidqi 18/8/2026\n1. Cust: Klinik Ananda\nhasil: Bertemu Ibu Isti\n2. Cust: RS Panti Waluyo\nhasil: bertemu analis");
  assert.deepEqual(n, ["Cust: Klinik Ananda", "Cust: RS Panti Waluyo"]);
});

test("beberapa `Cust:` dalam satu pesan tetap terbaca sebagai faskes terpisah", () => {
  const n = nama("#REPORT\nCust: RS Prasetya Husada\nHasil: bertemu Mbak Fitri\nCust: RS Mitra Sehat\nHasil: bertemu Pak Budi");
  assert.deepEqual(n, ["Cust: RS Prasetya Husada", "Cust: RS Mitra Sehat"]);
});
