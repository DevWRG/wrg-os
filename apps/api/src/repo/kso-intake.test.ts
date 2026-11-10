import { test } from "node:test";
import assert from "node:assert/strict";
import { KSO_BANTUAN, KSO_FORMAT_ISIAN, formatBalasanGerbang, gerbangUntukAm, hargaBersih, kurangDraft, parseKsoPerintah, perkiraanZona, balasanFormatSalah, balasanSaranAlat, balasanVolumeTurun, pilihAlat, teksHasilAjukan, teksZonaForum, terjemahGalatKso, volumeDariTeks, type DraftTampil } from "./kso-intake.js";
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

test("formatBalasanGerbang: semua hijau → header 7/7, tujuh baris HIJAU, ajakan kirim", () => {
  const t = formatBalasanGerbang(draft({ angka: ANGKA }));
  const baris = t.split("\n");
  assert.equal(baris[0], "D12 · RS SWASTA A · Z3 · 7/7 HIJAU");
  assert.equal(baris[1], "");
  assert.equal(baris[2], "1. GPM deal              ✅ HIJAU");
  assert.equal(baris[5], "4. Coverage + teknisi    ✅ HIJAU");
  assert.equal(baris[8], "7. Klausul standar       ✅ HIJAU");
  assert.match(t, /Lengkap — balas "#KSO kirim D12" untuk mengajukan\./);
  assert.doesNotMatch(t, /Kurang:/);
  tanpaAngkaMargin(t);
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
  assert.equal(t.split("\n")[0], "D12 · RS SWASTA A · Z3 · 4/7 HIJAU");
  assert.match(t, /1\. GPM deal {14}❌ MERAH\n/);
  assert.match(t, /2\. Volume terbukti {7}❌ MERAH \(belum ada bukti\)/);
  assert.match(t, /3\. Relokasi dulu {9}✅ HIJAU/);
  assert.match(t, /4\. Coverage \+ teknisi {4}❌ MERAH \(belum ada data\)/);
  assert.match(t, /\nKurang: lampiran PDF, pendukung, status unit, alasan\n\(contoh: kirim PDF Simulator di chat ini dengan caption #KSO D12\)/);
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
  assert.match(t, /\(perkiraan lisan tidak diterima\)/);
  assert.match(t, /\(ada unit idle sejenis — relokasi dulu\)/);
  assert.match(t, /\(di luar coverage cabang\)/);
  assert.match(t, /\(piutang faskes melewati batas\)/);
  assert.match(t, /\(melebihi batas tenor\)/);
  assert.match(t, /7\. Klausul standar {7}❌ MERAH \(belum dijawab\)/);
  assert.doesNotMatch(t, /120|3,5|72|61/, "angka piutang/tenor/GPM tidak dibacakan");
  assert.equal(t.split("\n")[0], "D12 · RS SWASTA A · Z3 · 1/7 HIJAU");
  assert.match(t, /Kurang: klausul\n\(contoh: #KSO D12 KLAUSUL: TIDAK\)/);
});

test("formatBalasanGerbang: gerbang belum dihitung = MERAH (belum ada data); Hemodialisa disebut tanpa angka", () => {
  const t = formatBalasanGerbang(draft({ gerbang: [merah(1, "belum", "Hemodialisa: Kalkulator HD — selalu Direktur")] }));
  assert.match(t, /1\. GPM deal {14}❌ MERAH \(Hemodialisa — diputus Direktur\)/);
  assert.match(t, /2\. Volume terbukti {7}❌ MERAH \(belum ada data\)/);
  assert.deepEqual(gerbangUntukAm(draft({ gerbang: [] })).map((g) => g.hijau), [false, false, false, false, false, false, false]);
});

test("formatBalasanGerbang: lampiran PDF tidak cocok → field yang beda disebut (bukan angka biaya)", () => {
  const t = formatBalasanGerbang(draft({ lampiran: { id: 2, lolos: false, galat: null, tanggal: null, wa_message_id: "W2", dibuat_at: null,
    cocok: { volume: { label: "Tes/bulan", status: "beda", pdf: "800", wa: "900" } } } }));
  assert.match(t, /Kurang: lampiran PDF belum cocok\nPDF belum cocok: Tes\/bulan: PDF "800" ≠ WA "900"\n\(contoh: #KSO D12 LABEL: ISI YANG BENAR, atau kirim ulang PDF\)/);
  tanpaAngkaMargin(t);
});

test("formatBalasanGerbang: '#KSO kirim' belum lengkap → 'Belum bisa diajukan' di baris Kurang", () => {
  const t = formatBalasanGerbang(draft({ tenor_bulan: null, fee_persen: null }), { belumBisaKirim: true });
  assert.match(t, /\nBelum bisa diajukan\. Kurang: masa KSO, fee\n\(contoh: #KSO D12 MASA KSO: 36\)/);
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
  assert.match(am, /\nKSO-2026-0012 diajukan → ZONA AM: lolos tanpa forum, mandat terbit otomatis; penawaran diterbitkan Sekretariat\/Admin Sales\./);
  assert.match(am, /#KSO kelonggaran KSO-2026-0012 ALASAN/);
  assert.doesNotMatch(am, /Kurang:|#KSO kirim/);
  const hod = teksHasilAjukan({ ...AJU, jalur: "CEPAT", zona: "hod" });
  assert.equal(hod, "KSO-2026-0012 diajukan → ZONA 2 HOD: dua HOD memutus maksimal 1 hari kerja.");
  const forum = teksHasilAjukan({ ...AJU, jalur: "FORUM", zona: "forum", zona_dasar: "forum" });
  assert.match(forum, /→ ZONA FORUM: masuk agenda forum Selasa\/Kamis berikutnya \(batas data 14\.00\), Direktur memutus\./);
  for (const t of [am, hod, forum]) tanpaAngkaMargin(t);
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
  assert.match(balasanFormatSalah(bacaIsianFormat("RS A mau KSO Z3 900 tes")), /FASKES dan ALAT wajib ada[\s\S]*#KSO BUDI/);
  const s = balasanSaranAlat("Budi", "MINDRAY BC-5150", { kind: "saran", ambigu: false, saran: [
    { kode: "Z50", nama: "Zybio Z50", kategori: "Hematologi", skor: 10 }, { kode: "Z3", nama: "Z3", kategori: "Hematologi", skor: 10 }] }, null, ["Z3", "Z50"]);
  assert.match(s, /Draft BELUM dibuat — isian lain sudah disimpan/);
  assert.match(s, /1\. Z50 — Zybio Z50 \(Hematologi\)\n2\. Z3 — Z3 \(Hematologi\)/);
  assert.match(s, /Balas: #KSO ALAT 1 \(atau 1\/2\), atau #KSO ALAT: KODE — berlaku 24 jam/);
  assert.match(balasanSaranAlat("Budi", "X", { kind: "saran", ambigu: false, saran: [] }, "D9", ["Z3"]), /Pilihan katalog: Z3[\s\S]*#KSO D9 ALAT: KODE/);
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
