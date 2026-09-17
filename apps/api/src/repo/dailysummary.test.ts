import assert from "node:assert/strict";
import { test } from "node:test";

import {
  blokDaftar,
  blokOverview,
  matchedPct,
  paksaDaftar,
  paksaOverview,
  tandaiTerpotong,
  type DaftarNama,
  type StatsDaily,
} from "./dailysummary.js";

const STATS: StatsDaily = { anggota_aktif: 35, total_report: 322, matched: 300, unmatched: 22, wajib_total: 48 };

test("persen dihitung dari matched/total, bukan dipakai mentah", () => {
  // Inti bugnya: prompt lama menulis "{matched}%" sementara matched = 300 baris.
  assert.equal(matchedPct(STATS), 93);
  assert.notEqual(matchedPct(STATS), STATS.matched);
});

test("total laporan nol tidak menghasilkan NaN/pembagian nol", () => {
  const kosong: StatsDaily = { anggota_aktif: 0, total_report: 0, matched: 0, unmatched: 0, wajib_total: 48 };
  assert.equal(matchedPct(kosong), 0);
  const blok = blokOverview(kosong);
  assert.doesNotMatch(blok, /NaN|Infinity/);
  assert.match(blok, /Belum ada laporan masuk/);
  assert.doesNotMatch(blok, /% sesuai plan/, "tanpa laporan, persen tak bermakna — jangan ditulis");
});

test("angka Overview karangan LLM diganti nilai dari DB", () => {
  const llm = [
    "📊 *Daily Summary — Kamis, 17 September 2026*",
    "",
    "*Overview*",
    "• 35 dari 48 tim wajib aktif lapor",
    "• 322 laporan masuk",
    "• 300% sesuai plan, 22 aktivitas di luar plan",
    "",
    "*Per Area*",
    "_Kediri_",
    "• Nungky Hendarti — 9 tugas operasional",
  ].join("\n");
  const out = paksaOverview(llm, STATS);
  assert.doesNotMatch(out, /300%/, "persen ngawur masih lolos");
  assert.match(out, /• 93% sesuai plan · 22 aktivitas di luar plan/);
  // Section sesudahnya tak boleh ikut terhapus saat Overview ditimpa.
  assert.match(out, /\*Per Area\*\n_Kediri_\n• Nungky Hendarti/);
  assert.equal(out.split("\n")[0], "📊 *Daily Summary — Kamis, 17 September 2026*");
});

test("Overview yang panjang-lebar dipangkas ke tiga baris baku", () => {
  const llm = [
    "📊 *Daily Summary*",
    "",
    "*Overview*",
    "Hari ini tim bekerja sangat produktif di seluruh area.",
    "• 35 dari 48 tim wajib aktif lapor",
    "• banyak laporan masuk",
    "• sebagian besar sesuai plan",
    "",
    "*Highlight*",
    "• Deal RS DKT",
  ].join("\n");
  const out = paksaOverview(llm, STATS);
  assert.doesNotMatch(out, /sangat produktif/);
  assert.doesNotMatch(out, /banyak laporan masuk/);
  assert.match(out, /\*Highlight\*\n• Deal RS DKT/);
});

test("LLM lupa menulis Overview → blok disisipkan setelah judul", () => {
  const llm = "📊 *Daily Summary — Kamis, 17 September 2026*\n\n*Per Area*\n_Kediri_\n• Nungky — 9 tugas";
  const out = paksaOverview(llm, STATS);
  const lines = out.split("\n");
  assert.equal(lines[0], "📊 *Daily Summary — Kamis, 17 September 2026*");
  assert.equal(lines[2], "*Overview*");
  assert.match(out, /\*Per Area\*/);
});

test("judul section lain tidak salah dikenali sebagai Overview", () => {
  const llm = "📊 *Daily Summary*\n\n*Perhatian*\n• Belum report (13): A, B\n";
  const out = paksaOverview(llm, STATS);
  assert.match(out, /• Belum report \(13\): A, B/, "section Perhatian ikut hilang");
});

// === Perhatian/Ijin ditempel sistem, bukan ditulis LLM (#1324 lanjutan) ===
// Uji nyata di prod dengan data 41 pelapor menunjukkan jawaban LLM kena plafon
// token dan berhenti di tengah section Per Area — Highlight, Perhatian, dan Ijin
// hilang tanpa error. Section yang isinya murni data DB tak boleh ikut hilang.

const DAFTAR: DaftarNama = {
  non_reporters: ["Akhmad Iqbal", "Angga Adhitya", "Ari Kurnia"],
  no_plan: ["Hanasta Januar"],
  on_leave: ["Budi (cuti)"],
};

test("Perhatian & Ijin selalu ada meski jawaban LLM terpotong", () => {
  const terpotong = "📊 *Daily Summary*\n\n*Per Area*\n_Pusat_\n• Renika — 16 aktivitas keuangan, proses 20 transaksi masuk-keluar bank, BMHP, imun";
  const out = paksaDaftar(terpotong, DAFTAR);
  assert.match(out, /\*Perhatian\*/);
  assert.match(out, /• Belum report \(3\): Akhmad Iqbal, Angga Adhitya, Ari Kurnia/);
  assert.match(out, /• Belum plan \(1\): Hanasta Januar/);
  assert.match(out, /\*Ijin\*\n• Budi \(cuti\)/);
});

test("versi LLM dibuang, tidak jadi dobel", () => {
  const llm = [
    "📊 *Daily Summary*",
    "",
    "*Highlight*",
    "• Deal RSI Kalianget masuk",
    "",
    "*Perhatian*",
    "• Ngawur Satu, Ngawur Dua",
    "",
    "*Ijin*",
    "• Nama Karangan",
  ].join("\n");
  const out = paksaDaftar(llm, DAFTAR);
  assert.doesNotMatch(out, /Ngawur|Karangan/, "section karangan LLM masih terkirim");
  assert.equal(out.match(/\*Perhatian\*/g)?.length, 1, "Perhatian dobel");
  assert.equal(out.match(/\*Ijin\*/g)?.length, 1, "Ijin dobel");
  assert.match(out, /\*Highlight\*\n• Deal RSI Kalianget masuk/, "Highlight ikut terbuang");
});

test("tak ada yang ijin → section Ijin tidak muncul", () => {
  const out = paksaDaftar("📊 *Daily Summary*\n\n*Highlight*\n• apa saja.", { ...DAFTAR, on_leave: [] });
  assert.doesNotMatch(out, /\*Ijin\*/);
  assert.match(out, /\*Perhatian\*/);
});

test("semua sudah submit → Perhatian tetap ada dengan kalimat aman", () => {
  const out = blokDaftar({ non_reporters: [], no_plan: [], on_leave: [] });
  assert.match(out, /• \(semua wajib user sudah submit\)/);
});

test("kalimat yang putus di tengah ditandai, kalimat utuh tidak", () => {
  const putus = "📊 *Daily Summary*\n\n*Per Area*\n• Renika — proses 20 transaksi, BMHP, imun";
  assert.match(tandaiTerpotong(putus), /…\n_\(ringkasan terpotong/);
  const utuh = "📊 *Daily Summary*\n\n*Per Area*\n• Renika — proses 20 transaksi selesai.";
  assert.equal(tandaiTerpotong(utuh), utuh);
});
