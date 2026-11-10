// F170 format WA #KSO sembilan isian — pengurai, nama kepala, pendukung, alat, lampiran, daftar kurang.
// Semua data FIKTIF (repo publik): nama orang, faskes, merek pesaing, dan angka harga karangan.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  alatCocok, angkaId, bacaBarisLabel, bacaIsianFormat, bacaKlausul, bacaPendukung, bentukNama, cariAlat, cocokkanLampiran, daftarKurang,
  isianLengkapiDariFormat, kodeKlausul, namaCocok, pisahKompetitor, skorAlat, statusUnit, tipePendukung,
  type AlatKatalog, type DataKurang, type HasilOcrCprr,
} from "./kso-format.js";
import { parseKsoPerintah } from "./kso-intake.js";

const PESAN = `#KSO BUDI
1. Faskes : RS CONTOH SEJAHTERA
2. ALAT :  HEMATOLOGY ZYBIO Z50
3. TES/Test : 700 TEST/BULAN
4. MASA KSO : 36 BULAN
5. PERMINTAAN HARGA : 11.800/ TEST
6. FEE : 5%
7. KOMPETITOR : MEREKA-XN450-11.500
8. KLAUSUL : ADA
9. LAMPIRAN : ADA`;

test("format 9 isian: label, angka titik ribuan, persen, kompetitor, klausul, lampiran", () => {
  const p = parseKsoPerintah(PESAN);
  assert.equal(p.aksi, "baru");
  assert.equal(p.nama, "BUDI");
  const x = bacaIsianFormat(p.isi);
  assert.equal(x.faskes, "RS CONTOH SEJAHTERA");
  assert.equal(x.alat, "HEMATOLOGY ZYBIO Z50");
  assert.equal(x.volume, 700);
  assert.equal(x.tenor, 36);
  assert.equal(x.harga, 11800);
  assert.equal(x.fee, 5);
  assert.deepEqual(x.kompetitor, { alat: "MEREKA-XN450", merek: "MEREKA", harga: 11500 });
  assert.deepEqual(x.klausul, { ada: true, detail: null });
  assert.equal(x.lampiran, true);
  assert.deepEqual(x.barisAsing, []);
  assert.deepEqual(x.tidakTerbaca, []);
});

test("label: tak peka huruf, urutan bebas, nomor & titik dua opsional, varian label", () => {
  const x = bacaIsianFormat("fee 2,5%\nmasa kso: 3 tahun\n- Harga per test = Rp 9.500\nfaskes rsud contoh\nJumlah tes: 1.200\nalat Z 50\nTenor 24");
  assert.equal(x.fee, 2.5);
  assert.equal(x.tenor, 24, "label terakhir menang");
  assert.equal(x.harga, 9500);
  assert.equal(x.faskes, "rsud contoh");
  assert.equal(x.volume, 1200);
  assert.equal(x.alat, "Z 50");
  assert.deepEqual(bacaBarisLabel("2) ALAT 1"), ["alat", "1"]);
  assert.deepEqual(bacaBarisLabel("STATUS UNIT: relokasi idle"), ["status_unit", "relokasi idle"]);
  assert.deepEqual(bacaBarisLabel("HARI KERJA 26"), ["hari_kerja", "26"]);
  assert.deepEqual(bacaBarisLabel("JUMLAH: 2"), ["jumlah", "2"]);
  assert.equal(bacaBarisLabel("RS minta cepat"), null);
  assert.equal(bacaIsianFormat("masa kso: 3 tahun").tenor, 36);
});

test("angkaId: titik ribuan, koma desimal, rb/jt, angka pertama", () => {
  assert.equal(angkaId("11.800/ TEST"), 11800);
  assert.equal(angkaId("Rp 1.250.000"), 1250000);
  assert.equal(angkaId("2,5%"), 2.5);
  assert.equal(angkaId("11,8 rb"), 11800);
  assert.equal(angkaId("1,2 jt"), 1200000);
  assert.equal(angkaId("700TEST"), 700);
  assert.equal(angkaId("tidak tahu"), null);
});

test("nilai tak terbaca dicatat, bukan ditebak; per hari ditolak", () => {
  const x = bacaIsianFormat("TES: 30/hari\nFEE: banyak\nHARGA: nego\nSTATUS UNIT: entah");
  assert.equal(x.volume, undefined);
  assert.equal(x.fee, undefined);
  assert.deepEqual(x.tidakTerbaca.map((t) => t.label), ["tes", "fee", "harga", "status_unit"]);
  assert.match(x.tidakTerbaca[0].sebab, /per BULAN/);
  assert.equal(bacaIsianFormat("FEE: tidak ada").fee, 0);
  assert.equal(bacaIsianFormat("FEE : 0").fee, 0);
});

test("kompetitor: merek-model-harga, harga = angka terakhir; kode model 4 digit bukan harga", () => {
  assert.deepEqual(pisahKompetitor("MEREKA-XN450-11.500"), { alat: "MEREKA-XN450", merek: "MEREKA", harga: 11500 });
  assert.deepEqual(pisahKompetitor("Mereka XN-450 12500"), { alat: "Mereka XN-450", merek: "MEREKA", harga: 12500 });
  assert.deepEqual(pisahKompetitor("MEREKB-BC-5150"), { alat: "MEREKB-BC-5150", merek: "MEREKB", harga: null });
  assert.deepEqual(pisahKompetitor("MEREKB BC-5150 - Rp 10.900/test"), { alat: "MEREKB BC-5150", merek: "MEREKB", harga: 10900 });
  assert.deepEqual(pisahKompetitor("TIDAK ADA"), { alat: "tidak ada", merek: null, harga: null });
});

test("klausul: ADA/TIDAK/detail → kode; tak dikenali = lainnya", () => {
  assert.deepEqual(bacaKlausul("ADA"), { ada: true, detail: null });
  assert.deepEqual(bacaKlausul("ADA - minimal volume 500"), { ada: true, detail: "minimal volume 500" });
  assert.deepEqual(bacaKlausul("ada (alat jadi milik RS)"), { ada: true, detail: "alat jadi milik RS" });
  assert.deepEqual(bacaKlausul("TIDAK ADA"), { ada: false, detail: null });
  assert.deepEqual(bacaKlausul("tidak"), { ada: false, detail: null });
  assert.deepEqual(bacaKlausul("eksklusif 3 tahun"), { ada: true, detail: "eksklusif 3 tahun" });
  assert.deepEqual(kodeKlausul("minimal volume 500"), ["jaminan_volume"]);
  assert.deepEqual(kodeKlausul("eksklusif + tanpa denda"), ["eksklusivitas", "tanpa_denda"]);
  assert.deepEqual(kodeKlausul("pembayaran 90 hari"), ["lainnya"]);
  // ke p_isian: TIDAK = [] (gerbang 7 hijau); ADA tanpa detail = klausul_ada saja (belum dinyatakan)
  assert.deepEqual(isianLengkapiDariFormat(bacaIsianFormat("KLAUSUL: TIDAK")), { klausul_ada: false, klausul: [] });
  assert.deepEqual(isianLengkapiDariFormat(bacaIsianFormat("KLAUSUL: ADA")), { klausul_ada: true });
  assert.deepEqual(isianLengkapiDariFormat(bacaIsianFormat("KLAUSUL: ADA - minimal volume 500")),
    { klausul_ada: true, klausul_detail: "minimal volume 500", klausul: ["jaminan_volume"] });
});

test("isianLengkapiDariFormat: hanya kunci bernilai, pendukung tanpa peran tidak dikirim", () => {
  const x = bacaIsianFormat(PESAN.split("\n").slice(1).join("\n") + "\nPENDUKUNG: dr. Contoh, kepala instalasi lab\nPENDUKUNG: Bu Contoh\nSTATUS UNIT: eks kso");
  assert.deepEqual(isianLengkapiDariFormat(x), {
    volume_estimasi: 700, tenor_bulan: 36, harga_per_test: 11800, fee_persen: 5, kompetitor_alat: "MEREKA-XN450", harga_pesaing: 11500,
    klausul_ada: true, unit_status: "eks_kso", pendukung: [{ nama: "dr. Contoh", tipe: "kepala_instalasi" }],
  });
});

test("jabatan → tipe pendukung (port _PERAN_KATA), gelar dr. bukan jabatan", () => {
  assert.equal(tipePendukung("kepala instalasi lab"), "kepala_instalasi");
  assert.equal(tipePendukung("Ka. Instalasi Laboratorium"), "kepala_instalasi");
  assert.equal(tipePendukung("bagian pengadaan / PPK"), "pengadaan");
  assert.equal(tipePendukung("wadir pelayanan"), "manajemen");
  assert.equal(tipePendukung("analis senior"), "analis_perawat");
  assert.equal(tipePendukung("dokter SpPK"), "dokter_user");
  assert.equal(tipePendukung("teman lama"), null);
  assert.deepEqual(bacaPendukung("dr. Contoh, kepala instalasi lab"), [{ nama: "dr. Contoh", tipe: "kepala_instalasi" }]);
  assert.deepEqual(bacaPendukung("Pak Contoh (pengadaan); Bu Contoh - analis"),
    [{ nama: "Pak Contoh", tipe: "pengadaan" }, { nama: "Bu Contoh", tipe: "analis_perawat" }]);
  assert.deepEqual(bacaPendukung("dr. Contoh"), [{ nama: "dr. Contoh", tipe: null }], "gelar saja bukan jabatan");
  assert.deepEqual(bacaPendukung("dr. Contoh SpPK"), [{ nama: "dr. Contoh SpPK", tipe: "dokter_user" }]);
});

test("status unit → enum", () => {
  assert.equal(statusUnit("baru"), "baru");
  assert.equal(statusUnit("relokasi idle"), "idle");
  assert.equal(statusUnit("eks KSO"), "eks_kso");
  assert.equal(statusUnit("eks-demo"), "eks_demo");
  assert.equal(statusUnit("refurbish"), "refurbish");
  assert.equal(statusUnit("pinjaman principal"), "pinjaman_principal");
  assert.equal(statusUnit("bekas"), null);
});

test("isian 10–12 di pesan PERTAMA: bernomor, huruf besar, BUKTI VOLUME → sumber; templat ditempel apa adanya ditolak", () => {
  const x = bacaIsianFormat(`#KSO BUDI
1. FASKES : RS CONTOH SEJAHTERA
2. ALAT : ZYBIO Z50
3. TES : 700 TEST/BULAN
10. STATUS UNIT : RELOKASI IDLE
11. BUKTI VOLUME : rekap LIS 6 bulan
12. PENDUKUNG : dr. Contoh, kepala instalasi lab
JUMLAH : 2
HARI KERJA : 26`);
  assert.equal(x.status_unit, "idle");
  assert.equal(x.sumber, "rekap LIS 6 bulan");
  assert.deepEqual(x.pendukung, [{ nama: "dr. Contoh", tipe: "kepala_instalasi" }]);
  assert.equal(x.jumlah, 2);
  assert.equal(x.hari_kerja, 26);
  assert.deepEqual(x.tidakTerbaca, []);
  const isian = isianLengkapiDariFormat(x);
  assert.equal(isian.unit_status, "idle");
  assert.equal(isian.volume_sumber, "rekap LIS 6 bulan");
  assert.deepEqual(isian.pendukung, [{ nama: "dr. Contoh", tipe: "kepala_instalasi" }]);
  assert.deepEqual(bacaBarisLabel("11. BUKTI VOLUME : SURAT RS"), ["sumber", "SURAT RS"]);
  for (const v of ["EKS KSO", "EKS DEMO", "REFURBISH", "PINJAMAN PRINCIPAL", "BARU"]) assert.ok(bacaIsianFormat(`10. STATUS UNIT : ${v}`).status_unit, v);

  // templat ditempel tanpa diubah → tak terbaca (disebut di balasan), bukan dipilihkan
  const t = bacaIsianFormat(`10. STATUS UNIT : BARU / RELOKASI IDLE / EKS KSO / EKS DEMO / REFURBISH / PINJAMAN PRINCIPAL
11. BUKTI VOLUME : REKAP LIS 6 BULAN / PEMBELIAN REAGEN / SURAT RS
12. PENDUKUNG : dr. NAMA, JABATAN (mis. kepala instalasi lab)`);
  assert.equal(t.status_unit, undefined);
  assert.equal(t.sumber, undefined);
  assert.deepEqual(t.pendukung, []);
  assert.deepEqual(t.tidakTerbaca.map((q) => q.label), ["status_unit", "sumber", "pendukung"]);
  assert.match(t.tidakTerbaca[0].sebab, /pilih SATU/);
  assert.equal(bacaIsianFormat("STATUS UNIT: baru atau refurbish").status_unit, undefined);
  // satu jenis bukti dengan garis miring tetap diterima; dua bukti sekaligus (koma) juga
  assert.equal(bacaIsianFormat("BUKTI VOLUME: rekap LIS/SIMRS 6 bulan").sumber, "rekap LIS/SIMRS 6 bulan");
  assert.equal(bacaIsianFormat("BUKTI VOLUME: rekap LIS 6 bulan, surat RS").sumber, "rekap LIS 6 bulan, surat RS");
  // KOTA tetap diterima diam-diam
  assert.equal(bacaIsianFormat("KOTA: Kota Fiktif").kota, "Kota Fiktif");
});

test("nama di kepala #KSO: cocok dengan nama/panggilan/pushname; beda ditolak", () => {
  const kand = ["Budi Santoso Contoh", "Budi", "Budi WRG Sby"];
  assert.ok(namaCocok("BUDI", kand));
  assert.ok(namaCocok("budi santoso", kand));
  assert.ok(namaCocok("Pak Budi", kand), "sapaan diabaikan");
  assert.ok(namaCocok("Santo", ["Santoso"]), "awalan ≥ 4 huruf");
  assert.ok(!namaCocok("ANDI", kand));
  assert.ok(!namaCocok("Budi Andi", kand), "semua token kepala harus cocok");
  assert.ok(!namaCocok("", kand));
  assert.ok(bentukNama("BUDI") && bentukNama("Budi Santoso"));
  assert.ok(!bentukNama("RS A mau KSO Z3 900 tes"));
});

test("kata kunci & nomor di kepala bukan nama", () => {
  assert.equal(parseKsoPerintah("#KSO D12 PENDUKUNG: dr. Contoh, kepala lab").nama, undefined);
  assert.equal(parseKsoPerintah("#KSO kirim D12").nama, undefined);
  assert.equal(parseKsoPerintah("#KSO kelonggaran KSO-2026-0012 RS minta turun").nama, undefined);
  assert.equal(parseKsoPerintah("#KSO kalah D7 harga").nama, undefined);
  assert.equal(parseKsoPerintah("#KSO D12 volume 900").nama, undefined);
  const a = parseKsoPerintah("#KSO ALAT 1");
  assert.equal(a.nama, undefined);
  assert.equal(a.aksi, "baru");
  assert.equal(a.isi, "ALAT 1");
  assert.equal(parseKsoPerintah("#KSO format").aksi, "kosong");
  assert.equal(parseKsoPerintah("#KSO BUDI").aksi, "kosong", "nama saja tanpa isian = bantuan");
  const bebas = parseKsoPerintah("#KSO RS A mau KSO Z3 900 tes");
  assert.equal(bebas.nama, undefined);
  assert.equal(bebas.isi, "RS A mau KSO Z3 900 tes");
});

// katalog fiktif (kode katalog uji)
const KAT: AlatKatalog[] = [
  { kode: "Z50", nama: "Zybio Z50", kategori: "Hematologi" },
  { kode: "Z52", nama: "Zybio Z52", kategori: "Kimia klinik" },
  { kode: "Z3", nama: "Z3", kategori: "Hematologi" },
  { kode: "EXC200", nama: "EXC200", kategori: "Kimia klinik" },
  { kode: "EXZ8000", nama: "EXZ8000", kategori: "Imunoasai" },
  { kode: "DNX6", nama: "Easy Diagnosis DN-X6 — Elektrolit", kategori: "Elektrolit" },
];
const satu = (t: string) => { const h = cariAlat(t, KAT); return h.kind === "one" ? h.kode : null; };

test("cariAlat: variasi penulisan AM → satu kode yang yakin", () => {
  assert.equal(satu("HEMATOLOGY ZYBIO Z50"), "Z50");
  assert.equal(satu("Zybio Z 50"), "Z50");
  assert.equal(satu("Z5O"), "Z50", "O di kode = nol");
  assert.equal(satu("zybio-50"), "Z50", "merek + angka model");
  assert.equal(satu("1 unit Z3 hematologi"), "Z3");
  assert.equal(satu("EXZ 8000"), "EXZ8000");
  assert.equal(satu("exc-200"), "EXC200");
  assert.equal(satu("DN-X6"), "DNX6");
});

test("cariAlat: alat yang tak dijual / kategori saja / ambigu → 3 saran, bukan tebakan", () => {
  const luar = cariAlat("Merekb BC-5150", KAT);
  assert.equal(luar.kind, "saran");
  const kat = cariAlat("hematologi 5 diff", KAT);
  assert.equal(kat.kind, "saran");
  if (kat.kind === "saran") {
    assert.ok(kat.saran.length >= 2 && kat.saran.length <= 3);
    assert.deepEqual(kat.saran.slice(0, 2).map((s) => s.kode).sort(), ["Z3", "Z50"], "kategori hematologi di atas");
    assert.equal(kat.saran[0].kategori, "Hematologi");
  }
  const dua = cariAlat("Z3 atau Z52", KAT);
  assert.equal(dua.kind, "saran");
  if (dua.kind === "saran") {
    assert.ok(dua.ambigu);
    assert.deepEqual(dua.saran.slice(0, 2).map((s) => s.kode).sort(), ["Z3", "Z52"]);
  }
  assert.equal(cariAlat("Z5", KAT).kind, "saran", "Z5 bukan Z50/Z52");
});

test("alatCocok: OCR PDF salah baca huruf/angka tetap cocok; alat lain tidak", () => {
  assert.ok(alatCocok("250", "Z50", KAT), "Z dibaca 2");
  assert.ok(alatCocok("ZYBIO Z50", "Z50", KAT));
  assert.ok(alatCocok("Zybio 2S0", "Z50", KAT));
  assert.ok(!alatCocok("ZYBIO Z52", "Z50", KAT));
  assert.ok(!alatCocok("", "Z50", KAT));
  assert.ok(skorAlat("HEMATOLOGY ZYBIO Z50", KAT[0]) > skorAlat("HEMATOLOGY ZYBIO Z50", KAT[1]));
});

const OCR: HasilOcrCprr = {
  ok: true, galat: null, peringatan: [],
  isian: { judul: "KSO CPRR — HEMATOLOGI", tanggal: "2026-11-10", nama_sales: "BUDI", nama_faskes: "RS CONTOH SEJAHTERA", kota: "KOTA CONTOH",
    header_mentah: "BUDI RS CONTOH SEJAHTERA KOTA CONTOH", header_pasti: true, analyzer: "ZYBIO Z50", masa_bulan: 36, test_per_bulan: 700,
    hari_kerja: 26, cprr_per_test: 12100, kompetitor_teks: "MEREKA XN450 11:500" },
};
const D = {
  namaAm: ["BUDI", "Budi Santoso Contoh"], faskes: ["RS Contoh Sejahtera — Kota Contoh"], alat_kode: "Z50", alat_nama: "Zybio Z50",
  volume_estimasi: 700, tenor_bulan: 36, kompetitor_alat: "MEREKA-XN450", harga_pesaing: 11500, harga_per_test: 11800,
};

test("cocokkanLampiran: semua cocok → lolos, hari kerja & tanggal dari PDF; angka CPRR TIDAK masuk teks (10 Nov)", () => {
  const c = cocokkanLampiran(OCR, D, KAT);
  assert.ok(c.lolos, JSON.stringify(c.beda));
  assert.equal(c.hari_kerja, 26);
  assert.equal(c.tanggal, "2026-11-10");
  assert.deepEqual(Object.keys(c.cocok).sort(), ["alat", "faskes", "kompetitor", "sales", "tenor", "volume"]);
  assert.ok(!c.info.some((i) => /CPRR|12\.100/.test(i)), JSON.stringify(c.info));
  assert.ok(!JSON.stringify(c.cocok).includes("12100"));
});

test("cocokkanLampiran: OCR '250' untuk Z50 dan header tak pasti dibandingkan longgar", () => {
  const c = cocokkanLampiran({ ...OCR, isian: { ...OCR.isian, analyzer: "250", header_pasti: false, nama_sales: "BUDI RS", nama_faskes: null } }, D, KAT);
  assert.ok(c.lolos, JSON.stringify(c.beda));
});

test("cocokkanLampiran: beda volume/masa/sales/kompetitor disebut satu per satu → tidak lolos", () => {
  const c = cocokkanLampiran({ ...OCR, isian: { ...OCR.isian, test_per_bulan: 800, masa_bulan: 48, nama_sales: "ANDI", kompetitor_teks: "MEREKC 9.000" } }, D, KAT);
  assert.ok(!c.lolos);
  assert.equal(c.cocok.volume.status, "beda");
  assert.ok(c.beda.some((b) => b === 'Tes/bulan: PDF "800" ≠ WA "700"'));
  assert.ok(c.beda.some((b) => /^Masa KSO \(bulan\): PDF "48"/.test(b)));
  assert.ok(c.beda.some((b) => /^Nama sales/.test(b)));
  assert.ok(c.beda.some((b) => /^Kompetitor/.test(b)));
  const kosong = cocokkanLampiran({ ...OCR, isian: { ...OCR.isian, test_per_bulan: null } }, D, KAT);
  assert.ok(!kosong.lolos);
  assert.ok(kosong.beda.includes("Tes/bulan: tidak terbaca di PDF"));
  const belum = cocokkanLampiran(OCR, { ...D, tenor_bulan: null }, KAT);
  assert.ok(belum.beda.includes('Masa KSO (bulan): belum diisi di WA (PDF "36")'));
});

test("cocokkanLampiran: PDF bukan CPRR / OCR gagal → tidak lolos dengan alasan manusiawi", () => {
  const c = cocokkanLampiran({ ok: false, galat: "bukan-cprr", isian: null }, D, KAT);
  assert.ok(!c.lolos);
  assert.match(c.beda[0], /bukan cetakan Simulator KSO/);
  assert.match(cocokkanLampiran({ ok: false, galat: "ocr-timeout" }, D, KAT).beda[0], /gangguan/);
});

test("daftarKurang: lengkap = kosong; lampiran wajib; kontak label per item", () => {
  const lengkap: DataKurang = {
    volume_estimasi: 700, tenor_bulan: 36, harga_per_test: 11800, fee_persen: 5, kolom_dinyatakan: ["klausul", "kompetitor_alat"],
    klausul_ada: false, pendukung: [{ nama: "dr. Contoh", tipe: "kepala_instalasi" }], unit_status: "baru",
    volume_sumber: "Lampiran Simulator KSO 2026-11-10", zona_dasar: "am", lampiran: { lolos: true },
  };
  assert.deepEqual(daftarKurang(lengkap, "D62"), []);
  const q = daftarKurang({ ...lengkap, lampiran: null, fee_persen: null }, "D62");
  assert.deepEqual(q.map((x) => x.kunci), ["fee", "lampiran"]);
  assert.equal(q[0].contoh, "#KSO D62 FEE: 5%");
  assert.ok(q.every((x) => !/[<>]/.test(x.teks + x.contoh)));
  assert.deepEqual(daftarKurang({ ...lengkap, lampiran: { lolos: false, galat: "bukan-cprr" } }, "D62").map((x) => x.kunci), ["lampiran"]);
});
