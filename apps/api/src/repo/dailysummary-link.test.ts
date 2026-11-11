// 308 — Daily Summary ringkas + halaman /ds/<token>: pengurai ringkasan LLM, pesan WA ringkas, token. Data fiktif.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buatTokenDs, formatWaRingkas, tautanDs, TOKEN_DS, uraiRingkasan } from "./dailysummary-link.js";
import { paksaDaftar, paksaOverview, type DaftarNama, type StatsDaily } from "./dailysummary.js";

// Bentuk keluaran LLM persis seperti di grup (judul area miring, "• Nama — isi", Highlight), nama fiktif.
const LLM = `📊 *Daily Summary — Rabu, 11 November 2026*

_Overview_
• 3 dari 5 tim wajib aktif lapor

_Per Area_
_Kota A_
• Budi Contoh — kirim barang (rs contoh, pkm contoh), update kas harian

_Kota B_
• Sari Fiktif — follow up tagihan (rs b), kirim SJ
lanjutan kalimat yang terputus baris
• Dodi Uji — input faktur

_Highlight_
• Pengiriman barang ke banyak faskes berjalan.
• Penawaran KSO sedang ditinjau.

_Perhatian_
• Belum report (1): Rina Contoh`;

const ST: StatsDaily = { anggota_aktif: 3, total_report: 40, matched: 38, unmatched: 2, wajib_total: 5 };
const DAFTAR: DaftarNama = { non_reporters: ["Rina Contoh Lengkap"], no_plan: ["Tono Fiktif"], on_leave: [] };

test("uraiRingkasan: area → orang (isi sesudah tanda —), baris lanjutan menempel, Highlight terpisah", () => {
  const r = uraiRingkasan(paksaDaftar(paksaOverview(LLM, ST), DAFTAR));
  assert.deepEqual(r.areas.map((a) => [a.area, a.orang.map((o) => o.nama)]), [["Kota A", ["Budi Contoh"]], ["Kota B", ["Sari Fiktif", "Dodi Uji"]]]);
  assert.equal(r.areas[0].orang[0].isi, "kirim barang (rs contoh, pkm contoh), update kas harian");
  assert.match(r.areas[1].orang[0].isi, /kirim SJ lanjutan kalimat yang terputus baris$/);
  assert.deepEqual(r.highlight, ["Pengiriman barang ke banyak faskes berjalan.", "Penawaran KSO sedang ditinjau."]);
});

test("uraiRingkasan: judul tebal (*Per Area*) juga dikenali; tanpa section Per Area = kosong, tak melempar", () => {
  const tebal = LLM.replace(/_Per Area_/, "*Per Area*").replace(/_Kota A_/, "*Kota A*");
  assert.equal(uraiRingkasan(tebal).areas[0].area, "Kota A");
  assert.deepEqual(uraiRingkasan("📊 *Daily Summary — Senin, 1 Desember 2026*\n\n*Overview*\n• 0 laporan"), { areas: [], highlight: [] });
});

test("formatWaRingkas: angka, nama pendek belum report/plan, satu highlight, tautan — tanpa kurung sudut", () => {
  const t = formatWaRingkas({
    hari: "Rabu", tanggal: "11 November 2026", stats: ST,
    pendek: { non_reporters: ["Rina"], no_plan: ["Tono"], on_leave: ["Ani (sakit)"] },
    highlight: "Pengiriman barang ke banyak faskes berjalan.", link: "https://os.contoh.id/ds/abc",
  });
  assert.equal(t, [
    "📊 *Daily Summary — Rabu, 11 November 2026*", "",
    "✅ 3/5 tim lapor · 40 laporan",
    "🎯 95% sesuai plan · 2 di luar plan", "",
    "⚠️ *Belum report (1)*", "Rina",
    "📝 *Belum plan (1)*", "Tono",
    "🌴 Ijin (1): Ani (sakit)", "",
    "💡 Pengiriman barang ke banyak faskes berjalan.", "",
    "🔗 Detail per area & per orang:", "https://os.contoh.id/ds/abc",
  ].join("\n"));
  assert.doesNotMatch(t, /[<>]/);
  const semua = formatWaRingkas({ hari: "Rabu", tanggal: "11 November 2026", stats: { ...ST, total_report: 0 },
    pendek: { non_reporters: [], no_plan: [], on_leave: [] }, highlight: null, link: "x" });
  assert.match(semua, /Semua yang wajib sudah plan & report/);
  assert.doesNotMatch(semua, /sesuai plan|💡/);
});

test("token: 22 huruf base64url, acak; tautan tanpa garis miring ganda", () => {
  const a = buatTokenDs(), b = buatTokenDs();
  assert.match(a, TOKEN_DS);
  assert.notEqual(a, b);
  assert.equal(tautanDs("https://os.contoh.id/", a), `https://os.contoh.id/ds/${a}`);
  assert.equal(TOKEN_DS.test("../../etc/passwd-xxxxx"), false);
});
