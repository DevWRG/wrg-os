import test from "node:test";
import assert from "node:assert/strict";

import type { WeeklyBoard, WeeklyMetric } from "./watchpoint-weekly.js";
import {
  deretMinggu, formatWaRingkas, metrikMerah, nilai, pergerakanTerbesar, ringkasHod, ringkasStatus, rupiahRingkas,
  teksAngka, ubahPersen,
} from "./weekly-briefing-angka.js";
import { parseMarkdown, pisahRingkasan, namaFileBriefingPdf } from "./weekly-briefing-pdf.js";

const m = (o: Partial<WeeklyMetric>): WeeklyMetric => ({
  key: "k", label: "Metrik", target: 100, actual: 50, prevActual: 40, unit: "", direction: "higher",
  source: "db", pct: 50, status: "YELLOW", trend: "improving", ...o,
});
const board = (): WeeklyBoard => ({
  isoYear: 2026, isoWeek: 34, label: "W34", periode: "17–23 Agustus 2026", from: "2026-08-17", to: "2026-08-23",
  isCurrent: false, saved: true, asOf: "", meta: { gate: "", legend: { GREEN: "", YELLOW: "", RED: "", NA: "" } },
  hods: [
    { key: "a", name: "HoD A", role: "Sales", status: "RED", metrics: [
      m({ key: "rev", label: "Revenue", unit: "Rp", target: 500e6, actual: 600e6, prevActual: 480e6, pct: 120, status: "GREEN" }),
      m({ key: "churn", label: "Churn", target: 0, actual: 12, prevActual: 10, direction: "lower", pct: 0, status: "RED", trend: "declining" }),
    ] },
    { key: "b", name: "HoD B", role: "Ops", status: "NA", metrics: [m({ key: "x", actual: null, prevActual: null, pct: null, status: "NA" })] },
  ],
});

test("rupiahRingkas & nilai sesuai satuan", () => {
  assert.equal(rupiahRingkas(512_345_678), "Rp 512 jt");
  assert.equal(rupiahRingkas(1_250_000_000), "Rp 1,25 M");
  assert.equal(nilai(null, "Rp"), "-");
  assert.equal(nilai(77.46, "%"), "77,5%");
  assert.equal(nilai(13, "kunjungan"), "13 kunjungan");
});

test("ringkasStatus & ringkasHod menghitung per status", () => {
  assert.deepEqual(ringkasStatus(board()), { GREEN: 1, YELLOW: 0, RED: 1, NA: 1, total: 3 });
  assert.deepEqual(ringkasHod(board()), { GREEN: 0, YELLOW: 0, RED: 1, NA: 1 });
});

test("pergerakanTerbesar sadar arah: churn naik = memburuk", () => {
  const g = pergerakanTerbesar(board());
  assert.equal(g.membaik[0].label, "Revenue");
  assert.equal(g.memburuk[0].label, "Churn");
  assert.equal(ubahPersen({ actual: 5, prevActual: 0 }), null);
});

test("metrikMerah & teksAngka memakai angka papan apa adanya", () => {
  assert.deepEqual(metrikMerah(board()), [{ hod: "HoD A", label: "Churn", teks: "12 vs target 0" }]);
  const t = teksAngka(board());
  assert.match(t, /1 hijau, 0 kuning, 1 merah, 1 belum ada data/);
  assert.match(t, /Revenue: Rp 600 jt \(target Rp 500 jt, hijau, membaik, \+25% vs minggu sebelumnya\)/);
  assert.match(t, /HoD B \(Ops\) status belum ada data: belum ada metrik berangka/);
});

test("formatWaRingkas: ringkas + link; tanpa link → null", () => {
  const t = formatWaRingkas({ isoWeek: 35, periode: "24–30 Agustus 2026", dasar: "17–23 Agustus 2026",
    hod: ringkasHod(board()), merah: metrikMerah(board()), link: "https://os.example/briefings/unduh/2026/35" });
  assert.ok(t);
  assert.match(t!, /Briefing Mingguan W35/);
  assert.match(t!, /🔴 1/);
  assert.match(t!, /HoD A — Churn: 12 vs target 0/);
  assert.match(t!, /https:\/\/os\.example\/briefings\/unduh\/2026\/35$/);
  assert.ok(t!.split("\n").length <= 10);
  assert.equal(formatWaRingkas({ isoWeek: 35, periode: "", dasar: "", link: null }), null);
});

test("deretMinggu melintasi pergantian tahun ISO", () => {
  const d = deretMinggu(2026, 2, 4);
  assert.equal(d.length, 4);
  assert.deepEqual(d[3], { isoYear: 2026, isoWeek: 2 });
  assert.equal(d[0].isoYear, 2025);
});

test("parseMarkdown: heading, bullet bertingkat, nomor, tabel tanpa baris pemisah", () => {
  const b = parseMarkdown([
    "# JUDUL", "==========", "## A. RINGKASAN", "Paragraf **tebal**.", "## B. SALES", "### Sub", "- satu", "  - anak", "1. pertama",
    "| PIC | Tugas |", "|-----|-------|", "| **X** | kerja |",
  ].join("\n"));
  assert.deepEqual(b.map((x) => x.t), ["h1", "h2", "p", "h2", "h3", "li", "li", "li", "tabel"]);
  const tb = b.at(-1);
  assert.ok(tb && tb.t === "tabel");
  assert.deepEqual(tb.kepala, ["PIC", "Tugas"]);
  assert.deepEqual(tb.baris, [["**X**", "kerja"]]);
  const anak = b[6];
  assert.ok(anak.t === "li" && anak.level === 1);
  const { ringkasan, sisa } = pisahRingkasan(b);
  assert.deepEqual(ringkasan.map((x) => x.t), ["p"]);
  assert.equal(sisa[0].t, "h2");
  assert.equal(namaFileBriefingPdf(2026, 5), "briefing-mingguan-2026-W05.pdf");
});
