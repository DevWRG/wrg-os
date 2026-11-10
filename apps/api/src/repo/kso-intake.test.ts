import { test } from "node:test";
import assert from "node:assert/strict";
import { KSO_BANTUAN, KSO_FORMAT_ISIAN, formatBalasanGerbang, hurufJudul, namaDepan, sapa, teksAlatDariPdf, gerbangUntukAm, hargaBersih, kurangDraft, parseKsoPerintah, perkiraanZona, balasanFormatSalah, balasanSaranAlat, balasanVolumeTurun, pilihAlat, teksHasilAjukan, teksZonaForum, terjemahGalatKso, volumeDariTeks, type DraftTampil } from "./kso-intake.js";
import { bacaIsianFormat } from "./kso-format.js";
import { polaTerlarang } from "./kso-saring.js";
import { detectKind } from "./inbound.js";

test("parseKsoPerintah: rencana baru, lengkapi, kirim, kelonggaran, kalah, kosong", () => {
  assert.deepEqual(parseKsoPerintah("#KSO\nFaskes: RS A\nAlat: Z3"), { aksi: "baru", draftId: undefined, nomor: undefined, isi: "Faskes: RS A\nAlat: Z3" });
  const n = parseKsoPerintah("#KSO BUDI\n1. Faskes : RS A\n2. ALAT : Z3");
  assert.equal(n.aksi, "baru");
  assert.equal(n.nama, "BUDI");
  assert.equal(n.isi, "1. Faskes : RS A\n2. ALAT : Z3");
  assert.equal(parseKsoPerintah("#kso Faskes: RS A").aksi, "baru");
  const l = parseKsoPerintah("#KSO D12 tenor 36 bulan");
  assert.equal(l.aksi, "lengkapi");
  assert.equal(l.draftId, 12);
  assert.equal(l.isi, "tenor 36 bulan");
  const k = parseKsoPerintah("#KSO kirim D12");
  assert.equal(k.aksi, "kirim");
  assert.equal(k.draftId, 12);
  const g = parseKsoPerintah("#KSO minta kelonggaran KSO-2026-0012 RS minta 17.500");
  assert.equal(g.aksi, "kelonggaran");
  assert.equal(g.nomor, "KSO-2026-0012");
  assert.equal(g.isi, "RS minta 17.500");
  assert.equal(parseKsoPerintah("#KSO kalah d7: kalah harga dari Sysmex").aksi, "kalah");
  assert.equal(parseKsoPerintah("#KSO").aksi, "kosong");
  assert.equal(parseKsoPerintah("#KSO D12").aksi, "lengkapi"); // tanpa isi → PDF pasangannya / status draft
});

test("detectKind: '#KSO kirim D12' = kso, bukan #KIRIM pengiriman", () => {
  assert.equal(detectKind("#KSO kirim D12"), "kso");
  assert.equal(detectKind("#KIRIM SJ/123"), "kirim");
  assert.equal(detectKind("#KSO\nFaskes: RS A"), "kso");
});

const KATALOG = [
  { kode: "Z3", nama: "Z3" },
  { kode: "Z52", nama: "Z52" },
  { kode: "EXZ8000", nama: "EXZ8000" },
  { kode: "DNX6", nama: "Easy Diagnosis DN-X6 — Elektrolit" },
];

test("pilihAlat: kode utuh, tanpa salah tangkap, ambigu ditanyakan", () => {
  assert.deepEqual(pilihAlat("1 unit Z3 hematologi", KATALOG), { kind: "one", nilai: "Z3", nama: "Z3" });
  assert.equal(pilihAlat("EXZ 8000", KATALOG).kind, "one");
  assert.equal((pilihAlat("DN-X6", KATALOG) as { nilai: string }).nilai, "DNX6");
  assert.equal(pilihAlat("Z5", KATALOG).kind, "none"); // bukan Z52
  assert.equal(pilihAlat("Z3 atau Z52", KATALOG).kind, "ambiguous");
  assert.equal(pilihAlat("Sysmex XN-550", KATALOG).kind, "none");
});

function draft(o: Partial<DraftTampil> = {}): DraftTampil {
  // draft LENGKAP format 9 isian (angka & nama fiktif)
  return {
    id: 12, nomor: null, status: "DRAFT", faskes: "RS SWASTA A", cabang: "SBY 2", alat: "Z3", alat_kode: "Z3", jumlah: 1,
    volume_estimasi: 900, volume_sumber: "Lampiran Simulator KSO 2026-11-10", harga_per_test: 18500, harga_standar: null, kategori: "Hematologi",
    tenor_bulan: 36, unit_status: "baru", klausul: [], kolom_dinyatakan: ["fee_persen", "jumlah", "klausul", "klausul_ada", "kompetitor_alat", "tenor_bulan"],
    pendukung: [{ nama: "dr. Rina SpPK", tipe: "kepala_instalasi" }],
    gerbang: [1, 2, 3, 4, 5, 6, 7].map((no) => ({ no, nama: `G${no}`, status: "hijau", nilai: `nilai ${no}` })),
    kursi_hod: 2, zona_dasar: "am", gpm_deal: 0.748, fee_persen: 0, kompetitor_alat: "MEREKA-X100", harga_pesaing: 17000,
    klausul_ada: false, klausul_detail: null,
    lampiran: { id: 1, lolos: true, cocok: {}, galat: null, tanggal: "2026-11-10", wa_message_id: "W1", dibuat_at: null }, ...o,
  };
}

// ---- balasan WA ke AM: 7 gerbang + satu baris kurang, TANPA margin/HPP (keputusan product owner 10 Nov) ----

/** Penjaga: teks ke AM tak boleh memuat GPM berangka, persen, rupiah, biaya, HPP, CPRR, cicilan, markup, harga mandat. */
function tanpaAngkaMargin(t: string) {
  assert.deepEqual(polaTerlarang(t), [], `teks AM memuat angka margin/HPP:\n${t}`);
}

/** Angka fiktif yang TIDAK boleh bocor ke teks AM. */
const ANGKA = { gpm: 0.481, hd: false, catatan: "GPM 48,1% → zona Forum", biaya_per_tes: 4667,
  harga_am: 10370.4, harga_hod: 9333.3, harga_forum: 8484.8, volume_min_forum: 763.2 };
const merah = (no: number, status: string, nilai: string) => ({ no, nama: `G${no}`, status, nilai });

/** Teks lama yang tak boleh muncul lagi (jargon, huruf besar kaku). */
function tanpaJargon(t: string) {
  assert.doesNotMatch(t, /katalog KSO|Draft BELUM|isian lain sudah disimpan|BELUM dicatat|LABEL: ISI YANG BENAR|\d\/7 HIJAU|MERAH/, t);
}

test("formatBalasanGerbang: semua hijau → kepala tebal, 7 dari 7, tujuh ✅, ajakan kirim", () => {
  const t = formatBalasanGerbang(draft({ angka: ANGKA }));
  const baris = t.split("\n");
  assert.equal(baris[0], "*D12 · RS SWASTA A · Z3*");
  assert.equal(baris[1], "7 dari 7 gerbang hijau");
  assert.equal(baris[2], "");
  assert.equal(baris[3], "✅ GPM deal");
  assert.equal(baris[6], "✅ Coverage teknisi");
  assert.equal(baris[9], "✅ Klausul");
  assert.match(t, /Semua lengkap 👍 Balas \*#KSO kirim D12\* untuk mengajukan\./);
  assert.doesNotMatch(t, /Lengkapi ya/);
  tanpaAngkaMargin(t);
  tanpaJargon(t);
});

test("formatBalasanGerbang (305): PDF terbaca → 'Lampiran simulator diterima ✅' sesudah hitungan gerbang, tanpa angka", () => {
  const t = formatBalasanGerbang(draft({ angka: ANGKA }), { lampiranDiterima: true });
  const baris = t.split("\n");
  assert.equal(baris[0], "*D12 · RS SWASTA A · Z3*");
  assert.equal(baris[1], "7 dari 7 gerbang hijau");
  assert.equal(baris[2], "Lampiran simulator diterima ✅");
  assert.equal(baris[3], "");
  assert.doesNotMatch(t, /hapus|disimpan/i);
  assert.doesNotMatch(formatBalasanGerbang(draft({ angka: ANGKA })), /Lampiran simulator diterima/);
  tanpaAngkaMargin(t);
  tanpaJargon(t);
});

test("formatBalasanGerbang: nama faskes master terbalik ditampilkan terbaca di kepala", () => {
  assert.equal(formatBalasanGerbang(draft({ faskes: "CONTOH WETAN, RS PKU KAB. UJI" })).split("\n")[0], "*D12 · RS PKU CONTOH WETAN (KAB. UJI) · Z3*");
});

test("formatBalasanGerbang: campuran + belum = MERAH dengan alasan tanpa angka; baris Kurang + satu contoh", () => {
  const d = draft({
    angka: ANGKA, gpm_deal: 0.38, lampiran: null, pendukung: [], unit_status: null, zona_dasar: "direktur",
    gerbang: [merah(1, "merah", "GPM 38,6% → zona Direktur"), merah(2, "belum", "Belum ada bukti volume"),
      merah(3, "hijau", "Tidak ada unit idle sejenis"), merah(4, "belum", "Register teknisi hematologi belum ada di OS"),
      merah(5, "hijau", "Faskes baru — belum ada tagihan"), merah(6, "hijau", "36 bulan sejak serah terima"),
      merah(7, "hijau", "Tanpa klausul khusus")],
  });
  const t = formatBalasanGerbang(d);
  assert.equal(t.split("\n")[1], "4 dari 7 gerbang hijau");
  // hijau dulu, lalu merah — urutan gerbang tetap di tiap kelompok
  assert.match(t, /\n\n✅ Relokasi dulu\n✅ Piutang faskes\n✅ Tenor\n✅ Klausul\n❌ GPM deal\n❌ Volume terbukti — belum ada bukti\n❌ Coverage teknisi — belum ada data\n\n/);
  assert.match(t, /\nLengkapi ya:\n• PDF Simulator \(kirim di chat ini\)\n• Pendukung\n• Status unit\n• Alasan\nContoh: kirim PDF Simulator di chat ini dengan caption #KSO D12$/);
  tanpaJargon(t);
  assert.doesNotMatch(t, /38|48|Direktur|zona/i, "persen GPM / zona dari GPM tak boleh muncul");
  tanpaAngkaMargin(t);
});

test("formatBalasanGerbang: merah gerbang 2–7 diberi alasan pendek tanpa angka; klausul belum dijawab = gerbang 7 MERAH", () => {
  const d = draft({
    kolom_dinyatakan: ["fee_persen", "jumlah", "kompetitor_alat", "tenor_bulan"],
    gerbang: [merah(1, "hijau", "GPM 61,0% → zona AM"), merah(2, "merah", "Perkiraan lisan — tidak diterima sebagai bukti"),
      merah(3, "merah", "2 unit idle sejenis bisa direlokasi — pakai unit itu dulu"), merah(4, "merah", "Di luar coverage cabang"),
      merah(5, "merah", "120 hari · 3,5× tagihan bulanan"), merah(6, "merah", "72 bulan sejak serah terima"), merah(7, "hijau", "Tanpa klausul khusus")],
  });
  const t = formatBalasanGerbang(d);
  assert.match(t, /❌ Volume terbukti — perkiraan lisan tidak diterima/);
  assert.match(t, /❌ Relokasi dulu — ada unit idle sejenis\n/);
  assert.match(t, /❌ Coverage teknisi — di luar coverage cabang/);
  assert.match(t, /❌ Piutang faskes — melewati batas/);
  assert.match(t, /❌ Tenor — melebihi batas\n/);
  assert.match(t, /❌ Klausul — belum dijawab/);
  assert.doesNotMatch(t, /120|3,5|72|61/, "angka piutang/tenor/GPM tidak dibacakan");
  assert.equal(t.split("\n")[1], "1 dari 7 gerbang hijau");
  assert.equal(t.split("\n")[3], "✅ GPM deal");
  assert.match(t, /Lengkapi ya:\n• Klausul \(ADA \+ isinya, atau TIDAK\)\nContoh: #KSO D12 KLAUSUL: TIDAK/);
});

test("formatBalasanGerbang: gerbang belum dihitung = MERAH (belum ada data); Hemodialisa disebut tanpa angka", () => {
  const t = formatBalasanGerbang(draft({ gerbang: [merah(1, "belum", "Hemodialisa: Kalkulator HD — selalu Direktur")] }));
  assert.match(t, /❌ GPM deal — Hemodialisa, diputus Direktur/);
  assert.match(t, /❌ Volume terbukti — belum ada data/);
  assert.deepEqual(gerbangUntukAm(draft({ gerbang: [] })).map((g) => g.hijau), [false, false, false, false, false, false, false]);
});

test("formatBalasanGerbang: lampiran PDF tidak cocok → satu butir per bidang (PDF vs WA), contoh konkret, tanpa OCR mentah", () => {
  const lamp = (cocok: Record<string, { label: string; status: "beda" | "kosong" | "cocok"; pdf: string | null; wa: string | null; pdf_kode?: string | null }>) =>
    ({ id: 2, lolos: false, galat: null, tanggal: null, wa_message_id: "W2", dibuat_at: null, cocok });
  const t = formatBalasanGerbang(draft({ lampiran: lamp({ volume: { label: "Tes/bulan", status: "beda", pdf: "800", wa: "900" } }) }));
  assert.match(t, /Lengkapi ya:\n• PDF: tes\/bulan beda \(PDF "800" \/ WA "900"\)\nContoh: #KSO D12 TES: 700 \(kalau WA yang salah\), atau kirim ulang PDF Simulator dengan caption #KSO D12/);
  tanpaAngkaMargin(t);
  tanpaJargon(t);
  // butir lain dulu, PDF di akhir; contoh = isian kurang pertama
  const u = formatBalasanGerbang(draft({ pendukung: [], unit_status: null,
    lampiran: lamp({ sales: { label: "Nama sales", status: "beda", pdf: "Andl |", wa: "CONTOH" },
                     alat: { label: "Alat", status: "beda", pdf: "EXC200 =", wa: "Z3 (Z3)", pdf_kode: "EXC200" },
                     kompetitor: { label: "Kompetitor", status: "beda", pdf: "MEREKA 11:500 ##", wa: "MEREKA-X100" } }) }));
  assert.match(u, /Lengkapi ya:\n• Pendukung\n• Status unit\n• PDF: nama sales beda \(PDF "Andl" \/ WA "CONTOH"\)\n• PDF: alat beda \(PDF \*EXC200\* \/ WA \*Z3\*\)\n• PDF: kompetitor tidak sama dengan WA \("MEREKA-X100"\)\nContoh: #KSO D12 PENDUKUNG: /);
  assert.doesNotMatch(u, /EXC200 =|11:500|##/, "teks OCR mentah tak ditampilkan");
  // alat PDF tak menunjuk kode katalog → hanya kode WA
  const v = formatBalasanGerbang(draft({ lampiran: lamp({ alat: { label: "Alat", status: "beda", pdf: "?? 25O", wa: "Z3 (Z3)", pdf_kode: null } }) }));
  assert.match(v, /• PDF: alat tidak sama dengan WA \(\*Z3\*\)\nContoh: kirim ulang PDF Simulator dengan caption #KSO D12/);
  assert.doesNotMatch(v, /25O/);
});

test("formatBalasanGerbang: alat dari PDF Simulator = satu baris kode saja", () => {
  const t = formatBalasanGerbang(draft(), { alatPdf: teksAlatDariPdf({ kode: "EXC200" }, "D12") });
  assert.match(t, /\nAlat diambil dari PDF Simulator: \*EXC200\*\. Salah\? Balas #KSO D12 ALAT: KODE$/);
  assert.equal(teksAlatDariPdf({ kode: "EXZ6000" }, null), "Alat: *EXZ6000* (dari PDF Simulator)");
});

test("formatBalasanGerbang: '#KSO kirim' belum lengkap → 'Belum bisa diajukan' di baris Kurang", () => {
  const t = formatBalasanGerbang(draft({ tenor_bulan: null, fee_persen: null }), { belumBisaKirim: true });
  assert.match(t, /\nBelum bisa diajukan — lengkapi dulu ya:\n• Masa KSO \(bulan\)\n• Fee \(tulis 0 kalau tidak ada\)\nContoh: #KSO D12 MASA KSO: 36/);
  assert.doesNotMatch(t, /[<>]/, "WA membuang teks dalam kurung sudut");
});

test("formatBalasanGerbang: catatan & pendukung tanpa peran tetap disebut singkat", () => {
  const t = formatBalasanGerbang(draft(), { tanpaTipe: ["Bu Sari"], catatan: ['TES "banyak" tidak terbaca — angka tes per bulan tidak terbaca.'] });
  assert.match(t, /ℹ️ TES "banyak" tidak terbaca/);
  assert.match(t, /Peran Bu Sari belum jelas — tulis: #KSO D12 PENDUKUNG: Bu Sari, kepala instalasi lab/);
});

const AJU = { nomor: "KSO-2026-0012", zona: null, zona_dasar: null, alasan_forum: null, belum_hijau: [], gerbang2: "hijau" };

test("diajukan otomatis zona AM / 2 HOD / Forum: kata zona tanpa GPM & tanpa harga mandat", () => {
  const am = formatBalasanGerbang(draft({ angka: ANGKA }), { diajukan: teksHasilAjukan({ ...AJU, jalur: "AM", zona: "am" }) });
  assert.match(am, /\n✅ Sudah diajukan \(KSO-2026-0012\) → lolos tanpa forum, mandat terbit otomatis\./);
  assert.match(am, /#KSO kelonggaran KSO-2026-0012 ALASAN/);
  assert.doesNotMatch(am, /Lengkapi ya|#KSO kirim/);
  const hod = teksHasilAjukan({ ...AJU, jalur: "CEPAT", zona: "hod" });
  assert.equal(hod, "✅ Sudah diajukan (KSO-2026-0012) → diputus 2 HOD (maks. 1 hari kerja).");
  const forum = teksHasilAjukan({ ...AJU, jalur: "FORUM", zona: "forum", zona_dasar: "forum" });
  assert.equal(forum, "✅ Sudah diajukan (KSO-2026-0012) → masuk agenda Forum berikutnya (Selasa/Kamis).");
  const tunggu = teksHasilAjukan({ ...AJU, jalur: "FORUM", zona: "direktur", zona_dasar: "forum", belum_hijau: [2], gerbang2: "belum" });
  assert.match(tunggu, /Forum berikutnya[\s\S]*Sekretaris memverifikasi bukti volume/);
  for (const t of [am, hod, forum, tunggu]) { tanpaAngkaMargin(t); tanpaJargon(t); }
});

test("terjemahGalatKso ALASAN_STRATEGIS_WAJIB & kurang alasan: tanpa sebut GPM", () => {
  const t = terjemahGalatKso("ALASAN_STRATEGIS_WAJIB", "D12");
  assert.doesNotMatch(t, /GPM|Forum|Direktur/);
  assert.match(t, /#KSO D12 ALASAN: ISI ALASAN/);
  const q = kurangDraft(draft({ zona_dasar: "direktur" }));
  assert.equal(q[0].teks, "ALASAN strategis — diperlukan untuk usulan ini");
  tanpaAngkaMargin(q.map((x) => x.teks).join("\n"));
});

test("hargaBersih: harga × (1 − fee)", () => {
  assert.equal(hargaBersih(11800, 5), 11210);
  assert.equal(hargaBersih(11800, null), 11800);
});

test("kurangDraft: KLAUSUL ADA tanpa detail, pendukung & status unit, lampiran tidak cocok, alasan zona Direktur", () => {
  const q = (o: Partial<DraftTampil>) => kurangDraft(draft(o)).map((x) => x.kunci);
  assert.deepEqual(q({}), []);
  assert.deepEqual(q({ klausul_ada: true, kolom_dinyatakan: ["fee_persen", "kompetitor_alat"] }), ["klausul"]);
  assert.match(kurangDraft(draft({ klausul_ada: true, kolom_dinyatakan: ["fee_persen", "kompetitor_alat"] }))[0].teks, /Detail KLAUSUL/);
  assert.deepEqual(q({ pendukung: [], unit_status: null }), ["pendukung", "status_unit"]);
  const l = kurangDraft(draft({ lampiran: { id: 2, lolos: false, galat: null, tanggal: null, wa_message_id: "W2", dibuat_at: null,
    cocok: { volume: { label: "Tes/bulan", status: "beda", pdf: "800", wa: "900" } } } }));
  assert.equal(l.length, 1);
  assert.match(l[0].teks, /PDF belum cocok: Tes\/bulan: PDF "800" ≠ WA "900"/);
  assert.deepEqual(q({ zona_dasar: "direktur" }), ["alasan"]);
  assert.deepEqual(q({ zona_dasar: "direktur", alasan_strategis: "Referensi wilayah" }), []);
  assert.deepEqual(q({ zona_dasar: "direktur", angka: { ...ANGKA, gpm: null, hd: true } }), []);
});

test("perkiraanZona: cermin kso.ajukan — eskalasi satu level, data GPM kosong = forum", () => {
  const g = (merah?: number) => [1, 2, 3, 4, 5, 6, 7].map((no) => ({ no, nama: "", status: no === merah ? "merah" : "hijau", nilai: null }));
  const dasar = { gerbang: g(), kursi_hod: 2, kolom_dinyatakan: ["klausul"] };
  assert.equal(perkiraanZona({ ...dasar, zona_dasar: "am" }), "am");
  assert.equal(perkiraanZona({ ...dasar, zona_dasar: "am", gerbang: g(5) }), "hod");
  assert.equal(perkiraanZona({ ...dasar, zona_dasar: "am", gerbang: g(1) }), "am", "gerbang 1 = GPM itu sendiri, tidak dihitung dua kali");
  assert.equal(perkiraanZona({ ...dasar, zona_dasar: "forum", gerbang: g(2) }), "direktur");
  assert.equal(perkiraanZona({ ...dasar, zona_dasar: "direktur", gerbang: g(2) }), "direktur");
  assert.equal(perkiraanZona({ ...dasar, zona_dasar: null }), "forum");
  assert.equal(perkiraanZona({ ...dasar, zona_dasar: "hod", kursi_hod: 1 }), "forum");
});

test("terjemahGalatKso: tak pernah menampilkan kode galat", () => {
  for (const m of ["SUMBER_VOLUME_KOSONG", "KOLOM_WAJIB_KOSONG: tenor_bulan, klausul", "BUKAN_MILIK_PENGIRIM: rencana 1 bukan milik AM-3",
    "DRAFT_TERKUNCI: status DIAJUKAN", "BUKAN_TAHAP_NEGOSIASI", "ALASAN_STRATEGIS_WAJIB", "galat lain"]) {
    const t = terjemahGalatKso(m, "D12");
    assert.doesNotMatch(t, /[A-Z]{3,}_[A-Z_]+/, t);
    assert.doesNotMatch(t, /[<>]/, t);
  }
  assert.match(terjemahGalatKso("KOLOM_WAJIB_KOSONG: tenor_bulan", "D12"), /MASA KSO/);
  assert.match(terjemahGalatKso("BUKAN_MILIK_PENGIRIM: x", "D1"), /bukan atas nama Anda/);
});

test("jumlah tak disebut = 1 unit, tidak ditanyakan", () => {
  const d = draft({ kolom_dinyatakan: ["fee_persen", "klausul", "kompetitor_alat", "tenor_bulan"] });
  assert.ok(!kurangDraft(d).some((q) => q.kunci === "jumlah"));
});

test("bantuan #KSO = format dua belas isian berlabel, tanpa KOTA, tanpa kurung sudut", () => {
  for (const n of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) assert.match(KSO_BANTUAN, new RegExp(`\\n${n}\\. `));
  for (const l of ["FASKES", "ALAT", "TES", "MASA KSO", "PERMINTAAN HARGA", "FEE", "KOMPETITOR", "KLAUSUL", "LAMPIRAN",
    "10. STATUS UNIT : BARU / RELOKASI IDLE / EKS KSO / EKS DEMO / REFURBISH / PINJAMAN PRINCIPAL",
    "11. BUKTI VOLUME : REKAP LIS 6 BULAN / PEMBELIAN REAGEN / SURAT RS",
    "12. PENDUKUNG : dr. NAMA, JABATAN (mis. kepala instalasi lab)",
    "ALASAN : … hanya bila diminta bot", "JUMLAH : 2 bila lebih dari 1 unit", "HARI KERJA : 26 bila beda dari default"])
    assert.ok(KSO_BANTUAN.includes(l), l);
  assert.ok(KSO_BANTUAN.includes(KSO_FORMAT_ISIAN));
  assert.doesNotMatch(KSO_BANTUAN, /KOTA/);
  assert.match(KSO_BANTUAN, /Voice note tidak diproses/);
  assert.doesNotMatch(KSO_BANTUAN, /[<>]/);
  // contoh di bantuan bisa diurai pengurai format itu sendiri; isian 10–12 (templat apa adanya) TIDAK dipilihkan
  const x = bacaIsianFormat(KSO_FORMAT_ISIAN.split("\n").slice(1).join("\n"));
  assert.equal(x.volume, 700);
  assert.equal(x.harga, 11800);
  assert.equal(x.fee, 5);
  assert.equal(x.tenor, 36);
  assert.equal(x.status_unit, undefined);
  assert.equal(x.sumber, undefined);
  assert.deepEqual(x.pendukung, []);
  assert.deepEqual(x.tidakTerbaca.map((t) => t.label), ["status_unit", "sumber", "pendukung"]);
  assert.deepEqual(x.barisAsing.map((b) => b.slice(0, 3)), ["(10"], "baris catatan tambahan bukan label");
});

test("teks bebas → balasan format; saran alat bernomor + cara memilih", () => {
  const f = balasanFormatSalah(bacaIsianFormat("RS A mau KSO Z3 900 tes"));
  assert.match(f, /^Format #KSO-nya belum pas \(FASKES dan ALAT wajib ada\) — usulan belum dicatat\. Pakai format ini ya:[\s\S]*#KSO BUDI/);
  tanpaJargon(f);
  const s = balasanSaranAlat("BUDI SANTOSO", "MEREKC BC-5150", { kind: "saran", ambigu: false, saran: [
    { kode: "Z50", nama: "Zybio Z50", kategori: "Hematologi", skor: 10 }, { kode: "Z3", nama: "Z3", kategori: "Hematologi", skor: 10 }] }, null, ["Z3", "Z50"]);
  assert.equal(s, 'Hai Budi 👋\nAlat "MEREKC BC-5150" belum ketemu pasti.\nMungkin maksudnya:\n1. *Z50* — Zybio Z50 (Hematologi)\n2. *Z3* — Z3 (Hematologi)\n' +
    "Balas *#KSO ALAT 1* (atau 2), atau *#KSO ALAT: KODE*.");
  tanpaJargon(s);
  tanpaAngkaMargin(s);
  const k = balasanSaranAlat("Budi", "X", { kind: "saran", ambigu: false, saran: [] }, "D9", ["Z3"]);
  assert.equal(k, 'Alat "X" untuk D9 belum ketemu pasti — alat D9 belum diubah.\nBelum ada yang mirip. Kode yang tersedia: Z3.\nBalas *#KSO D9 ALAT: KODE*.');
});

test("perintah yang disalin dari balasan bertanda tebal WhatsApp tetap terbaca", () => {
  assert.deepEqual(parseKsoPerintah("*#KSO YA*"), { aksi: "konfirmasi", isi: "", jawab: "ya" });
  assert.equal(parseKsoPerintah("*#KSO TIDAK*").jawab, "tidak");
  assert.equal(parseKsoPerintah("*#KSO ALAT 1*").isi, "ALAT 1");
  assert.equal(bacaIsianFormat(parseKsoPerintah("*#KSO ALAT: Z3*").isi).alat, "Z3");
  assert.equal(parseKsoPerintah("*#KSO kirim D12*").aksi, "kirim");
  assert.equal(detectKind("*#KSO YA*"), "kso");
});

test("sapaan: nama depan huruf judul; cabang huruf judul", () => {
  assert.equal(namaDepan("SARI CONTOH"), "Sari");
  assert.equal(namaDepan("Pak budi"), "Budi");
  assert.equal(sapa(""), "Hai 👋");
  assert.equal(hurufJudul("KOTA SATU"), "Kota Satu");
  assert.equal(hurufJudul("SBY 2"), "SBY 2");
});

test("teksZonaForum: zona Forum yang naik hanya karena bukti volume belum diperiksa → ZONA FORUM + catatan", () => {
  const dasar = { zona: "direktur", zona_dasar: "forum", alasan_forum: null, belum_hijau: [2], gerbang2: "belum" };
  const a = teksZonaForum(dasar);
  assert.equal(a.label, "ZONA FORUM");
  assert.match(a.catatan ?? "", /Zona Direktur sampai Sekretaris memverifikasi bukti volume/);
  // gerbang lain juga tak hijau → verifikasi saja tak menurunkan zona → tetap Direktur
  assert.deepEqual(teksZonaForum({ ...dasar, belum_hijau: [2, 4] }), { label: "ZONA DIREKTUR", catatan: null });
  // bukti ditolak (merah) → Direktur
  assert.deepEqual(teksZonaForum({ ...dasar, gerbang2: "merah" }), { label: "ZONA DIREKTUR", catatan: null });
  // aturan grup memaksa forum → bukan soal bukti
  assert.equal(teksZonaForum({ ...dasar, alasan_forum: "Grup X belum diketahui" }).label, "ZONA DIREKTUR");
  // GPM di bawah 45% → Direktur murni
  assert.equal(teksZonaForum({ ...dasar, zona_dasar: "direktur", belum_hijau: [] }).label, "ZONA DIREKTUR");
  // sudah Forum (bukti disahkan) → Forum tanpa catatan
  assert.deepEqual(teksZonaForum({ zona: "forum", zona_dasar: "forum", alasan_forum: null, belum_hijau: [], gerbang2: "hijau" }), { label: "ZONA FORUM", catatan: null });
});

test("volumeDariTeks: angka sesudah kata volume, titik = ribuan; tanpa kata volume = null", () => {
  assert.equal(volumeDariTeks("volume 900"), 900);
  assert.equal(volumeDariTeks("RS bilang volume turun jadi 1.100 tes/bln"), 1100);
  assert.equal(volumeDariTeks("Volume: 2.400"), 2400);
  assert.equal(volumeDariTeks("tenor 36 bulan"), null);
  assert.equal(volumeDariTeks("volume belum pasti"), null);
});

test("balasanVolumeTurun: toleransi, dihitung ulang, ditarik ke forum — tanpa harga mandat & tanpa GPM", () => {
  const tol = balasanVolumeTurun("D12", { hasil: "toleransi", volume_dasar: 900, volume_batas: 720, volume_baru: 800 });
  assert.match(tol, /volume 800 tes\/bln masih dalam toleransi \(batas 720 tes\/bln\)\. Mandat tetap\./);
  const ulang = balasanVolumeTurun("D12", { hasil: "dihitung_ulang", volume_dasar: 900, volume_baru: 600, pembuka: 18500, target: 11000, lantai: 10000,
    volume_minimum: 480, berlaku_sampai: "2026-12-05" });
  assert.match(ulang, /turun dari 900 ke 600 tes\/bln \(melewati batas toleransi\) — mandat dihitung ulang, berlaku s\/d 2026-12-05\./);
  assert.match(ulang, /diterbitkan Sekretariat\/Admin Sales/);
  assert.doesNotMatch(ulang, /18\.500|11\.000|10\.000|pembuka|batas bawah/);
  const forum = balasanVolumeTurun("D12", { hasil: "ke_forum", volume_dasar: 900, volume_baru: 300, zona: "direktur", tanpa_angka: false });
  assert.match(forum, /usulan perlu diputus ulang\. Mandat lama gugur; usulan masuk agenda forum berikutnya/);
  const tanpa = balasanVolumeTurun("D12", { hasil: "ke_forum", volume_dasar: 900, volume_baru: 300, zona: "forum", tanpa_angka: true });
  assert.match(tanpa, /mandat tak bisa dihitung ulang otomatis/);
  for (const t of [tol, ulang, forum, tanpa]) { tanpaAngkaMargin(t); assert.doesNotMatch(t, /GPM/); }
});
