// 303 — #KSO untuk faskes BARU (calon customer): pengurai label, keputusan faskes, urutan pertanyaan tertunda,
// penanda di balasan, saran akun master. Data fiktif.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bacaIsianFormat, bacaKlausul, bacaPilihanFaskes, bacaYaTidak, cariAlat, isianLengkapiDariFormat, jenisFaskes, namaTampilFaskes, peringkatFaskes, putuskanFaskes,
  semuaKataFaskes, skorFaskes, SKOR_FASKES_MIRIP, type AlatKatalog, type FaskesKatalog, type HasilOcrCprr,
} from "./kso-format.js";
import {
  alatDariPdf, balasanSaranAlat, balasanSaranFaskes, catatanFaskesBaru, faskesTerbuka, formatBalasanGerbang, ksoBolehLampiran, parseKsoPerintah,
  pertanyaanTertunda, tampilCalonFaskes, teksAlatDariPdf, ubahKonfirmasiFaskes, type DraftTampil,
} from "./kso-intake.js";
import { saranAkunMaster } from "./kso-komite.js";
import { polaTerlarang } from "./kso-saring.js";

const PESAN = `#KSO HUSNI
1. Faskes : RS UJI COBA
2. ALAT : HEMATOLOGY ZYBIO Z3
3. TES/Test : 700 TEST/BULAN
4. MASA KSO : 36 BULAN
5. PERMINTAAN HARGA : 11.800/ TEST
6. FEE : 5%
7. KOMPETITOR : SYSMEX-XN450-11.500
8. KLAUSUL : YA
9. LAMPIRAN : TIDAK`;

const KATALOG: FaskesKatalog[] = [
  { id: "9001", nama: "SEJAHTERA, RS UMUM KOTA CONTOH", cabang: "MALANG" },
  { id: "9002", nama: "MITRA KELUARGA CONTOH, RS", cabang: "SBY 1" },
  { id: "9003", nama: "MITRA KELUARGA SENTOSA, RS", cabang: "SBY 1" },
  { id: "9004", nama: "HARAPAN BUNDA, KLINIK", cabang: "MALANG" },
  { id: "BARU-7", nama: "RS ANGGREK FIKTIF", cabang: "MALANG", baru: true },
];

test("pesan product owner terurai lengkap: KLAUSUL YA = ADA, LAMPIRAN TIDAK", () => {
  const p = parseKsoPerintah(PESAN);
  assert.equal(p.aksi, "baru");
  assert.equal(p.nama, "HUSNI");
  const x = bacaIsianFormat(p.isi);
  assert.equal(x.faskes, "RS UJI COBA");
  assert.equal(x.alat, "HEMATOLOGY ZYBIO Z3");
  assert.equal(x.volume, 700);
  assert.equal(x.tenor, 36);
  assert.equal(x.harga, 11800);
  assert.equal(x.fee, 5);
  assert.deepEqual(x.klausul, { ada: true, detail: null });
  assert.equal(x.lampiran, false);
  assert.deepEqual(x.tidakTerbaca, []);
  assert.equal(isianLengkapiDariFormat(x).klausul_ada, true);
});

test("KLAUSUL: YA/ADA = ada; TIDAK/NGGAK/- = tidak; LAMPIRAN: YA = ada", () => {
  for (const v of ["YA", "ya", "ADA", "Iya", "YES"]) assert.equal(bacaKlausul(v)?.ada, true, v);
  assert.deepEqual(bacaKlausul("YA - minimal volume 500"), { ada: true, detail: "minimal volume 500" });
  for (const v of ["TIDAK", "tidak ada", "NGGAK", "gak", "-", "--", "tanpa klausul"]) assert.deepEqual(bacaKlausul(v), { ada: false, detail: null }, v);
  assert.equal(bacaIsianFormat("LAMPIRAN : YA").lampiran, true);
  assert.equal(bacaIsianFormat("LAMPIRAN : ADA").lampiran, true);
  assert.equal(bacaIsianFormat("LAMPIRAN : TIDAK").lampiran, false);
  assert.equal(bacaIsianFormat("LAMPIRAN : -").lampiran, false);
});

test("label KOTA (opsional) terbaca, tidak masuk isian draft", () => {
  const x = bacaIsianFormat("FASKES : RS UJI COBA\nKOTA : Kota Fiktif\nKab/Kota: Lain");
  assert.equal(x.faskes, "RS UJI COBA");
  assert.equal(x.kota, "Lain");
  assert.ok(x.label.includes("kota"));
  assert.equal("kota" in isianLengkapiDariFormat(x), false);
  // "RS KOTA X" di baris FASKES tetap nama faskes
  assert.equal(bacaIsianFormat("FASKES: RSUD KOTA FIKTIF").faskes, "RSUD KOTA FIKTIF");
});

test("putuskanFaskes: tak ada yang mirip → faskes baru", () => {
  assert.deepEqual(putuskanFaskes("RS UJI COBA", KATALOG), { kind: "baru" });
});

test("putuskanFaskes: cariAkun pasti + nama persis → dipakai; tak persis → konfirmasi; nama persis faskes baru lama → dipakai ulang", () => {
  assert.deepEqual(putuskanFaskes("RS UMUM SEJAHTERA (KOTA CONTOH)", KATALOG, { yakin: { id: "9001", nama: "x" } }),
    { kind: "one", id: "9001", nama: "SEJAHTERA, RS UMUM KOTA CONTOH", baru: false });
  const r = putuskanFaskes("rs sejahtera", KATALOG, { yakin: { id: "9001", nama: "x" } });
  assert.equal(r.kind, "saran");
  assert.equal(r.kind === "saran" && r.saran[0].id, "9001");
  assert.deepEqual(putuskanFaskes("rs anggrek  fiktif.", KATALOG), { kind: "one", id: "BARU-7", nama: "RS ANGGREK FIKTIF", baru: true });
});

test("putuskanFaskes: salah ketik / ambigu → SATU calon untuk dikonfirmasi, tidak membuat faskes kembar", () => {
  const h = putuskanFaskes("RS MITRA KELURGA", KATALOG);
  assert.equal(h.kind, "saran");
  if (h.kind !== "saran") return;
  assert.equal(h.saran.length, 1, "satu pertanyaan, bukan daftar");
  // seri (skor & kata sama) → nama lebih pendek, deterministik
  assert.equal(h.saran[0].id, "9002");
  assert.ok(h.saran[0].skor >= SKOR_FASKES_MIRIP);
  // peringkat lengkap tetap memuat keduanya
  assert.deepEqual(peringkatFaskes("RS MITRA KELURGA", KATALOG).map((s) => s.id), ["9002", "9003"]);
  // nama yang disebut cariAkun ambigu ikut jadi calon walau tak mirip huruf
  const a = putuskanFaskes("KLINIK XYZ", KATALOG, { ambigu: ["HARAPAN BUNDA, KLINIK"] });
  assert.equal(a.kind, "saran");
  if (a.kind === "saran") assert.deepEqual(a.saran.map((s) => s.id), ["9004"]);
});

test("skorFaskes: kata generik & kota tak membuat mirip; satu huruf salah ketik tetap mirip", () => {
  assert.ok(skorFaskes("RS UJI COBA", "SEJAHTERA, RS UMUM KOTA CONTOH") < SKOR_FASKES_MIRIP);
  assert.ok(skorFaskes("Harapan Bunda", "HARAPAN BUNDA, KLINIK") >= 0.9);
  assert.ok(skorFaskes("Klinik Harapan Bunda", "HARAPAN BUNDA, KLINIK") >= 0.9);
  assert.ok(skorFaskes("RS MITRA KELURGA CONTOH", "MITRA KELUARGA CONTOH, RS") >= 0.9);
  assert.equal(skorFaskes("RS", "RS UMUM"), 0);
});

test("bacaPilihanFaskes: nomor, BARU, nama ditulis ulang", () => {
  assert.deepEqual(bacaPilihanFaskes("2"), { kind: "nomor", n: 2 });
  assert.deepEqual(bacaPilihanFaskes("BARU"), { kind: "baru" });
  assert.deepEqual(bacaPilihanFaskes("faskes baru"), { kind: "baru" });
  assert.deepEqual(bacaPilihanFaskes("RS Uji Coba Sehat"), { kind: "nama", nama: "RS Uji Coba Sehat" });
  // "#KSO FASKES 1" / "#KSO FASKES BARU" = jawaban (bukan nama di kepala)
  const p = parseKsoPerintah("#KSO FASKES 1");
  assert.equal(p.nama, undefined);
  assert.equal(bacaIsianFormat(p.isi).faskes, "1");
  assert.equal(bacaIsianFormat(parseKsoPerintah("#KSO FASKES BARU").isi).faskes, "BARU");
});

const T = { id: 5, faskes_id: null as string | null, alat_teks: "Z5X", saran: [{ kode: "Z3", nama: "Zybio Z3", kategori: "HEMATO", skor: 50 }],
  alat_kode: null as string | null, faskes_teks: "RS MITRA KELURGA",
  faskes_saran: [{ id: "9002", nama: "MITRA KELUARGA CONTOH, RS", cabang: "SBY 1", baru: false, skor: 0.9 },
                 { id: "BARU-7", nama: "RS ANGGREK FIKTIF", cabang: null, baru: true, skor: 0.5 }] };

test("tertunda: faskes ditanya dulu (alat ikut disebut), lalu alat, lalu selesai", () => {
  const q1 = pertanyaanTertunda("HUSNI", T, ["Z3", "Z50"])!;
  assert.equal(q1.hasil.error, "faskes-belum-pasti");
  // baris tertunda lama berisi 2 calon → tetap SATU pertanyaan (calon teratas), tanpa daftar bernomor
  assert.match(q1.balasan, /^Hai Husni 👋\nFaskesnya \*RS MITRA KELUARGA CONTOH\* — cabang SBY 1, betul\?\nBalas \*#KSO YA\* atau \*#KSO TIDAK\* \(kalau tidak, dicatat sebagai faskes baru\)\./);
  assert.doesNotMatch(q1.balasan, /ANGGREK|\n\d\. /);
  assert.match(q1.balasan, /Alat "Z5X" belum ketemu pasti — ditanyakan sesudah ini\./);
  // faskes dijawab nomor → alat ditanya
  const q2 = pertanyaanTertunda("HUSNI", { ...T, faskes_id: "9002", faskes_saran: [] }, ["Z3", "Z50"])!;
  assert.equal(q2.hasil.error, "alat-belum-pasti");
  assert.match(q2.balasan, /#KSO ALAT 1/);
  assert.doesNotMatch(q2.balasan, /faskes baru/);
  // FASKES BARU (faskes_id kosong, pilihan dikosongkan) → alat ditanya + pemberitahuan faskes baru
  const q3 = pertanyaanTertunda("HUSNI", { ...T, faskes_saran: [] }, ["Z3"])!;
  assert.ok(!faskesTerbuka({ ...T, faskes_saran: [] }));
  assert.match(q3.balasan, /Faskes "RS MITRA KELURGA" akan dicatat sebagai faskes baru\./);
  // alat dulu dijawab, faskes masih terbuka → tetap faskes yang ditanya, tanpa baris alat
  const q4 = pertanyaanTertunda("HUSNI", { ...T, alat_kode: "Z3" }, ["Z3"])!;
  assert.equal(q4.hasil.error, "faskes-belum-pasti");
  assert.doesNotMatch(q4.balasan, /Alat/);
  // keduanya terjawab → draft dibuat (null)
  assert.equal(pertanyaanTertunda("HUSNI", { ...T, alat_kode: "Z3", faskes_saran: [] }, ["Z3"]), null);
  for (const q of [q1, q2, q3, q4]) assert.deepEqual(polaTerlarang(q.balasan), []);
});

function draft(o: Partial<DraftTampil> = {}): DraftTampil {
  return {
    id: 64, nomor: null, status: "DRAFT", faskes: "RS UJI COBA", cabang: "MALANG", faskes_baru: true, faskes_kota: null,
    alat: "Zybio Z3", alat_kode: "Z3", jumlah: 1, volume_estimasi: 700, volume_sumber: null, harga_per_test: 11800, harga_standar: 18500,
    kategori: "HEMATO", tenor_bulan: 36, unit_status: null, klausul: [], kolom_dinyatakan: ["klausul", "kompetitor_alat", "fee_persen"],
    pendukung: [], gerbang: [1, 2, 3, 4, 5, 6, 7].map((no) => ({ no, nama: `G${no}`, status: no === 2 || no === 7 ? "merah" : "hijau", nilai: null })),
    kursi_hod: 2, zona_dasar: "forum", gpm_deal: 0.5, fee_persen: 5, kompetitor_alat: "SYSMEX-XN450", harga_pesaing: 11500,
    klausul_ada: true, klausul_detail: null, lampiran: null, angka: { gpm: 0.512, hd: false, catatan: "GPM 51,2%", biaya_per_tes: 5000,
      harga_am: 12000, harga_hod: 11000, harga_forum: 10000, volume_min_forum: 600 }, ...o,
  };
}

test("balasan gerbang: penanda (faskes baru) di kepala, catatan faskes baru tanpa angka margin", () => {
  const catatan = catatanFaskesBaru(draft());
  const t = formatBalasanGerbang(draft(), { catatan });
  assert.equal(t.split("\n")[0], "*D64 · RS UJI COBA (faskes baru) · Z3*");
  assert.equal(t.split("\n")[1], "5 dari 7 gerbang hijau");
  assert.match(t, /ℹ️ Faskes ini belum ada di master — dicatat sebagai faskes baru \(calon customer\), cabang Malang\./);
  assert.deepEqual(polaTerlarang(t), [], t);
  assert.equal(formatBalasanGerbang(draft({ faskes_baru: false })).split("\n")[0], "*D64 · RS UJI COBA · Z3*");
  // 304: kota TIDAK pernah ditanyakan ke AM (default area AM) — dengan atau tanpa kota/PDF
  for (const d of [draft(), draft({ faskes_kota: null }), draft({ faskes_kota: "MALANG", faskes_kota_area: true })]) {
    const c = catatanFaskesBaru(d);
    assert.equal(c.length, 1);
    assert.doesNotMatch(c.join("\n"), /KOTA|[Kk]ota faskes belum/);
  }
});

test("balasanSaranFaskes tanpa alat tertunda: satu pertanyaan YA/TIDAK, tanpa baris alat", () => {
  const t = balasanSaranFaskes("HUSNI", "RS X", [{ id: "1", nama: "RS X SATU", cabang: null, baru: false, skor: 0.9 }], null);
  assert.equal(t, "Hai Husni 👋\nFaskesnya *RS X SATU*, betul?\nBalas *#KSO YA* atau *#KSO TIDAK* (kalau tidak, dicatat sebagai faskes baru).");
  assert.doesNotMatch(t, /Alat|FASKES 1|Draft BELUM|isian lain/);
  assert.deepEqual(polaTerlarang(t), []);
});

test("saranAkunMaster: urut kemiripan, maks 5, yang tak mirip sama sekali dibuang", () => {
  const s = saranAkunMaster("RS MITRA KELUARGA CONTOH", KATALOG.filter((k) => !k.baru).map((k) => ({ id: k.id, nama: k.nama, cabang: k.cabang ?? null })));
  assert.equal(s[0].id, "9002");
  assert.ok(s.length <= 5);
  assert.ok(s.every((x) => x.skor > 0));
});

test("KLAUSUL: YA tanpa isi → gerbang 7 MERAH 'isi klausul belum ditulis' (bukan 'belum dijawab')", () => {
  const ya = formatBalasanGerbang(draft({ kolom_dinyatakan: ["fee_persen", "kompetitor_alat", "klausul_ada"], klausul_ada: true }));
  assert.match(ya, /❌ Klausul — isi klausul belum ditulis/);
  const belum = formatBalasanGerbang(draft({ kolom_dinyatakan: [], klausul_ada: null }));
  assert.match(belum, /❌ Klausul — belum dijawab/);
});

test("skorFaskes: angka pembeda beda = faskes lain (bukan salah ketik)", () => {
  assert.equal(skorFaskes("RS UJI COBA 2", "RS UJI COBA"), 0);
  assert.equal(skorFaskes("Puskesmas Contoh II", "PUSKESMAS CONTOH I"), 0);
  assert.equal(skorFaskes("RS CONTOH 02", "RS CONTOH 2") > 0, true);
  assert.equal(skorFaskes("RS CONTOH SEJAHTRA", "RS CONTOH SEJAHTERA") >= SKOR_FASKES_MIRIP, true);
  assert.deepEqual(putuskanFaskes("RS UJI COBA 2", [{ id: "BARU-1", nama: "RS UJI COBA", cabang: "KOTA FIKTIF", baru: true }]), { kind: "baru" });
});

// ---------------------------------------------------------------- 10 Nov malam: bot mencocokkan, AM konfirmasi YA/TIDAK

// Kasus nyata dipetakan ke data fiktif: satu yayasan, banyak kota (nama master Accurate terbalik "INTI, JENIS KOTA").
const JARINGAN: FaskesKatalog[] = [
  { id: "8101", nama: "BAKTI LESTARI ALFA, RS", cabang: "KOTA SATU" },
  { id: "8102", nama: "BAKTI LESTARI BETA, RS UMUM KAB. GUNUNGJATI", cabang: "KOTA DUA" },
  { id: "8103", nama: "BAKTI LESTARI GAMMA, RS", cabang: "KOTA DUA" },
  { id: "8104", nama: "BAKTI LESTARI, RS UMUM KAB. GUNUNGJATI", cabang: "KOTA DUA" },
  { id: "8105", nama: "BAKTI LESTARI DELTA, RS", cabang: "KOTA SATU" },
];

test("peringkat: calon yang memuat kata kota yang ditulis AM menang atas jaringan sama di kota lain", () => {
  const teks = "RS BAKTI LESTARI GUNUNGJATI";
  assert.ok(semuaKataFaskes(teks, "BAKTI LESTARI, RS UMUM KAB. GUNUNGJATI"));
  assert.ok(!semuaKataFaskes(teks, "BAKTI LESTARI ALFA, RS"));
  // cariAkun menyebut semuanya ambigu → dulu skor dipaksa 1 (tiga pilihan setara); kini skor sebenarnya
  const semua = JARINGAN.map((j) => j.nama);
  const h = putuskanFaskes(teks, JARINGAN, { ambigu: semua, cabangAm: "KOTA SATU" });
  assert.equal(h.kind, "saran");
  if (h.kind !== "saran") return;
  assert.equal(h.saran.length, 1);
  assert.equal(h.saran[0].id, "8104", "kata kota GUNUNGJATI menang atas cabang AM; nama lebih pendek menang atas 8102");
  const urut = peringkatFaskes(teks, JARINGAN, { ambigu: semua });
  assert.deepEqual(urut.slice(0, 2).map((s) => s.id), ["8104", "8102"]);
  assert.ok(urut[0].skor > urut[2].skor, "skor nyata, bukan 1 untuk semua");
});

test("peringkat: seri → cabang AM, lalu nama lebih pendek", () => {
  const k: FaskesKatalog[] = [
    { id: "1", nama: "KASIH IBU UTARA, KLINIK", cabang: "KOTA DUA" },
    { id: "2", nama: "KASIH IBU SELATAN, KLINIK", cabang: "KOTA SATU" },
  ];
  const a = putuskanFaskes("KLINIK KASIH IBU", k, { cabangAm: "KOTA SATU" });
  assert.ok(a.kind === "saran" && a.saran[0].id === "2");
  const b = putuskanFaskes("KLINIK KASIH IBU", k, { cabangAm: "KOTA LAIN" });
  assert.ok(b.kind === "saran" && b.saran[0].id === "1", "nama lebih pendek");
});

test("nama tampil: 'INTI, JENIS KOTA' dibalik jadi terbaca; pola tak berlaku = apa adanya", () => {
  assert.equal(namaTampilFaskes("SEJAHTERA, RS UMUM KAB. CONTOH"), "RS UMUM SEJAHTERA (KAB. CONTOH)");
  assert.equal(namaTampilFaskes("SEJAHTERA, RS UMUM KOTA CONTOH"), "RS UMUM SEJAHTERA (KOTA CONTOH)");
  assert.equal(namaTampilFaskes("MITRA KELUARGA CONTOH, RS"), "RS MITRA KELUARGA CONTOH");
  assert.equal(namaTampilFaskes("HARAPAN BUNDA, KLINIK"), "KLINIK HARAPAN BUNDA");
  assert.equal(namaTampilFaskes("BAKTI LESTARI, KAB. GUNUNGJATI"), "BAKTI LESTARI (KAB. GUNUNGJATI)");
  assert.equal(namaTampilFaskes("RS ANGGREK FIKTIF"), "RS ANGGREK FIKTIF");
  assert.equal(namaTampilFaskes("CONTOH, BAPAK"), "CONTOH, BAPAK", "bagian belakang bukan jenis faskes");
  assert.equal(namaTampilFaskes("A, B, RS"), "A, B, RS");
  assert.equal(tampilCalonFaskes({ nama: "BAKTI LESTARI, RS UMUM KAB. GUNUNGJATI", cabang: "KOTA DUA", baru: false }),
    "*RS UMUM BAKTI LESTARI (KAB. GUNUNGJATI)* — cabang Kota Dua");
  assert.equal(tampilCalonFaskes({ nama: "RS ANGGREK FIKTIF", cabang: null, baru: true }), "*RS ANGGREK FIKTIF* (faskes baru)");
});

test("balasan konfirmasi: satu calon, nama terbaca + cabang, YA/TIDAK, tanpa angka margin", () => {
  const t = balasanSaranFaskes("SALMAN", "RS BAKTI LESTARI GUNUNGJATI",
    [{ id: "8104", nama: "BAKTI LESTARI, RS UMUM KAB. GUNUNGJATI", cabang: "KOTA DUA", baru: false, skor: 0.9 }], "KIMIA MEREKX CM 250");
  assert.equal(t,
    "Hai Salman 👋\n" +
    "Faskesnya *RS UMUM BAKTI LESTARI (KAB. GUNUNGJATI)* — cabang Kota Dua, betul?\n" +
    "Balas *#KSO YA* atau *#KSO TIDAK* (kalau tidak, dicatat sebagai faskes baru).\n" +
    'Alat "KIMIA MEREKX CM 250" belum ketemu pasti — ditanyakan sesudah ini.');
  assert.deepEqual(polaTerlarang(t), []);
});

test("parser: #KSO YA / TIDAK (+ varian) = konfirmasi, BUKAN nama di kepala; perintah lain tak terganggu", () => {
  for (const v of ["YA", "ya", "Y", "IYA", "BENAR", "betul", "Ya."]) {
    const p = parseKsoPerintah(`#KSO ${v}`);
    assert.equal(p.aksi, "konfirmasi", v);
    assert.equal(p.jawab, "ya", v);
    assert.equal(p.nama, undefined, v);
  }
  for (const v of ["TIDAK", "tidak", "T", "BUKAN", "tdk"]) {
    const p = parseKsoPerintah(`#KSO ${v}`);
    assert.equal(p.aksi, "konfirmasi", v);
    assert.equal(p.jawab, "tidak", v);
    assert.equal(p.nama, undefined, v);
  }
  assert.ok(ksoBolehLampiran(parseKsoPerintah("#KSO YA")));
  assert.equal(bacaYaTidak("YAKUB"), null);
  assert.equal(bacaYaTidak("TIDAK ADA"), null);
  // nama orang tetap nama; perintah & referensi tetap seperti semula
  assert.equal(parseKsoPerintah("#KSO YAKUB\nFASKES: RS A\nALAT: Z3").nama, "YAKUB");
  assert.equal(parseKsoPerintah("#KSO TIARA\nFASKES: RS A\nALAT: Z3").nama, "TIARA");
  assert.equal(parseKsoPerintah("#KSO kirim D62").aksi, "kirim");
  assert.equal(parseKsoPerintah("#KSO D62").aksi, "lengkapi");
  assert.equal(parseKsoPerintah("#KSO D62 KLAUSUL: TIDAK").aksi, "lengkapi");
  assert.equal(parseKsoPerintah("#KSO FASKES BARU").aksi, "baru");
  assert.equal(parseKsoPerintah("#KSO FASKES 1").aksi, "baru");
});

const TF = { faskes_id: null as string | null, faskes_teks: "RS BAKTI LESTARI GUNUNGJATI", alat_kode: "Z3" as string | null,
  faskes_saran: [{ id: "8104", nama: "BAKTI LESTARI, RS UMUM KAB. GUNUNGJATI", cabang: "KOTA DUA", baru: false, skor: 0.9 }] };

test("YA → calon dipakai; TIDAK → faskes baru dengan nama yang ditulis; tanpa konfirmasi terbuka → dibalas, tak mengubah", () => {
  assert.deepEqual(ubahKonfirmasiFaskes(TF, "ya", "SALMAN"),
    { ubah: { faskes_id: "8104", faskes_teks: "RS BAKTI LESTARI GUNUNGJATI", faskes_saran: [] } });
  assert.deepEqual(ubahKonfirmasiFaskes(TF, "tidak", "SALMAN"),
    { ubah: { faskes_id: null, faskes_teks: "RS BAKTI LESTARI GUNUNGJATI", faskes_saran: [] } });
  // sesudah YA: faskes terjawab, alat masih menunggu → YA kedua bukan jawaban faskes
  const sesudah = { ...TF, faskes_id: "8104", faskes_saran: [], alat_kode: null };
  const r = ubahKonfirmasiFaskes(sesudah, "ya", "SALMAN");
  assert.ok("galat" in r && r.galat === "tanpa-konfirmasi");
  if ("galat" in r) assert.match(r.balasan, /^Hai Salman 👋\nTidak ada konfirmasi faskes yang menunggu jawaban\. Yang masih ditunggu: pilihan alat/);
  const kosong = ubahKonfirmasiFaskes(null, "tidak", "SALMAN");
  assert.ok("galat" in kosong);
  if ("galat" in kosong) assert.match(kosong.balasan, /Tidak ada konfirmasi faskes yang menunggu jawaban\. Untuk usulan baru, kirim format #KSO lengkap ya\./);
  // sesudah YA dan alat sudah pasti → pertanyaanTertunda null = draft dibuat
  assert.equal(pertanyaanTertunda("SALMAN", { id: 1, alat_teks: "Z3", saran: [], ...TF, faskes_id: "8104", faskes_saran: [] }, ["Z3"]), null);
  // sesudah TIDAK, alat masih tertunda → pertanyaan alat + pemberitahuan faskes baru
  const q = pertanyaanTertunda("SALMAN", { id: 1, alat_teks: "MEREKX", saran: [], ...TF, alat_kode: null, faskes_saran: [] }, ["Z3"])!;
  assert.match(q.balasan, /Faskes "RS BAKTI LESTARI GUNUNGJATI" akan dicatat sebagai faskes baru\./);
});

// varian penulisan pesan AM sungguhan (data fiktif)
const PESAN_VARIAN = `#KSO SALMAN
1. NAMA CUSTOMER  ; RS BAKTI LESTARI GUNUNGJATI
2. NAMA ALAT :  KIMIA KLINIK MEREKX CM 250
3. JUMLAH TEST : 150 TEST/ BULAN
4. MASA KSO : 60 BULAN
5. PERMINTAAN HARGA : 31.000/ TEST
6. FEE : 0%
7. KOMPETITOR : -
8. KLAUSUL : Free Control, RO
9. LAMPIRAN : ADA`;

test("varian label: NAMA CUSTOMER ';', NAMA ALAT, JUMLAH TEST '150 TEST/ BULAN', KOMPETITOR '-', KLAUSUL teks bebas", () => {
  const p = parseKsoPerintah(PESAN_VARIAN);
  assert.equal(p.aksi, "baru");
  assert.equal(p.nama, "SALMAN");
  const x = bacaIsianFormat(p.isi);
  assert.equal(x.faskes, "RS BAKTI LESTARI GUNUNGJATI");
  assert.equal(x.alat, "KIMIA KLINIK MEREKX CM 250");
  assert.equal(x.volume, 150);
  assert.equal(x.tenor, 60);
  assert.equal(x.harga, 31000);
  assert.equal(x.fee, 0);
  assert.deepEqual(x.kompetitor, { alat: "tidak ada", merek: null, harga: null });
  assert.deepEqual(x.klausul, { ada: true, detail: "Free Control, RO" });
  assert.equal(x.lampiran, true);
  assert.deepEqual(x.barisAsing, []);
  assert.deepEqual(x.tidakTerbaca, []);
  const o = isianLengkapiDariFormat(x);
  assert.equal(o.kompetitor_alat, "tidak ada");
  assert.equal("harga_pesaing" in o, false);
  assert.deepEqual(o.klausul, ["lainnya"]);
  assert.equal(o.klausul_ada, true);
  // label lain
  for (const [baris, label, nilai] of [
    ["CUSTOMER: RS A", "faskes", "RS A"], ["NAMA RS = RS A", "faskes", "RS A"], ["NAMA FASKES - RS A", "faskes", "RS A"],
    ["NAMA ANALYZER : Z3", "alat", "Z3"], ["JUMLAH TES; 700", "tes", "700"], ["KOMPETITOR : TIDAK ADA", "kompetitor", "TIDAK ADA"],
    ["KOMPETITOR NIHIL", "kompetitor", "NIHIL"], ["KOMPETITOR -", "kompetitor", "-"],
  ] as const) {
    const x2 = bacaIsianFormat(baris);
    assert.ok(x2.label.includes(label), baris);
    if (label === "faskes") assert.equal(x2.faskes, nilai, baris);
    if (label === "alat") assert.equal(x2.alat, nilai, baris);
    if (label === "kompetitor") assert.equal(x2.kompetitor?.alat, "tidak ada", baris);
  }
  assert.equal(bacaIsianFormat("JUMLAH TES; 700").volume, 700);
  // "RS" saja bukan label
  assert.equal(bacaIsianFormat("RS minta cepat").faskes, undefined);
});

// katalog dengan kategori kode Simulator (seperti prod): HEMATO / CC / CLIA / ELEKTRO
const KAT_SIM: AlatKatalog[] = [
  { kode: "DNX6", nama: "Easy Diagnosis DN-X6", kategori: "ELEKTRO" },
  { kode: "EXC200", nama: "Zybio EXC200", kategori: "CC" },
  { kode: "EXC400", nama: "Zybio EXC400", kategori: "CC" },
  { kode: "EXZ8000", nama: "Zybio EXZ8000", kategori: "CLIA" },
  { kode: "Z3", nama: "Zybio Z3", kategori: "HEMATO" },
  { kode: "Z50", nama: "Zybio Z50", kategori: "HEMATO" },
  { kode: "Z52", nama: "Zybio Z52", kategori: "HEMATO" },
];

test("alat di luar katalog 'KIMIA KLINIK MEREKX CM 250': bukan Z50, tanpa saran merek lain → alat baru (307)", () => {
  // product owner 11 Nov: "WIENERLAB CM250 → Z50 ini beda alat" — merek/model lain tidak disarankan, kategori sama pun tidak
  for (const t of ["KIMIA KLINIK MEREKX CM 250", "WIENERLAB CM250", "WIENERLAB CM 250"]) {
    const h = cariAlat(t, KAT_SIM);
    assert.equal(h.kind, "saran", t);
    if (h.kind === "saran") assert.deepEqual(h.saran, [], t);
  }
  // OCR PDF "250" tanpa huruf di depan tetap dibaca Z50; kode utuh menang walau kategori bertentangan
  assert.ok(cariAlat("250", KAT_SIM).kind === "one");
  const z = cariAlat("KIMIA Z50", KAT_SIM);
  assert.ok(z.kind === "one" && z.kode === "Z50");
  const hem = cariAlat("HEMATOLOGY ZYBIO Z50", KAT_SIM);
  assert.ok(hem.kind === "one" && hem.kode === "Z50");
});

test("alat dari PDF Simulator: analyzer yang menunjuk tepat satu kode dipakai; tak pasti / OCR gagal = null", () => {
  const ocr = (analyzer: string | null, ok = true): HasilOcrCprr => ({ ok, isian: { analyzer } });
  assert.deepEqual(alatDariPdf(ocr("ZYBIO EXC-200"), KAT_SIM), { kode: "EXC200", nama: "Zybio EXC200", kategori: "CC", analyzer: "ZYBIO EXC-200" });
  assert.equal(alatDariPdf(ocr("MEREKX CM 250"), KAT_SIM), null);
  assert.equal(alatDariPdf(ocr("ZYBIO EXC-200", false), KAT_SIM), null);
  assert.equal(alatDariPdf(ocr(null), KAT_SIM), null);
  // hanya kode katalog — teks OCR mentah kolom analyzer ("ZYBIO EXC-200", "EXC200 =") tak pernah ditampilkan
  const t = teksAlatDariPdf({ kode: "EXC200", nama: "Zybio EXC200", analyzer: "EXC200 =" } as { kode: string }, "D70");
  assert.equal(t, "Alat diambil dari PDF Simulator: *EXC200*. Salah? Balas #KSO D70 ALAT: KODE");
  assert.equal(teksAlatDariPdf({ kode: "EXC200" }, null), "Alat: *EXC200* (dari PDF Simulator)");
  assert.doesNotMatch(t + teksAlatDariPdf({ kode: "EXC200" }, null), /=|katalog KSO|PDF: "/);
  assert.deepEqual(polaTerlarang(t), []);
});

test("putuskanFaskes: cariAkun yakin tapi nama tak persis → tetap konfirmasi YA/TIDAK", () => {
  const kat = [{ id: "9101", nama: "Faskes 0AB123", cabang: "KOTA FIKTIF", baru: false }];
  const r = putuskanFaskes("Faskes 0AB12B", kat, { yakin: { id: "9101", nama: "Faskes 0AB123" } });
  assert.equal(r.kind, "saran");
  assert.deepEqual(putuskanFaskes("faskes  0ab123", kat, { yakin: { id: "9101", nama: "Faskes 0AB123" } }),
    { kind: "one", id: "9101", nama: "Faskes 0AB123", baru: false });
  const inv = [{ id: "9102", nama: "SEJAHTERA, RS UMUM KAB. CONTOH", cabang: null, baru: false }];
  assert.equal(putuskanFaskes("RS UMUM SEJAHTERA KAB CONTOH", inv, { yakin: { id: "9102", nama: inv[0].nama } }).kind, "one");
});

test("jenisFaskes: RS/RSUD/RUMAH SAKIT, PKM/PUSKESMAS, klinik, lab; tak tertulis → null", () => {
  assert.equal(jenisFaskes("RSUD CONTOH"), "rs");
  assert.equal(jenisFaskes("CONTOH, RSIA KAB. UJI"), "rs");
  assert.equal(jenisFaskes("RUMAH SAKIT CONTOH"), "rs");
  assert.equal(jenisFaskes("CONTOH, PKM KAB. UJI"), "pkm");
  assert.equal(jenisFaskes("PUSKESMAS CONTOH"), "pkm");
  assert.equal(jenisFaskes("KLINIK CONTOH"), "klinik");
  assert.equal(jenisFaskes("LAB CONTOH"), "lab");
  assert.equal(jenisFaskes("CONTOH"), null);
});

test("putuskanFaskes: jenis yang ditulis AM memutus seri — RSUD X tidak ditawari PKM X (kasus prod 10 Nov)", () => {
  const kat = [
    { id: "r1", nama: "CONTOHSARI, RSUD KAB. UJI", cabang: "A" },
    { id: "p1", nama: "CONTOHSARI, PKM KAB. UJI", cabang: "A" },
  ];
  for (const k of [kat, [...kat].reverse()]) {
    const h = putuskanFaskes("RSUD CONTOHSARI", k);
    assert.equal(h.kind, "saran");
    assert.equal(h.kind === "saran" && h.saran[0].id, "r1");
    const p = putuskanFaskes("PUSKESMAS CONTOHSARI", k);
    assert.equal(p.kind === "saran" && p.saran[0].id, "p1");
  }
  // jenis tak ditulis → urutan lama (nama lebih pendek) tetap berlaku
  assert.deepEqual(peringkatFaskes("CONTOHSARI", kat).map((x) => x.id), ["p1", "r1"]);
});

// ---------------------------------------------------------------- 10 Nov malam: jenis faskes beda = faskes lain (A)

test("jenis beda (RSUD vs PKM) = faskes lain: tak ditawarkan, langsung faskes baru", () => {
  const kat: FaskesKatalog[] = [{ id: "p9", nama: "CONTOH, PKM KAB. UJI", cabang: "KOTA SATU" }];
  assert.equal(skorFaskes("RSUD CONTOH", "CONTOH, PKM KAB. UJI"), 0);
  assert.deepEqual(putuskanFaskes("RSUD CONTOH", kat), { kind: "baru" });
  // urutan Accurate terbalik pun sama: "CONTOH, RSUD KAB. UJI" bukan "CONTOH, PKM KAB. UJI"
  assert.deepEqual(putuskanFaskes("CONTOH, RSUD KAB.UJI", kat), { kind: "baru" });
  // disebut ambigu / ditunjuk pasti oleh cariAkun pun tidak ditawarkan
  assert.deepEqual(putuskanFaskes("RSUD CONTOH", kat, { ambigu: ["CONTOH, PKM KAB. UJI"] }), { kind: "baru" });
  assert.deepEqual(putuskanFaskes("RSUD CONTOH", kat, { yakin: { id: "p9", nama: "CONTOH, PKM KAB. UJI" } }), { kind: "baru" });
  // jenis sama → dikonfirmasi
  const p = putuskanFaskes("PUSKESMAS CONTOH", kat);
  assert.ok(p.kind === "saran" && p.saran[0].id === "p9");
  // jenis tak ditulis di salah satu sisi → seperti biasa
  const n = putuskanFaskes("CONTOH KAB UJI", kat);
  assert.ok(n.kind === "saran" && n.saran[0].id === "p9");
  assert.ok(skorFaskes("RSUD CONTOH", "CONTOH KAB. UJI") >= SKOR_FASKES_MIRIP);
  // RS vs klinik juga beda
  assert.equal(skorFaskes("RS HARAPAN BUNDA", "HARAPAN BUNDA, KLINIK"), 0);
});
