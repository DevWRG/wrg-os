import { test } from "node:test";
import assert from "node:assert/strict";
import { KSO_BANTUAN, blokGpm, formatBalasanDraft, hargaBersih, kurangDraft, parseKsoPerintah, perkiraanZona, balasanFormatSalah, balasanSaranAlat, balasanVolumeTurun, pilihAlat, teksZonaForum, terjemahGalatKso, volumeDariTeks, type DraftTampil } from "./kso-intake.js";
import { bacaIsianFormat } from "./kso-format.js";
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
    volume_estimasi: 900, volume_sumber: "Lampiran Simulator CPRR 2026-11-10", harga_per_test: 18500, harga_standar: null, kategori: "Hematologi",
    tenor_bulan: 36, unit_status: "baru", klausul: [], kolom_dinyatakan: ["fee_persen", "jumlah", "klausul", "klausul_ada", "kompetitor_alat", "tenor_bulan"],
    pendukung: [{ nama: "dr. Rina SpPK", tipe: "kepala_instalasi" }],
    gerbang: [1, 2, 3, 4, 5, 6, 7].map((no) => ({ no, nama: `G${no}`, status: "hijau", nilai: `nilai ${no}` })),
    kursi_hod: 2, zona_dasar: "am", gpm_deal: 0.748, fee_persen: 0, kompetitor_alat: "MEREKA-X100", harga_pesaing: 17000,
    klausul_ada: false, klausul_detail: null,
    lampiran: { id: 1, lolos: true, cocok: {}, galat: null, tanggal: "2026-11-10", wa_message_id: "W1", dibuat_at: null }, ...o,
  };
}

test("formatBalasanDraft: urutan bagian tetap; lengkap → ajakan kirim", () => {
  const t = formatBalasanDraft(draft(), { baru: true, nama: "Budi" });
  const iDraft = t.indexOf("Draft D12 dibuat");
  const iSistem = t.indexOf("Dari sistem");
  const iGerbang = t.indexOf("Gerbang: 7 dari 7 hijau → ZONA AM");
  const iKirim = t.indexOf('Balas "#KSO kirim D12"');
  assert.ok(iDraft === 0 && iDraft < iSistem && iSistem < iGerbang && iGerbang < iKirim, t);
  assert.match(t, /Sumber volume: "Lampiran Simulator CPRR 2026-11-10"/);
  assert.match(t, /· Lampiran: ✅ PDF Simulator cocok \(2026-11-10\)/);
  assert.match(t, /· GPM deal: nilai 1\n· Relokasi: nilai 3\n· Piutang faskes: nilai 5/);
  assert.doesNotMatch(t, /Belum lengkap/);
});

test("formatBalasanDraft: diajukan otomatis → teks hasil zona, tanpa daftar kurang", () => {
  const t = formatBalasanDraft(draft(), { baru: true, nama: "Budi", diajukan: "KSO-2026-0012 diajukan, Budi.\n→ ZONA AM: lolos tanpa forum" });
  assert.match(t, /Lengkap ✅ — diajukan otomatis\.\nKSO-2026-0012 diajukan/);
  assert.doesNotMatch(t, /#KSO kirim/);
});

test("formatBalasanDraft: fee dibacakan dengan harga bersih; alat fuzzy dibacakan asalnya", () => {
  const t = formatBalasanDraft(draft({ fee_persen: 5, harga_per_test: 11800 }), { baru: true, nama: "Budi", alatTeks: "HEMATOLOGY ZYBIO Z 3" });
  assert.match(t, /· Fee: 5% → harga bersih Rp\s?11\.210\/test \(dasar GPM\)/);
  assert.match(t, /· Alat: 1 × Z3 \(dari "HEMATOLOGY ZYBIO Z 3" → Z3, Hematologi\)/);
  assert.match(formatBalasanDraft(draft(), { baru: true, nama: "Budi" }), /· Fee: tidak ada/);
  assert.equal(hargaBersih(11800, 5), 11210);
  assert.equal(hargaBersih(11800, null), 11800);
});

test("formatBalasanDraft: hari kerja — disebut AM dibacakan, kosong = default + cara koreksi (282)", () => {
  assert.match(formatBalasanDraft(draft({ hari_kerja: 30, hari_kerja_default: 25 }), { baru: false, nama: "Budi" }), /· Hari kerja alat: 30 hari\/bulan\n/);
  const t = formatBalasanDraft(draft({ hari_kerja: null, hari_kerja_default: 25 }), { baru: false, nama: "Budi" });
  assert.match(t, /· Hari kerja alat: 25 hari\/bulan \(default — koreksi: #KSO D12 HARI KERJA: 26\)/);
});

test("Belum lengkap: daftar berlabel + contoh jawaban siap salin; tanpa ajakan kirim", () => {
  const t = formatBalasanDraft(draft({ tenor_bulan: null, fee_persen: null, lampiran: null, kolom_dinyatakan: ["jumlah", "klausul"] }), { baru: true, nama: "Budi" });
  assert.match(t, /Belum lengkap \(4\):\n1\. MASA KSO/);
  assert.match(t, /FEE ke RS\/perantara/);
  assert.match(t, /KOMPETITOR/);
  assert.match(t, /LAMPIRAN — PDF Simulator KSO/);
  assert.match(t, /#KSO D12 MASA KSO: 36\n#KSO D12 FEE: 5%/);
  assert.match(t, /· Lampiran: belum ada PDF/);
  assert.doesNotMatch(t, /Masa KSO: /);
  assert.doesNotMatch(t, /#KSO kirim/);
  assert.doesNotMatch(t, /[<>]/, "WA membuang teks dalam kurung sudut");
});

test("klausul belum dijawab: gerbang 7 tidak ditampilkan hijau dan zona naik satu level", () => {
  const t = formatBalasanDraft(draft({ kolom_dinyatakan: ["jumlah", "tenor_bulan", "fee_persen", "kompetitor_alat"] }), { baru: true, nama: "Budi" });
  assert.match(t, /ZONA 2 HOD/);
  assert.match(t, /❔ 7\. G7: belum dijawab/);
  assert.match(t, /KLAUSUL — ADA \(sebut isinya\) atau TIDAK/);
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
  assert.deepEqual(q({ zona_dasar: "direktur", angka: { gpm: null, hd: true, catatan: null, biaya_per_tes: null, harga_am: null, harga_hod: null, harga_forum: null, volume_min_forum: null } }), []);
});

test("pendukung tanpa peran → ditanyakan dengan contoh label", () => {
  const t = formatBalasanDraft(draft(), { baru: false, nama: "Budi", tanpaTipe: ["Bu Sari"] });
  assert.match(t, /Peran Bu Sari belum jelas — tulis: #KSO D12 PENDUKUNG: Bu Sari, kepala instalasi lab/);
});

test("SBY 1 (tanpa HOD Area) di zona HOD → info forum; di zona AM tak butuh HOD", () => {
  const t = formatBalasanDraft(draft({ kursi_hod: 1, zona_dasar: "hod" }), { baru: false, nama: "Budi" });
  assert.match(t, /ZONA FORUM/);
  assert.match(t, /tanpa HOD Area/);
  const a = formatBalasanDraft(draft({ kursi_hod: 1 }), { baru: false, nama: "Budi" });
  assert.match(a, /ZONA AM/);
  assert.doesNotMatch(a, /tanpa HOD Area/);
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

// ---- blok GPM (angka fiktif) ----
const ANGKA = { gpm: 0.481, hd: false, catatan: "GPM 48,1% → zona Forum", biaya_per_tes: 4667,
  harga_am: 10370.4, harga_hod: 9333.3, harga_forum: 8484.8, volume_min_forum: 763.2 };

test("blokGpm: GPM, harga minimum per zona di volume AM, volume minimum zona Forum di harga AM", () => {
  const t = blokGpm({ angka: ANGKA, volume_estimasi: 900, harga_per_test: 9000 }).join("\n");
  assert.match(t, /GPM deal 48,1% \(biaya Rp\s?4\.667\/tes termasuk cicilan alat\)\n/);
  assert.match(t, /Harga minimum di 900 tes\/bln: AM Rp\s?10\.400 · 2 HOD Rp\s?9\.400 · Forum Rp\s?8\.500/);
  assert.match(t, /Volume minimum zona Forum di Rp\s?9\.000: 764 tes\/bln/);
});

test("blokGpm: dengan fee → GPM dari harga bersih, harga minimum = harga diminta termasuk fee", () => {
  const t = blokGpm({ angka: ANGKA, volume_estimasi: 900, harga_per_test: 9000, fee_persen: 5 }).join("\n");
  assert.match(t, /dihitung dari harga bersih sesudah fee 5%/);
  assert.match(t, /Harga minimum di 900 tes\/bln \(harga diminta, sudah termasuk fee 5%\): AM/);
});

test("blokGpm: volume minimum > 10× volume usulan ditulis tidak realistis, bukan angka puluhan ribu", () => {
  const t = blokGpm({ angka: { ...ANGKA, volume_min_forum: 75139 }, volume_estimasi: 900, harga_per_test: 6900 }).join("\n");
  assert.match(t, /baru tercapai di atas 10× volume usulan — tidak realistis/);
  assert.doesNotMatch(t, /75139|75\.139/);
  assert.match(blokGpm({ angka: { ...ANGKA, volume_min_forum: 9000 }, volume_estimasi: 900, harga_per_test: 9000 }).join(""), /9000 tes\/bln/);
});

test("blokGpm: zona Forum tak tercapai, Hemodialisa, data belum lengkap", () => {
  assert.match(blokGpm({ angka: { ...ANGKA, volume_min_forum: null }, volume_estimasi: 900, harga_per_test: 3000 }).join(""), /tidak tercapai/);
  assert.match(blokGpm({ angka: { ...ANGKA, hd: true }, volume_estimasi: 60, harga_per_test: 400000 }).join(""), /Kalkulator HD/);
  assert.match(blokGpm({ angka: { ...ANGKA, gpm: null, catatan: "HPP alat belum ada" }, volume_estimasi: 900, harga_per_test: 9000 }).join(""),
    /belum bisa: HPP alat belum ada/);
  assert.deepEqual(blokGpm({ angka: null, volume_estimasi: 900, harga_per_test: 9000 }), []);
});

test("jumlah tak disebut = 1 unit, ditampilkan & tidak ditanyakan", () => {
  const d = draft({ kolom_dinyatakan: ["fee_persen", "klausul", "kompetitor_alat", "tenor_bulan"] });
  assert.match(formatBalasanDraft(d, { baru: true, nama: "Budi" }), /Alat: 1 × Z3 — dianggap 1 unit \(koreksi: #KSO D12 JUMLAH: 2\)/);
  assert.ok(!kurangDraft(d).some((q) => q.kunci === "jumlah"));
});

test("ringkasan memuat kompetitor, alasan strategis, dan blok GPM sebelum gerbang", () => {
  const t = formatBalasanDraft(draft({ alasan_strategis: "Referensi wilayah", angka: ANGKA }), { baru: true, nama: "Budi" });
  assert.match(t, /· Kompetitor: MEREKA-X100 \(Rp\s?17\.000\/test\)/);
  assert.match(t, /Alasan strategis: Referensi wilayah/);
  assert.ok(t.indexOf("GPM deal") < t.indexOf("Gerbang:"));
});

test("bantuan #KSO = format sembilan isian berlabel, tanpa kurung sudut", () => {
  for (const n of [1, 2, 3, 4, 5, 6, 7, 8, 9]) assert.match(KSO_BANTUAN, new RegExp(`\\n${n}\\. `));
  for (const l of ["FASKES", "ALAT", "TES", "MASA KSO", "PERMINTAAN HARGA", "FEE", "KOMPETITOR", "KLAUSUL", "LAMPIRAN", "PENDUKUNG:", "STATUS UNIT:"])
    assert.ok(KSO_BANTUAN.includes(l), l);
  assert.match(KSO_BANTUAN, /relokasi idle/);
  assert.match(KSO_BANTUAN, /Voice note tidak diproses/);
  assert.doesNotMatch(KSO_BANTUAN, /[<>]/);
  // contoh di bantuan bisa diurai pengurai format itu sendiri
  const x = bacaIsianFormat(KSO_BANTUAN.split("\n").slice(2, 11).join("\n"));
  assert.equal(x.volume, 700);
  assert.equal(x.harga, 11800);
  assert.equal(x.fee, 5);
  assert.equal(x.tenor, 36);
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

test("balasanVolumeTurun: toleransi, dihitung ulang (tiga harga), ditarik ke forum", () => {
  assert.match(balasanVolumeTurun("D12", { hasil: "toleransi", volume_dasar: 900, volume_batas: 720, volume_baru: 800 }),
    /volume 800 tes\/bln masih dalam toleransi \(≥ 720, 80% dari 900\)\. Mandat tetap\./);
  const ulang = balasanVolumeTurun("D12", { hasil: "dihitung_ulang", volume_dasar: 900, volume_baru: 600, pembuka: 18500, target: 11000, lantai: 10000,
    volume_minimum: 480, berlaku_sampai: "2026-12-05" });
  assert.match(ulang, /turun dari 900 ke 600 tes\/bln \(> 20%\) — mandat dihitung ulang/);
  assert.match(ulang, /harga pembuka Rp\s?18\.500, target Rp\s?11\.000, batas bawah Rp\s?10\.000\/test, volume minimum 480/);
  assert.match(balasanVolumeTurun("D12", { hasil: "ke_forum", volume_dasar: 900, volume_baru: 300, zona: "direktur", tanpa_angka: false }),
    /GPM turun ke zona Direktur\. Mandat lama gugur; usulan masuk agenda forum berikutnya/);
  assert.match(balasanVolumeTurun("D12", { hasil: "ke_forum", volume_dasar: 900, volume_baru: 300, zona: "forum", tanpa_angka: true }),
    /angka GPM belum lengkap/);
});
