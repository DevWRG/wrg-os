import assert from "node:assert/strict";
import { test } from "node:test";

import { bersih, namaFilePdf, parseNarasi, potongInline, seninBriefPdf } from "./senin-brief-pdf.js";
import type { SeninBriefRow } from "./senin-brief.js";

const NARASI = [
  "# Senin Brief W41 — 6–12 Okt",
  "## Tabel Ringkasan",
  "| x |",
  "## Gap Utama per HoD",
  "**Rocky** — TIDAK SIAP",
  "- Pipeline kosong",
  "- AR > 90 hari",
  "## Urutan Prioritas Bahasan",
  "1. Rocky — revenue −20%",
  "2. Yogi — SIAP",
  "## Pertanyaan Kritis Direktur",
  "- Kenapa pipeline 0?",
  "---",
  "## Keputusan Direktur Minggu Ini",
  "1. **Isi pipeline**",
  "Rocky isi sebelum Rabu.",
].join("\n");

const brief = (over: Partial<SeninBriefRow> = {}): SeninBriefRow => ({
  id: "1", iso_year: 2026, iso_week: 41, periode: "5–11 Okt 2026", health: "RISK",
  checks: [
    {
      hod_key: "rocky", nama: "Rocky", peran: "HoD Sales", status: "TIDAK SIAP", watch_status: "RED",
      checks: [
        { no: 1, label: "Data terkini", hasil: "OK", detail: "ok" },
        { no: 2, label: "Pipeline ber-Rp", hasil: "FAIL", detail: "0 deal ≥ 1 → kosong ✅" },
        { no: 3, label: "Tindak lanjut", hasil: "NA", detail: "-" },
        { no: 4, label: "KPI terlacak", hasil: "WARN", detail: "2/3" },
        { no: 5, label: "Data basi", hasil: "FAIL", detail: "x" },
      ],
    },
  ],
  content: NARASI, narasi_ok: true, model_used: "m", wa_terkirim: false, wa_sent_at: null, wa_error: null,
  generated_at: "2026-10-12T00:00:00Z", ...over,
});

test("parseNarasi mengambil empat bagian & membuang garis pemisah", () => {
  const n = parseNarasi(NARASI);
  assert.equal(n.gap.length, 3);
  assert.deepEqual(n.gap[1], { t: "li", teks: "Pipeline kosong" });
  assert.deepEqual(n.urutan[0], { t: "li", teks: "Rocky — revenue −20%", no: 1 });
  assert.equal(n.pertanyaan.length, 1); // '---' tak jadi paragraf
  assert.equal(n.keputusan.length, 2);
});

test("parseNarasi tanpa narasi (brief gagal AI) → semua kosong", () => {
  const n = parseNarasi("# Senin Brief\n## Tabel Ringkasan\n> ⚠️ Narasi AI tidak tersedia");
  assert.deepEqual([n.gap, n.urutan, n.pertanyaan, n.keputusan], [[], [], [], []]);
});

test("bersih membuang emoji & mengganti ≥ → tanpa merusak teks Latin-1", () => {
  assert.equal(bersih("✅ 0 deal ≥ 1 → kosong"), "0 deal >= 1 -> kosong");
  assert.equal(bersih("Rp 5 jt — ok · baik"), "Rp 5 jt - ok · baik");
});

test("potongInline memisahkan tebal", () => {
  assert.deepEqual(potongInline("a **b** c"), [
    { s: "a ", bold: false }, { s: "b", bold: true }, { s: " c", bold: false },
  ]);
});

test("namaFilePdf menomori minggu 2 digit", () => {
  assert.equal(namaFilePdf({ iso_year: 2026, iso_week: 5 }), "pre-meeting-briefing-2026-W05.pdf");
});

test("seninBriefPdf menghasilkan PDF sah, dengan dan tanpa narasi", async () => {
  for (const b of [brief(), brief({ narasi_ok: false, content: "# x\n> ⚠️ narasi gagal" })]) {
    const pdf = await seninBriefPdf(b, { oleh: "Uji" });
    assert.equal(pdf.subarray(0, 5).toString("latin1"), "%PDF-");
    assert.ok(pdf.length > 1500);
  }
});

test("seninBriefPdf tahan brief besar (8 HoD, narasi panjang → banyak halaman)", async () => {
  const hod = brief().checks[0];
  const banyak = brief({
    checks: Array.from({ length: 8 }, (_, i) => ({ ...hod, hod_key: `h${i}`, nama: `HoD ${i}` })),
    content: NARASI + "\n" + Array.from({ length: 80 }, (_, i) => `- baris tambahan ${i} `.padEnd(120, "x")).join("\n"),
  });
  const pdf = await seninBriefPdf(banyak);
  assert.ok((pdf.toString("latin1").match(/\/Type \/Page\b/g) ?? []).length >= 2);
});
