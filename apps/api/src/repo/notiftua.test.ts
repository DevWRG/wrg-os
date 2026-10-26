import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildMessage,
  dashboardLink,
  extractOutstanding,
  formatTuaItem,
  kategoriItem,
  nilaiItem,
  parseTuaLine,
  aksiLewatTenggat,
  extractActionItems,
  parseTenggat,
  topikKey,
  umurMenit,
} from "./notiftua.js";

// Baris nyata dari resume eksekutif 16 Sep 2026 yang terkirim ke WA. Sebelum
// dirapikan, baris ini dikirim apa adanya: satu paragraf panjang berisi pipe,
// JID mentah, dan tag [TUA] yang sudah disebut di judul pesan.
const BARIS =
  "• Main power, instalasi RO/pompa RO, instalasi air utama untuk RO | dari: Sigit purnomo | " +
  "ke: MEP contractor (@Arif rahman WRG, @138435419455601) | sejak jam 12:00 WIB (10 jam) [TUA] | " +
  "status: pending survei lokasi sebelum terpasang, koordinasi teknis belum final";

test("parse memecah baris resume jadi bagian-bagiannya", () => {
  const it = parseTuaLine(BARIS);
  assert.equal(it.topik, "Main power, instalasi RO/pompa RO, instalasi air utama untuk RO");
  assert.equal(it.dari, "Sigit Purnomo");
  assert.equal(it.sejak, "12:00 WIB");
  assert.equal(it.umur, "10 jam");
  assert.match(it.status ?? "", /^Pending survei lokasi/);
  assert.deepEqual(it.lain, [], "tak boleh ada segmen yang tak terpetakan");
});

test("JID mentah dibuang, nama tetap utuh", () => {
  const it = parseTuaLine(BARIS);
  assert.equal(it.ke, "MEP Contractor (Arif Rahman WRG)");
  assert.doesNotMatch(it.ke ?? "", /\d{8,}/, "nomor JID masih ikut terkirim");
  assert.doesNotMatch(it.ke ?? "", /@/, "'@' palsu (bukan mention WA) masih tersisa");
});

test("tag [TUA] tidak diulang di badan pesan", () => {
  const blok = formatTuaItem(BARIS, 1);
  assert.doesNotMatch(blok, /\[TUA/i);
  assert.doesNotMatch(blok, /\|/, "pipe mentah masih bocor ke pesan");
});

test("penanda tebal WA tidak melintasi newline", () => {
  const blok = formatTuaItem(BARIS, 1);
  // WhatsApp membatalkan *...* yang menyeberangi baris; judul wajib satu baris.
  for (const baris of blok.split("\n")) {
    assert.equal((baris.match(/\*/g) ?? []).length % 2, 0, `tebal ganjil di: ${baris}`);
  }
  assert.match(blok.split("\n")[0], /^\*1\. /);
});

test("baris tanpa label tetap terkirim, bukan hilang diam-diam", () => {
  const it = parseTuaLine("• Topik saja | keterangan bebas tanpa label");
  assert.equal(it.topik, "Topik saja");
  assert.deepEqual(it.lain, ["keterangan bebas tanpa label"]);
  assert.match(formatTuaItem("• Topik saja | keterangan bebas tanpa label", 2), /keterangan bebas tanpa label/);
});

test("baris yang sama sekali tak berformat dipakai apa adanya", () => {
  const blok = formatTuaItem("item TUA tanpa struktur apa pun", 1);
  assert.equal(blok, "*1. item TUA tanpa struktur apa pun*");
});

test("link dashboard pakai domain publik, bukan host tailnet", () => {
  const before = { web: process.env.WEB_PUBLIC_URL, tua: process.env.NOTIF_TUA_DASHBOARD_URL };
  try {
    // Persis kondisi .env.prod sebelum dibereskan: dua-duanya terisi, yang
    // tailnet lebih dulu dibaca → penerima di luar tailnet tak bisa membuka.
    process.env.WEB_PUBLIC_URL = "https://os.wahanalifeline.co.id";
    process.env.NOTIF_TUA_DASHBOARD_URL = "https://mac-mini-development.tail88405f.ts.net/";
    assert.equal(dashboardLink(), "https://os.wahanalifeline.co.id/monitor/resume");

    delete process.env.WEB_PUBLIC_URL;
    assert.equal(dashboardLink(), "https://mac-mini-development.tail88405f.ts.net/monitor/resume");

    delete process.env.NOTIF_TUA_DASHBOARD_URL;
    assert.equal(dashboardLink(), "", "tanpa env, jangan kirim link setengah jadi");
  } finally {
    if (before.web) process.env.WEB_PUBLIC_URL = before.web; else delete process.env.WEB_PUBLIC_URL;
    if (before.tua) process.env.NOTIF_TUA_DASHBOARD_URL = before.tua; else delete process.env.NOTIF_TUA_DASHBOARD_URL;
  }
});

test("lebih dari 5 item: 5 ditampilkan, sisanya dihitung", () => {
  const banyak = Array.from({ length: 8 }, (_, i) => `• Topik ${i + 1} | status: TUA menunggu`);
  const msg = buildMessage(banyak, "2026-09-16", "22:15");
  assert.match(msg, /^🚨 \*8 Item TUA/);
  assert.match(msg, /_16 Sep 2026 · 22:15 WIB/);
  assert.match(msg, /\*5\. Topik 5\*/);
  assert.doesNotMatch(msg, /\*6\. /);
  assert.match(msg, /…\+3 item lainnya/);
});

// ── QW2: ambang bertingkat + eskalasi Harga ──────────────────────────────────
const JAM = 3600 * 1000;
const HARI = 24 * JAM;
const NOW = Date.UTC(2026, 9, 26, 7, 0);

test("umurMenit membaca jam, menit, hari, dan gabungannya", () => {
  assert.equal(umurMenit("10 jam"), 600);
  assert.equal(umurMenit("1 jam 20 menit"), 80);
  assert.equal(umurMenit("2 hari"), 2880);
  assert.equal(umurMenit("45 menit"), 45);
  assert.equal(umurMenit("belum lama"), null);
  assert.equal(umurMenit(undefined), null);
});

test("kategori Harga dikenali dari topik atau status", () => {
  assert.equal(kategoriItem(parseTuaLine("• Konfirmasi harga reagen ke customer | status: menunggu")), "harga");
  assert.equal(kategoriItem(parseTuaLine("• Isi spidol | status: menunggu penawaran vendor")), "harga");
  assert.equal(kategoriItem(parseTuaLine("• Isi spidol whiteboard | status: belum dijawab")), "umum");
});

test("ambang: umum 8 jam, Harga 4 jam", () => {
  const umum = parseTuaLine("• Isi spidol | sejak jam 10:00 WIB (6 jam) [TUA]");
  assert.equal(nilaiItem(umum, true, null, NOW).tua, false, "6 jam belum TUA untuk umum");
  const umum9 = parseTuaLine("• Isi spidol | sejak jam 10:00 WIB (9 jam) [TUA]");
  assert.equal(nilaiItem(umum9, true, null, NOW).tua, true);
  const harga = parseTuaLine("• Harga reagen | sejak jam 10:00 WIB (5 jam) [TUA]");
  assert.equal(nilaiItem(harga, true, null, NOW).tua, true, "Harga 5 jam sudah TUA");
});

test("umur tak terbaca: ikut tag LLM", () => {
  const it = parseTuaLine("• Topik tanpa umur | status: menunggu");
  assert.equal(nilaiItem(it, true, null, NOW).tua, true);
  assert.equal(nilaiItem(it, false, null, NOW).tua, false);
});

test("eskalasi hanya Harga lebih dari 2 hari, umur dari pelacakan pertama-terlihat", () => {
  const harga = parseTuaLine("• Harga reagen | sejak jam 10:00 WIB (5 jam)");
  assert.equal(nilaiItem(harga, false, NOW - 3 * HARI, NOW).eskalasi, true);
  assert.equal(nilaiItem(harga, false, NOW - 2 * HARI, NOW).eskalasi, false, "tepat 2 hari belum >2 hari");
  const umum = parseTuaLine("• Isi spidol | sejak jam 10:00 WIB (5 jam)");
  assert.equal(nilaiItem(umum, false, NOW - 5 * HARI, NOW).eskalasi, false, "non-Harga tak dieskalasi ke Direktur");
  assert.equal(nilaiItem(umum, false, NOW - 5 * HARI, NOW).tua, true);
});

test("extractOutstanding mengambil semua item, bukan hanya yang bertag TUA", () => {
  const resume = [
    "4. KONFIRMASI TRACKING",
    "⏳ OUTSTANDING — masih menunggu (urutkan dari paling tua):",
    "• A | dari X | ke Y | sejak jam 08:00 WIB (6 jam) | status: m",
    "• B | dari X | ke Y | sejak jam 02:00 WIB (12 jam) [TUA] | status: m",
    "5. KENDALA",
    "• bukan item",
  ].join("\n");
  assert.equal(extractOutstanding(resume).length, 2);
  assert.equal(extractOutstanding("⏳ OUTSTANDING\nTidak ada\n5. X").length, 0);
});

test("topikKey stabil terhadap huruf besar & tanda baca", () => {
  assert.equal(topikKey("Harga Reagen, X-1"), topikKey("harga reagen x 1"));
  assert.notEqual(topikKey("harga reagen"), topikKey("harga alat"));
});

test("pesan memuat blok eskalasi ke Direktur bila ada", () => {
  const msg = buildMessage(["• Harga reagen | status: menunggu"], "2026-10-26", "14:05", [{ topik: "Harga reagen", umur: 3 * 1440 }]);
  assert.match(msg, /🔺 \*Eskalasi ke Direktur/);
  assert.match(msg, /• Harga reagen — 3 hari/);
  assert.doesNotMatch(buildMessage(["• x"], "2026-10-26", "14:05"), /Eskalasi/);
});

// ── Action items lewat tenggat ───────────────────────────────────────────────
// Senin 26 Okt 2026 10:00 WIB (pseudo-UTC).
const SEKARANG = Date.UTC(2026, 9, 26, 10, 0);
const akhirHari = (y: number, m: number, d: number) => Date.UTC(y, m, d) + 24 * 3600 * 1000 - 60000;

test("parseTenggat: berbagai format tanggal Indonesia", () => {
  const e = akhirHari(2026, 9, 24);
  assert.equal(parseTenggat("24 Okt", SEKARANG), e);
  assert.equal(parseTenggat("deadline: 24 Oktober 2026", SEKARANG), e);
  assert.equal(parseTenggat("24/10", SEKARANG), e);
  assert.equal(parseTenggat("24-10-2026", SEKARANG), e);
  assert.equal(parseTenggat("2026-10-24", SEKARANG), e);
  assert.equal(parseTenggat("kemarin", SEKARANG), akhirHari(2026, 9, 25));
  assert.equal(parseTenggat("hari ini jam 09:00", SEKARANG), Date.UTC(2026, 9, 26, 9, 0));
  assert.equal(parseTenggat("Jumat", SEKARANG), null, "nama hari ambigu → tak ditebak");
  assert.equal(parseTenggat("segera", SEKARANG), null);
});

test("parseTenggat: tanpa tahun, Desember dibaca bulan Januari = tahun lalu", () => {
  const jan = Date.UTC(2027, 0, 5, 10, 0);
  assert.equal(parseTenggat("28 Des", jan), akhirHari(2026, 11, 28));
});

test("aksiLewatTenggat: lewat jadi TUA, belum lewat / tak terbaca diabaikan", () => {
  const lewat = aksiLewatTenggat("• Budi → kirim penawaran RS Sehat | 24 Okt | status: belum", SEKARANG);
  assert.ok(lewat);
  assert.equal(lewat.it.topik, "Kirim penawaran RS Sehat");
  assert.equal(lewat.it.dari, "Budi");
  assert.ok(lewat.lewatMenit > 24 * 60);
  assert.match(formatTuaItem(lewat.raw, 1), /lewat tenggat 24 Okt/);
  assert.equal(aksiLewatTenggat("• Budi → kirim penawaran | 27 Okt | status: belum", SEKARANG), null, "belum lewat");
  assert.equal(aksiLewatTenggat("• Budi → kirim penawaran | segera | status: belum", SEKARANG), null, "tenggat tak terbaca");
  assert.equal(aksiLewatTenggat("• Tidak ada", SEKARANG), null);
});

test("extractActionItems hanya membaca section 3", () => {
  const resume = [
    "2. PIPELINE",
    "• bukan aksi | 1 Okt",
    "3. ACTION ITEMS OUTSTANDING",
    "• Budi → A | 24 Okt | belum",
    "• Ani → B | 30 Okt | proses",
    "4. KONFIRMASI TRACKING",
    "• bukan aksi juga | 2 Okt",
  ].join("\n");
  assert.equal(extractActionItems(resume).length, 2);
});
