import assert from "node:assert/strict";
import { test } from "node:test";

import {
  berbauInternal,
  cocokLabelFile,
  parseNihil,
  parseTriage,
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
    per_rekening: [
      {
        label_file: "MDR 038", nama_bank: "Bank Mandiri",
        uang_masuk: 45_231_797, puteran_keluar: 14_000_000,
        kredit_koran: 49_231_797, puteran_masuk: 4_000_000, tertahan: 0, lain: 0,
      },
      {
        label_file: "BJTM", nama_bank: "Bank Jatim",
        uang_masuk: 13_500_000, puteran_keluar: 150_000_000,
        kredit_koran: 17_176_320, puteran_masuk: 0, tertahan: 3_676_320, lain: 0,
      },
    ],
    rekening_nihil: [],
    tertahan_detail: [],
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
  assert.match(teks, /Total uang masuk\s+: Rp 58.731.797/);
  assert.match(teks, /Belum ditriage/);
  // Kelengkapan tetap terbaca — tapi lewat peringatan di KEPALA resume, bukan
  // daftar rekening di kaki (itu pindah ke draft; permintaan user 18 Sep 2026).
  assert.match(teks, /BELUM LENGKAP — baru 3\/10 rekening/);
  assert.doesNotMatch(teks, /Koran diterima/);
  assert.doesNotMatch(teks, /Belum setor/);
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
  assert.match(teks, /Total uang masuk\s+: Rp 58.731.797/);
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
});

test("resume lengkap TIDAK memasang peringatan itu", () => {
  const teks = formatResume(ringkasan({ rekening_masuk: 10, rekening_belum: [] }));
  assert.doesNotMatch(teks, /BELUM LENGKAP/);
});

test("resume merinci uang masuk per rekening, lalu totalnya", () => {
  // Permintaan Direktur 18 Sep 2026: "perlu tahu uang yang masuk di mandiri
  // berapa, di jatim berapa, dan seterusnya. kemudian totalnya, dan yang
  // puteran berapa."
  const teks = formatResume(ringkasan());
  assert.match(teks, /\*Masuk per rekening\*/);
  assert.match(teks, /MDR 038 · Mandiri : Rp 45\.231\.797/);
  assert.match(teks, /BJTM\s+· Jatim : Rp 13\.500\.000/);
  assert.match(teks, /Total uang masuk\s+: Rp 58\.731\.797/);
  assert.match(teks, /Puteran internal\s+: Rp 164\.000\.000 \(dikecualikan\)/);
  // Rincian muncul SEBELUM total — itu urutan yang ditanyakan orangnya.
  assert.ok(teks.indexOf("Masuk per rekening") < teks.indexOf("Total uang masuk"));
});

test("rincian per rekening menjumlah PERSIS ke totalnya", () => {
  // Penjaga paling penting di blok ini: rincian dan total dihitung lewat dua
  // query berbeda, jadi penyaringnya bisa menyimpang tanpa suara. Angka yang
  // tak menjumlah membuat seluruh laporan kehilangan kepercayaan.
  const r = ringkasan();
  const jumlah = r.per_rekening.reduce((a, p) => a + p.uang_masuk, 0);
  assert.equal(jumlah, r.uang_masuk_riil);
});

test("resume tidak lagi memuat daftar transaksi mentah", () => {
  // Dibuang atas permintaan user 18 Sep 2026: deskripsi mentah bank
  // ('20260828PDJTIDJ1010O0101090643 PDJTIDJ1/W…') tak terbaca manusia dan
  // memakan 6 baris. Datanya tetap dihitung untuk menu web.
  const r = ringkasan();
  const teks = formatResume(r);
  assert.doesNotMatch(teks, /Penerimaan terbesar/);
  assert.doesNotMatch(teks, /RS WAJAK HUSADA/);
  assert.ok(r.penerimaan_terbesar.length > 0, "datanya tetap ada di ringkasan");
});

test("daftar rekening yang belum setor pindah ke DRAFT, bukan hilang", () => {
  // Finance yang mengejar koran yang kurang, jadi daftarnya ikut ke pesan yang
  // dibaca Finance — bukan ke resume yang diteruskan ke Direktur.
  const r = ringkasan();
  const draft = formatDraftKonfirmasi(formatResume(r), "R12", r);
  assert.match(draft, /Koran diterima 3\/10 rekening/);
  assert.match(draft, /Belum setor: BNI, HANA/);
  // Tanpa ringkasan (pemanggil lama) draft tetap valid, cuma tanpa blok itu.
  assert.doesNotMatch(formatDraftKonfirmasi("x", "R12"), /Koran diterima/);
});

test("peringatan integritas statement TETAP ikut ke Direktur", () => {
  // Beda kelas dari "file belum datang": ini berarti angka yang SEDANG DIBACA
  // bisa salah, jadi ia harus ikut ke mana pun angkanya pergi.
  const teks = formatResume(
    ringkasan({
      statement_perlu_review: [{ label_file: "MDR 038", alasan: "saldo akhir tidak bersambung ke hari berikutnya" }],
    }),
  );
  assert.match(teks, /MDR 038: saldo akhir tidak bersambung/);
});

// ── pencocokan nama file ke rekening ─────────────────────────────────────────

test("nama lampiran WhatsApp dikenali walau spasi jadi underscore + suffix uuid", () => {
  // Bentuk NYATA yang ditolak prod 18 Sep 2026: openclaw menyimpan lampiran WA
  // dengan underscore dan menempelkan uuid. Pencocokan lama (buang spasi saja)
  // gagal, lalu file Finance ditolak dengan "rekening tidak dikenali".
  assert.equal(cocokLabelFile("INDEX 131", "INDEX_131_170926---94521364-6f3b-4dab-8125-92eb4660a394.pdf"), true);
  assert.equal(cocokLabelFile("INDEX 336", "INDEX_336_170926---d0c1742e-3fa0-44ba-9325-2e6bf6c689ba.pdf"), true);
});

test("bentuk nama file lain yang dipakai admin tetap dikenali", () => {
  // Folder sumber punya spasi ganda dan ekstensi rusak — dua-duanya nyata.
  assert.equal(cocokLabelFile("INDEX 131", "INDEX 131  020926.pdf"), true);
  assert.equal(cocokLabelFile("BJTM", "BJTM 030926 pdf"), true);
  assert.equal(cocokLabelFile("MDR 038", "MDR 038 040926.pdf"), true);
  assert.equal(cocokLabelFile("MDR 038", "mdr-038-040926.PDF"), true);
});

test("rekening berlabel mirip TIDAK saling tertukar", () => {
  // Penjaga terpenting: normalisasi tak boleh sampai menyamakan 881 dengan 890.
  assert.equal(cocokLabelFile("INDEX 881", "INDEX_890_170926.pdf"), false);
  assert.equal(cocokLabelFile("INDEX 890", "INDEX_881_170926.pdf"), false);
  assert.equal(cocokLabelFile("MDR 734", "MDR_038_040926.pdf"), false);
  // Label harus di AWAL nama file, bukan di tengah.
  assert.equal(cocokLabelFile("BJTM", "koran_BJTM_030926.pdf"), false);
});

// ── pernyataan nihil ─────────────────────────────────────────────────────────

test("pernyataan nihil dikenali dalam bentuk yang diketik Finance", () => {
  // Bentuk yang ditanyakan Finance 18 Sep 2026: rekening tanpa transaksi tak
  // bisa diunduh dari internet banking, jadi ia dinyatakan lewat teks.
  assert.deepEqual(parseNihil("#KORAN BNI nihil 17/9/2026"), { label: "BNI", tanggal: "2026-09-17" });
  assert.deepEqual(parseNihil("#koran nihil BNI 17-09-2026"), { label: "BNI", tanggal: "2026-09-17" });
  assert.deepEqual(parseNihil("#KORAN INDEX 336 NIHIL 17/9/26"), { label: "INDEX 336", tanggal: "2026-09-17" });
  // Tanpa tanggal → null, artinya "pakai hari ini" (diputuskan pemanggil).
  assert.deepEqual(parseNihil("#koran bni nihil"), { label: "bni", tanggal: null });
});

test("angka rekening TIDAK salah dibaca sebagai tanggal", () => {
  // "INDEX 336" memuat angka; kalau pola tanggalnya longgar, 336 bisa tertelan
  // jadi tanggal dan labelnya jadi kosong.
  assert.deepEqual(parseNihil("#KORAN INDEX 336 nihil"), { label: "INDEX 336", tanggal: null });
  assert.deepEqual(parseNihil("#KORAN MDR 038 nihil"), { label: "MDR 038", tanggal: null });
});

test("pesan #KORAN biasa BUKAN pernyataan nihil", () => {
  // Kalau ini salah, setoran koran sungguhan akan dicatat sebagai hari nihil —
  // menghapus mutasi yang sudah masuk.
  assert.equal(parseNihil("#KORAN mandiri 17/9/2026"), null);
  assert.equal(parseNihil("#koran index 336 17/9/2026"), null);
  assert.equal(parseNihil(null), null);
  // Kata 'nihil' di percakapan tanpa hashtag juga tidak memicu apa pun.
  assert.equal(parseNihil("hari ini bni nihil kok"), null);
});

// ── puteran yang hanya dikenali lewat nomor rekening sendiri ─────────────────

test("nomor rekening sendiri di deskripsi = sinyal internal", () => {
  // Kasus NYATA 18 Sep 2026 yang lolos ke resume sebagai uang masuk riil:
  // BJTM debit 50 jt 'IB:008 1420075012038' (nomor rekening Mandiri MDR 038)
  // berpasangan dengan kredit 50 jt di MDR 038, 44 detik berselang. Tak satu
  // kata pun dari daftar 'berbau internal' muncul di kedua sisi.
  const nomor = ["1420075012038", "0321018688", "7001088131"];
  assert.equal(berbauInternal("IB:008 1420075012038", nomor), true);
  // Nomor dengan pemisah tetap kena (bank menulis formatnya semaunya).
  assert.equal(berbauInternal("TRF KE 1420-0750-12038", nomor), true);
  // Tanpa daftar nomor, perilaku lama dipertahankan.
  assert.equal(berbauInternal("IB:008 1420075012038"), false);
});

test("nomor pendek dan nominal TIDAK dianggap nomor rekening", () => {
  // Penjaga: kalau ambang panjangnya dilepas, angka nominal atau nomor
  // referensi bisa kebetulan cocok dan menandai transaksi pihak ketiga sebagai
  // puteran — uang masuk riil hilang dari laporan tanpa jejak.
  assert.equal(berbauInternal("PEMBAYARAN INV 12345", ["12345"]), false);
  assert.equal(berbauInternal("RS WAJAK HUSADA", ["1420075012038"]), false);
  assert.equal(berbauInternal("KU- RSUD SUKOWATI 0321", ["0321018688"]), false);
});

test("rekening nihil diringkas jadi satu baris, tanpa menghilangkan nama", () => {
  // 18 Sep 2026 punya 8 rekening nihil; delapan baris mendorong angka yang
  // justru mau dibaca keluar dari layar pertama WhatsApp.
  const banyak = formatResume(
    ringkasan({
      rekening_nihil: [
        { label_file: "BNI", oleh: "renika" },
        { label_file: "HANA", oleh: "renika" },
        { label_file: "NIAGA", oleh: "renika" },
      ],
    }),
  );
  const barisNihil = banyak.split("\n").filter((b) => b.includes("nihil"));
  assert.equal(barisNihil.length, 1, "harus satu baris saja");
  assert.match(barisNihil[0], /3 rekening nihil/);
  assert.match(barisNihil[0], /BNI, HANA, NIAGA/);
  assert.match(barisNihil[0], /dinyatakan renika/);
});

test("satu rekening nihil tetap berbunyi wajar (bukan '1 rekening nihil')", () => {
  const satu = formatResume(ringkasan({ rekening_nihil: [{ label_file: "BNI", oleh: "Ika" }] }));
  assert.match(satu, /_BNI: nihil, tanpa transaksi \(dinyatakan Ika\)_/);
});

test("pernyata berbeda disebut semua, tanpa diulang per rekening", () => {
  // Kalau dua orang menyatakan di hari yang sama, jejaknya tak boleh hilang
  // hanya karena barisnya diringkas.
  const teks = formatResume(
    ringkasan({
      rekening_nihil: [
        { label_file: "BNI", oleh: "renika" },
        { label_file: "HANA", oleh: "Ika" },
        { label_file: "NIAGA", oleh: "renika" },
      ],
    }),
  );
  const b = teks.split("\n").filter((x) => x.includes("nihil"));
  assert.equal(b.length, 1);
  assert.match(b[0], /dinyatakan renika, Ika/);
});

// ── triage dari WhatsApp + rekonsiliasi ──────────────────────────────────────

test("perintah triage dikenali beserta ragam kata kategorinya", () => {
  assert.deepEqual(parseTriage("#KORAN triage T1 uang masuk"), { kode: "T1", kategori: "uang_masuk_riil" });
  assert.deepEqual(parseTriage("#koran triage t2 puteran"), { kode: "T2", kategori: "puteran_internal" });
  assert.deepEqual(parseTriage("#KORAN triage T3 bunga"), { kode: "T3", kategori: "bunga" });
  assert.deepEqual(parseTriage("#KORAN triage T4 pengeluaran"), { kode: "T4", kategori: "pengeluaran" });
});

test("kategori tak dikenal DIBEDAKAN dari bukan-perintah", () => {
  // Bedanya menentukan balasan: yang satu dibalas panduan, yang lain didiamkan.
  // Kalau disamakan, salah ketik kategori akan senyap — dan baris tertahan
  // mengendap tanpa ada yang tahu perintahnya tak masuk.
  assert.deepEqual(parseTriage("#KORAN triage T1 entah apa"), { kode: "T1", kategori: null });
  assert.equal(parseTriage("#KORAN mandiri 18/9/2026"), null);
  assert.equal(parseTriage("triage T1 uang masuk"), null, "tanpa hashtag bukan perintah");
  assert.equal(parseTriage(null), null);
});

test("draft menunjukkan jembatan kredit koran → uang masuk", () => {
  // 18 Sep 2026: Finance melihat 'masuk Rp 338 jt' di balasan ingest lalu angka
  // lain di draft, dan harus mengurangi sendiri untuk menemukan selisihnya.
  const r = ringkasan();
  const draft = formatDraftKonfirmasi(formatResume(r), "R12", r);
  assert.match(draft, /\*Rekonsiliasi\*/);
  assert.match(draft, /MDR 038: Rp 49\.231\.797 · puteran −Rp 4\.000\.000 = Rp 45\.231\.797/);
  assert.match(draft, /BJTM: Rp 17\.176\.320 · tertahan −Rp 3\.676\.320 = Rp 13\.500\.000/);
});

test("rekening tanpa potongan TIDAK ikut blok rekonsiliasi", () => {
  // Blok ini untuk MENJELASKAN selisih; rekening yang angkanya utuh tak punya
  // yang perlu dijelaskan, dan menampilkannya cuma memanjangkan pesan.
  const r = ringkasan({
    per_rekening: [
      { label_file: "BNI", nama_bank: "Bank BNI", uang_masuk: 5_000_000, puteran_keluar: 0,
        kredit_koran: 5_000_000, puteran_masuk: 0, tertahan: 0, lain: 0 },
    ],
  });
  const draft = formatDraftKonfirmasi(formatResume(r), "R12", r);
  assert.doesNotMatch(draft, /Rekonsiliasi/);
});

test("baris tertahan disebut dengan nomor rujukan + cara memutuskannya", () => {
  const r = ringkasan({
    tertahan_detail: [{ kode: "T1", label_file: "BJTM", nominal: 4_600_000, deskripsi: "" }],
  });
  const draft = formatDraftKonfirmasi(formatResume(r), "R12", r);
  assert.match(draft, /T1 · BJTM Rp 4\.600\.000 — \(deskripsi kosong\)/);
  assert.match(draft, /#KORAN triage T1 uang masuk/);
});
