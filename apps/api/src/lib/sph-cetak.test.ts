import assert from "node:assert/strict";
import { test } from "node:test";

import {
  NOMOR_DRAF,
  SYARAT_DEFAULT,
  ambilNomor,
  bulanRomawi,
  formatNomorSph,
  gabungSyarat,
  kakiSurat,
  kodeTengahSah,
  nomorUrutSah,
  perbaruiTeksSph,
  syaratDariInputLama,
  tanggalIndo,
  tanggalWib,
  terbilang,
  terbilangRupiah,
} from "./sph-cetak.js";

test("bulanRomawi 1-12, di luar itu error", () => {
  assert.deepEqual(
    Array.from({ length: 12 }, (_, i) => bulanRomawi(i + 1)),
    ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"],
  );
  assert.throws(() => bulanRomawi(0));
  assert.throws(() => bulanRomawi(13));
  assert.throws(() => bulanRomawi(1.5));
});

test("formatNomorSph: 5 digit nol di depan / kode / bulan Romawi / tahun", () => {
  assert.equal(formatNomorSph(42, "WRG.PN-PNA", 7, 2026), "00042/WRG.PN-PNA/VII/2026");
  assert.equal(formatNomorSph(1, "ABC", 12, 2027), "00001/ABC/XII/2027");
  // Lewat 99999 tidak dipotong — lebih baik nomor panjang daripada nomor kembar.
  assert.equal(formatNomorSph(123456, "X", 1, 2030), "123456/X/I/2030");
  assert.throws(() => formatNomorSph(0, "X", 1, 2030));
});

test("kodeTengahSah menolak garis miring, spasi, kosong", () => {
  assert.ok(kodeTengahSah("WRG.PN-PNA"));
  assert.ok(!kodeTengahSah("WRG/PN"));
  assert.ok(!kodeTengahSah("WRG PN"));
  assert.ok(!kodeTengahSah(""));
  assert.ok(!kodeTengahSah("-ABC"));
});

test("nomorUrutSah hanya bilangan bulat 1..9.999.999", () => {
  assert.ok(nomorUrutSah(1));
  assert.ok(nomorUrutSah(9_999_999));
  assert.ok(!nomorUrutSah(0));
  assert.ok(!nomorUrutSah(10_000_000));
  assert.ok(!nomorUrutSah(2.5));
  assert.ok(!nomorUrutSah("12"));
});

test("ambilNomor: default urut terus lintas tahun", () => {
  const a = ambilNomor({ nomorBerikutnya: 500, resetTahunan: false, tahunBerjalan: 2026 }, 2027);
  assert.equal(a.dipakai, 500);
  assert.deepEqual(a.sesudah, { nomorBerikutnya: 501, resetTahunan: false, tahunBerjalan: 2027 });
});

test("ambilNomor: reset tahunan hanya saat tahun berganti", () => {
  const sama = ambilNomor({ nomorBerikutnya: 77, resetTahunan: true, tahunBerjalan: 2026 }, 2026);
  assert.equal(sama.dipakai, 77);
  const ganti = ambilNomor({ nomorBerikutnya: 77, resetTahunan: true, tahunBerjalan: 2026 }, 2027);
  assert.equal(ganti.dipakai, 1);
  assert.equal(ganti.sesudah.nomorBerikutnya, 2);
  // Pertama kali (belum pernah memberi nomor): nomor setelan admin dipakai apa adanya.
  const awal = ambilNomor({ nomorBerikutnya: 300, resetTahunan: true, tahunBerjalan: null }, 2026);
  assert.equal(awal.dipakai, 300);
});

test("tanggalWib: 17.30 UTC = besok pagi WIB (ganti bulan & tahun)", () => {
  assert.deepEqual(tanggalWib(new Date("2026-12-31T17:30:00Z")), { tahun: 2027, bulan: 1, hari: 1 });
  assert.deepEqual(tanggalWib(new Date("2026-07-15T03:00:00Z")), { tahun: 2026, bulan: 7, hari: 15 });
  assert.equal(tanggalIndo(new Date("2026-07-31T18:00:00Z")), "1 Agustus 2026");
});

test("terbilang: kasus khusus Bahasa Indonesia", () => {
  const kasus: [number, string][] = [
    [0, "nol"],
    [1, "satu"],
    [10, "sepuluh"],
    [11, "sebelas"],
    [12, "dua belas"],
    [19, "sembilan belas"],
    [20, "dua puluh"],
    [21, "dua puluh satu"],
    [100, "seratus"],
    [101, "seratus satu"],
    [110, "seratus sepuluh"],
    [250, "dua ratus lima puluh"],
    [1000, "seribu"],
    [1001, "seribu satu"],
    [1999, "seribu sembilan ratus sembilan puluh sembilan"],
    [2000, "dua ribu"],
    [11000, "sebelas ribu"],
    [100000, "seratus ribu"],
    [1_000_000, "satu juta"],
    [1_001_000, "satu juta seribu"],
    [2_500_000, "dua juta lima ratus ribu"],
    [1_000_000_000, "satu miliar"],
    [3_000_000_000_000, "tiga triliun"],
    [12_345_678, "dua belas juta tiga ratus empat puluh lima ribu enam ratus tujuh puluh delapan"],
  ];
  for (const [n, kata] of kasus) assert.equal(terbilang(n), kata, `terbilang(${n})`);
});

test("terbilang membulatkan & menolak negatif", () => {
  assert.equal(terbilang(1000.4), "seribu");
  assert.throws(() => terbilang(-1));
  assert.throws(() => terbilang(Number.NaN));
});

test("terbilangRupiah: huruf besar di awal + 'rupiah'", () => {
  assert.equal(terbilangRupiah(1_110_000), "Satu juta seratus sepuluh ribu rupiah");
});

test("gabungSyarat: nilai kosong/bukan teks tak menimpa, dirapikan & dipotong", () => {
  const g = gabungSyarat(
    SYARAT_DEFAULT,
    { pembayaran: "  45 hari   setelah faktur ", pengiriman: "", harga: 5 },
    null,
    { masaBerlaku: "x".repeat(400) },
  );
  assert.equal(g.pembayaran, "45 hari setelah faktur");
  assert.equal(g.pengiriman, SYARAT_DEFAULT.pengiriman);
  assert.equal(g.harga, SYARAT_DEFAULT.harga);
  assert.equal(g.masaBerlaku.length, 300);
  // tidak memutasi dasar
  assert.equal(SYARAT_DEFAULT.pembayaran, "30 hari setelah faktur diterima");
});

test("syaratDariInputLama memetakan form lama", () => {
  assert.deepEqual(syaratDariInputLama({ paymentTerms: "Tunai", validityDays: 7 }), {
    pembayaran: "Tunai",
    masaBerlaku: "7 hari sejak tanggal penawaran",
  });
  assert.deepEqual(syaratDariInputLama(undefined), {});
  assert.deepEqual(syaratDariInputLama({ validityDays: 0 }), {});
});

test("perbaruiTeksSph mengganti nomor/tanggal & kaki surat, isi tengah utuh", () => {
  const awal =
    `SURAT PENAWARAN HARGA (SPH)\nNomor: ${NOMOR_DRAF} | Tanggal: 1 Juli 2026\n\nKepada Yth. RS Contoh\n\n` +
    `Pengantar.\n\n| No | Produk |\n` +
    kakiSurat(SYARAT_DEFAULT);
  const baru = perbaruiTeksSph(awal, {
    nomor: "00042/WRG.PN-PNA/VII/2026",
    tanggal: "3 Juli 2026",
    syarat: { ...SYARAT_DEFAULT, pembayaran: "Tunai" },
    ttd: { nama: "Budi Contoh", jabatan: "Manajer Penjualan" },
  });
  assert.match(baru, /^Nomor: 00042\/WRG\.PN-PNA\/VII\/2026 \| Tanggal: 3 Juli 2026$/m);
  assert.match(baru, /Pengantar\.\n\n\| No \| Produk \|\n/);
  assert.match(baru, /- Pembayaran: Tunai/);
  assert.match(baru, /PT Wahana Rizky Gumilang\n\nBudi Contoh\nManajer Penjualan\n$/);
  assert.equal(baru.match(/Syarat & Ketentuan:/g)?.length, 1);
  // Teks lama tanpa bagian syarat → kaki ditambahkan di akhir.
  assert.match(perbaruiTeksSph("Isi saja\n", { syarat: SYARAT_DEFAULT }), /^Isi saja\n\nSyarat & Ketentuan:/);
});
