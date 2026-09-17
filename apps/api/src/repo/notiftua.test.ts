import assert from "node:assert/strict";
import { test } from "node:test";

import { buildMessage, dashboardLink, formatTuaItem, parseTuaLine } from "./notiftua.js";

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
