import assert from "node:assert/strict";
import { test } from "node:test";

import {
  berbauInternal,
  formatDraftKonfirmasi,
  formatIngatanBelumLengkap,
  formatIngatanKonfirmasi,
  formatResume,
  kategoriAwal,
  miripKeputusanResume,
  parseKeputusanResume,
  type KoranLine,
  type RingkasanHarian,
} from "./cashin.js";

// Semua contoh di bawah adalah baris SUNGGUHAN dari folder REKENING KORAN
// (31 Agu – 4 Sep 2026), bukan karangan. Itu penting: yang bikin fitur ini
// mudah salah bukan kasus buatan, tapi bunyi deskripsi bank yang sebenarnya.

const AFILIASI = ["PRATAMINDO", "INSAN WAHANA"];

function line(over: Partial<KoranLine>): KoranLine {
  return {
    urut: 1, waktu: null, deskripsi: "", debit: 0, kredit: 0, saldo: null, referensi: null,
    ...over,
  };
}

test("kredit dari faskes = uang masuk riil", () => {
  const contoh = [
    "RS WAJAK HUSADA",
    "KU- RSUD SUKOWATI TANGEN",
    "0241999939 KAS BLUD RSUD DR MOHAMMAD ZYN BLJ BHN LAB-PT WAHANA RIZKY GU",
    "PEMBAYARAN INV SOR/I MCM InhouseTrf CS-CS DARI PERDANA SUKSES LEKSA ABADI",
    "Hasta brata CA Cash Deposit Hasta brata",
  ];
  for (const d of contoh) {
    assert.equal(kategoriAwal(line({ deskripsi: d, kredit: 1_000_000 }), AFILIASI), "uang_masuk_riil", d);
  }
});

test("kredit bernama sendiri TANPA pasangan tetap uang masuk riil", () => {
  // BJTM 31 Agu 2026 baris 4: kredit 9.758.840 dgn deskripsi berisi nomor DAN
  // nama rekening sendiri, tapi tak ada debit sepadan hari itu. Aturan berbasis
  // nama akan memotongnya dari penerimaan — justru kesalahan yang paling mahal
  // di fitur ini, jadi dijaga tes.
  const l = line({ deskripsi: "0321018688WAHANARIZKYGUMILANGP", kredit: 9_758_840 });
  assert.equal(kategoriAwal(l, AFILIASI), "uang_masuk_riil");
  // Deskripsinya memang "berbau internal" — itu boleh, tapi hanya berguna
  // sebagai penguat SETELAH ada pasangan nominal, bukan sebagai penentu.
  assert.equal(berbauInternal(l.deskripsi), true);
});

test("bunga, pajak, biaya adm, dan deposito dipisahkan dari penerimaan", () => {
  assert.equal(kategoriAwal(line({ deskripsi: "PEMBAYARAN BUNGA", kredit: 108_365.37 }), AFILIASI), "bunga");
  assert.equal(kategoriAwal(line({ deskripsi: "JASA GIRO/BUNGA", kredit: 95_112 }), AFILIASI), "bunga");
  assert.equal(kategoriAwal(line({ deskripsi: "PAJAK", debit: 21_673.07 }), AFILIASI), "biaya_pajak");
  assert.equal(kategoriAwal(line({ deskripsi: "PPH", debit: 19_023 }), AFILIASI), "biaya_pajak");
  assert.equal(kategoriAwal(line({ deskripsi: "BIAYA ADM REK", debit: 25_000 }), AFILIASI), "biaya_pajak");
  assert.equal(
    kategoriAwal(line({ deskripsi: "FD TR (CR) TO CASA - PROFIT PAYMENT", kredit: 11_210_958.9 }), AFILIASI),
    "deposito",
  );
});

test("penerimaan dari afiliasi terpisah, pembayaran KE afiliasi tetap pengeluaran", () => {
  assert.equal(
    kategoriAwal(line({ deskripsi: "InhouseTrf DARI PRATAMINDO MITRA RIZKY", kredit: 5_000_000 }), AFILIASI),
    "afiliasi_grup",
  );
  // Mandiri 4 Sep: BIFAST Out ke Pratamindo 25 jt. Kalau ini ikut dilabeli
  // afiliasi_grup, uang keluar 25 jt hilang dari total pengeluaran sekaligus
  // muncul di baris penerimaan afiliasi.
  assert.equal(
    kategoriAwal(line({ deskripsi: "2510-544 BIFAST Out CS-GL SUNIIDJA/PRATAMINDO MITRA RIZKY, PT", debit: 25_000_000 }), AFILIASI),
    "pengeluaran",
  );
});

test("deskripsi buntu tidak ditebak", () => {
  // Cr Multi CASA (Mandiri 4 Sep, 3.676.320) — tanpa nama pengirim, tanpa
  // referensi. Sedang dikroscek Finance; sampai itu selesai tidak boleh masuk
  // total penerimaan.
  assert.equal(kategoriAwal(line({ deskripsi: "Cr Multi CASA", kredit: 3_676_320 }), AFILIASI), "belum_ditriage");
  assert.equal(kategoriAwal(line({ deskripsi: "-", kredit: 550_477 }), AFILIASI), "belum_ditriage");
  assert.equal(kategoriAwal(line({ deskripsi: "", kredit: 550_477 }), AFILIASI), "belum_ditriage");
});

test("pemindahbukuan internal tanpa pasangan ditahan, bukan diaku penerimaan", () => {
  // Bank Index 131, 2 Sep: kredit 29.905.935 'PaymentFromBuffer SETOR
  // PEMINDAHBUKUAN'. Pasangannya ada (Index 336) — tapi kalau file lawannya
  // belum disetor, baris ini TIDAK boleh dihitung sebagai uang masuk.
  assert.equal(
    kategoriAwal(line({ deskripsi: "PaymentFromBuffer SETOR PEMINDAHBUKUAN", kredit: 29_905_935 }), AFILIASI),
    "belum_ditriage",
  );
});

test("berbauInternal mengenali kode SWIFT rekening sendiri", () => {
  assert.equal(berbauInternal("BIFAST Inc GL-CS PDJTIDJ1/WAHANA RIZKY GUMILANG PT"), true);
  assert.equal(berbauInternal("BIFAST Inc GL-CS HNBNIDJA/WAHANA RIZKY GUMILANG"), true);
  assert.equal(berbauInternal("PaymentFromOperational TARIK PB(BAGIAN K"), true);
  assert.equal(berbauInternal("TRANSFER BI FAST"), true);
  // Lawan transaksi pihak ketiga tak boleh lolos.
  assert.equal(berbauInternal("KU- RSUD SUKOWATI TANGEN"), false);
  assert.equal(berbauInternal("RS WAJAK HUSADA"), false);
});

function ringkasan(over: Partial<RingkasanHarian> = {}): RingkasanHarian {
  return {
    tanggal: "2026-09-04",
    uang_masuk_riil: 58_731_797, afiliasi_grup: 0, puteran_internal: 164_000_000,
    bunga: 0, deposito: 0, refund: 0, belum_ditriage: 3_676_320, pengeluaran: 0,
    non_kas_kredit: 14_000_000, non_kas_debit: 0,
    rekening_wajib: 10, rekening_masuk: 3,
    rekening_belum: ["BNI", "HANA", "INDEX 131", "INDEX 336", "INDEX 890", "MDR 734", "NIAGA"],
    statement_perlu_review: [],
    penerimaan_terbesar: [{ label_file: "BJTM", deskripsi: "RS WAJAK HUSADA", kredit: 10_740_360 }],
    puteran_detail: [{ dari: "BJTM", ke: "MDR 038", nominal: 100_000_000 }],
    ...over,
  };
}

test("resume menyebut kelengkapan rekening dan angka tertahan", () => {
  const teks = formatResume(ringkasan());
  // 4 Sep 2026 = Jumat. Dicocokkan dengan footer statement Bank Index yang
  // mencetak "Jumat 04 September" — nama hari ikut diuji karena resume dikirim
  // ke Direktur dan hari yang salah langsung terlihat keliru.
  assert.match(teks, /Jumat, 04 Sep 2026/);
  assert.match(teks, /Uang masuk riil\s+: Rp 58\.731\.797/);
  assert.match(teks, /Belum ditriage/);
  // Kelengkapan wajib muncul: tanpa ini resume bisa terlihat wajar padahal 7
  // rekening belum menyetor koran.
  assert.match(teks, /Koran diterima 3\/10 rekening/);
  assert.match(teks, /Belum setor: BNI, HANA/);
  assert.match(teks, /BJTM → MDR 038/);
});

test("resume menyembunyikan baris nol supaya yang penting tidak tenggelam", () => {
  const teks = formatResume(ringkasan({ belum_ditriage: 0, non_kas_kredit: 0, non_kas_debit: 0 }));
  assert.doesNotMatch(teks, /Belum ditriage/);
  assert.doesNotMatch(teks, /Rekening pinjaman/);
  assert.doesNotMatch(teks, /Bunga\/deposito/);
});

test("resume menyebut statement yang tidak lolos verifikasi", () => {
  const teks = formatResume(
    ringkasan({
      statement_perlu_review: [
        { label_file: "MDR 038", alasan: "saldo akhir tidak bersambung ke hari berikutnya — kemungkinan dicetak sebelum tutup hari" },
      ],
    }),
  );
  assert.match(teks, /MDR 038: saldo akhir tidak bersambung/);
});

// ── gerbang konfirmasi Finance (migrasi 178) ─────────────────────────────────

test("balasan konfirmasi dikenali dalam bentuk yang benar-benar diketik orang", () => {
  const ya = ["ya R12", "YA r12", "ok R12", "*ya R12*", "setuju #R12", "kirim R 12"];
  for (const b of ya) {
    assert.deepEqual(parseKeputusanResume(b), { keputusan: "ya", kode: "R12", alasan: null }, b);
  }
  // Alasan ikut terbawa saat menahan — itu yang dibaca orang besok pagi waktu
  // bertanya "kenapa resume 4 Sep tidak dikirim".
  assert.deepEqual(parseKeputusanResume("tidak R12 angka BJTM salah"), {
    keputusan: "tidak",
    kode: "R12",
    alasan: "angka BJTM salah",
  });
  // Kode boleh muncul di baris kedua: orang sering mengutip draft lalu membalas
  // di bawahnya.
  assert.deepEqual(parseKeputusanResume("noted\nya R7"), { keputusan: "ya", kode: "R7", alasan: null });
});

test("percakapan biasa TIDAK pernah menyetujui resume", () => {
  // Ini penjaga terpenting di modul ini: satu false-positive = angka uang masuk
  // terkirim ke Direktur tanpa ada manusia yang memeriksanya.
  const bukan = [
    "ya 12",              // tanpa huruf kode — "ya 12 rb aja"
    "ya",                 // persetujuan percakapan
    "ok siap",
    "iya betul yang R itu belum masuk",
    "ya L3",              // ruang nama detect_leave (approval cuti)
    "tidak ada koran hari ini",
  ];
  for (const b of bukan) assert.equal(parseKeputusanResume(b), null, b);
});

test("balasan yang jelas meniru format tapi rusak dibalas panduan, bukan didiamkan", () => {
  // Pelajaran detect_leave: "ya LT2" dulu senyap dan approver menyangka
  // approval-nya masuk.
  for (const b of ["ya R", "ok r1x", "tidak R "]) assert.equal(miripKeputusanResume(b), true, b);
  // Yang sudah benar tidak dianggap mirip (nanti dibalas dua kali).
  assert.equal(miripKeputusanResume("ya R12"), false);
  // Ruang nama modul lain tidak diserobot.
  assert.equal(miripKeputusanResume("ya L3"), false);
  // Kalimat panjang yang kebetulan berawalan kata keputusan bukan salah ketik.
  assert.equal(miripKeputusanResume("ya rekening BJTM sudah saya kirim tadi pagi"), false);
});

test("draft menyatakan dirinya BELUM dikirim ke Direktur", () => {
  const teks = formatDraftKonfirmasi(formatResume(ringkasan()), "R12");
  // Kalimat ini yang mencegah draft dibaca sebagai laporan final saat di-forward.
  assert.match(teks, /DRAFT — belum dikirim ke Direktur/);
  assert.match(teks, /ya R12/);
  assert.match(teks, /tidak R12/);
  // Isi resume tetap utuh di dalam draft — Finance menyetujui teks yang persis
  // sama dengan yang akan diterima Direktur.
  assert.match(teks, /Uang masuk riil\s+: Rp 58\.731\.797/);
});

test("pengingat menyebut kode dan angka yang masih tertahan", () => {
  const teks = formatIngatanKonfirmasi("R12", "2026-09-04", 3_676_320);
  assert.match(teks, /R12/);
  assert.match(teks, /Rp 3\.676\.320/);
  const lengkap = formatIngatanBelumLengkap(ringkasan());
  assert.match(lengkap, /3\/10 rekening/);
  assert.match(lengkap, /BNI, HANA/);
});

// ── pemicu hening + label kelengkapan ────────────────────────────────────────

test("resume yang belum lengkap menyatakannya di ATAS angka, bukan cuma di footer", () => {
  // Sejak draft boleh terbentuk dari koran yang belum lengkap (hening 15 menit),
  // teks ini bisa sampai ke Direktur dengan 2 dari 10 rekening terhitung. Yang
  // dijaga di sini: angka parsial tidak pernah terlihat seperti angka final.
  const teks = formatResume(ringkasan());
  const barisAwal = teks.split("\n").slice(0, 2).join("\n");
  assert.match(barisAwal, /BELUM LENGKAP — baru 3\/10 rekening/);
  // Footer lama tetap ada (rincian rekening mana yang belum).
  assert.match(teks, /Koran diterima 3\/10 rekening/);
  assert.match(teks, /Belum setor: BNI, HANA/);
});

test("resume lengkap TIDAK memasang peringatan itu", () => {
  const teks = formatResume(ringkasan({ rekening_masuk: 10, rekening_belum: [] }));
  assert.doesNotMatch(teks, /BELUM LENGKAP/);
  assert.doesNotMatch(teks, /Belum setor/);
});
