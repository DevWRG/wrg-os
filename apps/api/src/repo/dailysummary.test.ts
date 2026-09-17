import assert from "node:assert/strict";
import { test } from "node:test";

import { blokOverview, matchedPct, paksaOverview, type StatsDaily } from "./dailysummary.js";

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
