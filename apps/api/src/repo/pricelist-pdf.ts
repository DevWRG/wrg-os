// Export PDF daftar harga keagenan — dokumen yang dibawa AM ke faskes.
//
// Sengaja dibuat di server, bukan window.print() di browser: hasilnya harus sama
// di semua perangkat (AM buka dari laptop maupun HP), dan yang keluar file .pdf
// betulan, bukan "silakan pilih Save as PDF di dialog print". Pola yang sama
// dengan deck PPTX WatchPoint (repo/watchpoint-pptx.ts).
//
// Isi dokumen dibatasi ke kolom yang boleh dibaca faskes: Price List, Diskon
// Maks, Nett terendah, Nett+PPN. TIDAK ADA HPP/margin — sumbernya
// listPublishedKeagenan yang memang tidak pernah men-SELECT kolom itu, jadi
// kebocoran tidak bisa terjadi lewat jalur ini walau nanti ada yang menambah
// kolom di dokumen.

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import PDFDocumentKlass from "pdfkit";

import { listPublishedKeagenan, PERIODE_DEFAULT, type PricebookPublishedRow } from "./pricebook.js";

// Halaman MENDATAR: 7 kolom harga tidak muat rapi di potret, dan tabel harga yang
// kolomnya berdesakan adalah cara paling mudah salah kutip angka.
const MARGIN = 32;
// Kop surat WRG + Wahana LifeLine, dicetak di SETIAP halaman (dokumen ini keluar
// ke faskes, tiap lembarnya harus berdiri sendiri sebagai dokumen resmi).
//
// Aset dibaca dari pohon sumber, bukan dari dist/: `tsc` tidak menyalin file
// non-TS, jadi path relatif ke dist/repo/ akan kosong setelah build.
// dist/repo/pricelist-pdf.js → ../../assets = apps/api/assets ✓
const KOP = fileURLToPath(new URL("../../assets/kop-surat.png", import.meta.url));
const KOP_RASIO = 148 / 2204; // tinggi/lebar aset
// Aset diambil dari `template kop.docx` (word/media/image2.png) — 2204x148,
// ~204 DPI saat digambar selebar area cetak.
//
// Alpha-nya SUDAH diratakan ke putih, dan itu disengaja: untuk PNG ber-alpha
// pdfkit harus memisah kanal jadi SMask terpisah (dekompres + kompres ulang tiap
// generate), sedangkan PNG tanpa alpha datanya disalin apa adanya. Terukur pada
// dokumen 44 halaman: 76 ms → 13 ms, dan PDF-nya justru mengecil 44 KB → 38 KB.
// Kalau nanti aset ini diganti, ratakan dulu alpha-nya ke putih.

const LEBAR = 842 - MARGIN * 2; // A4 landscape
const C = { teks: "#0f172a", redup: "#64748b", garis: "#e2e8f0", kepala: "#0f766e", zebra: "#f8fafc" };

interface Kolom {
  judul: string;
  lebar: number;
  align?: "left" | "right";
  nilai: (r: PricebookPublishedRow) => string;
}

const rp = (n: number): string =>
  "Rp " + Math.round(n).toLocaleString("id-ID");

// Jumlah lebar kolom HARUS == LEBAR. Kalau melebihi, kolom terakhir terpotong di
// tepi kanan — dan yang terpotong justru Nett+PPN, angka yang dipakai faskes.
// Dijaga oleh pemeriksaan di bawah, bukan cuma oleh kehati-hatian.
// Diskon, Nett, dan Nett+PPN sengaja TIDAK dicetak (keputusan user 13 Agt 2026).
// Dokumen ini beredar ke luar; diskon maksimal & harga lantai adalah batas
// negosiasi internal, bukan angka yang perlu dibaca faskes. Ketiganya tetap ada
// di layar untuk AM (tab Harga per Produk) dan di Export Excel.
const KOLOM: Kolom[] = [
  { judul: "Kode", lebar: 110, nilai: (r) => r.productKode ?? r.kode ?? "-" },
  { judul: "Nama Produk", lebar: 356, nilai: (r) => r.nama },
  { judul: "Brand", lebar: 130, nilai: (r) => r.brand },
  { judul: "Kemasan", lebar: 82, nilai: (r) => r.kemasan ?? "-" },
  { judul: "Price List", lebar: 100, align: "right", nilai: (r) => rp(r.priceList) },
];

const TOTAL_LEBAR = KOLOM.reduce((n, k) => n + k.lebar, 0);
if (TOTAL_LEBAR !== LEBAR) {
  throw new Error(`lebar kolom PDF = ${TOTAL_LEBAR}, harus ${LEBAR} (A4 landscape - margin)`);
}

export interface PdfOpts {
  periode?: string;
  /** Baris yang dicentang user. Kosong/undefined = semua yang published. */
  rowNos?: number[];
  /** Nama yang dicetak di footer sebagai pencetak dokumen. */
  oleh?: string | null;
}

export async function pricelistPdf(opts: PdfOpts = {}): Promise<Buffer> {
  const periode = opts.periode || PERIODE_DEFAULT;
  const semua = await listPublishedKeagenan({ periode, limit: 20000 });
  const pilih = opts.rowNos?.length ? new Set(opts.rowNos) : null;
  const rows = pilih ? semua.filter((r) => pilih.has(r.rowNo)) : semua;

  const doc = new PDFDocumentKlass({ size: "A4", layout: "landscape", margin: MARGIN,
    info: { Title: `Daftar Harga Keagenan WRG ${periode}`, Author: "WRG-OS" } });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const selesai = new Promise<Buffer>((res) => doc.on("end", () => res(Buffer.concat(chunks))));

  // Tanggal cetak dalam WIB — dokumen ini dibawa ke lapangan, jamnya harus jam
  // orang yang membawanya, bukan UTC server.
  const cetak = new Date().toLocaleString("id-ID", {
    timeZone: "Asia/Jakarta", dateStyle: "long", timeStyle: "short",
  });

  // Kalau aset kop hilang (mis. deploy yang tidak menyertakan folder assets),
  // dokumen tetap terbit tanpa kop — daftar harga yang gagal dicetak lebih
  // merugikan daripada daftar harga tanpa logo.
  const adaKop = existsSync(KOP);
  const TINGGI_KOP = adaKop ? LEBAR * KOP_RASIO : 0;

  let halaman = 0;
  const kepalaHalaman = () => {
    halaman += 1;
    let y = MARGIN;
    if (adaKop) {
      doc.image(KOP, MARGIN, y, { width: LEBAR });
      y += TINGGI_KOP + 8;
    }
    doc.fillColor(C.kepala).font("Helvetica-Bold").fontSize(14)
      .text("Daftar Harga Keagenan WRG", MARGIN, y);
    doc.fillColor(C.redup).font("Helvetica").fontSize(8)
      .text(`Periode ${periode} · ${rows.length} produk · dicetak ${cetak}`
            + (opts.oleh ? ` oleh ${opts.oleh}` : ""),
        MARGIN, y + 18);
    barisKepala(y + 36);
  };

  const barisKepala = (y: number) => {
    let x = MARGIN;
    doc.save().rect(MARGIN, y, LEBAR, 16).fill(C.kepala).restore();
    doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(7.5);
    for (const k of KOLOM) {
      doc.text(k.judul.toUpperCase(), x + 4, y + 5,
        { width: k.lebar - 8, align: k.align ?? "left", lineBreak: false });
      x += k.lebar;
    }
    doc.y = y + 16;
  };

  kepalaHalaman();

  const TINGGI = 15;
  const BATAS = 595 - MARGIN - 26; // sisakan ruang footer
  rows.forEach((r, i) => {
    if (doc.y + TINGGI > BATAS) {
      footer();
      doc.addPage();
      kepalaHalaman();
    }
    const y = doc.y;
    if (i % 2 === 1) doc.save().rect(MARGIN, y, LEBAR, TINGGI).fill(C.zebra).restore();
    let x = MARGIN;
    doc.font("Helvetica").fontSize(7.5).fillColor(C.teks);
    for (const k of KOLOM) {
      // lineBreak:false + ellipsis: satu nama produk panjang tidak boleh
      // mendorong tinggi baris dan merusak keselarasan kolom harga di sebelahnya.
      doc.text(k.nilai(r), x + 4, y + 4,
        { width: k.lebar - 8, align: k.align ?? "left", lineBreak: false, ellipsis: true });
      x += k.lebar;
    }
    doc.save().moveTo(MARGIN, y + TINGGI).lineTo(MARGIN + LEBAR, y + TINGGI)
      .strokeColor(C.garis).lineWidth(0.5).stroke().restore();
    doc.y = y + TINGGI;
  });

  function footer() {
    const y = 595 - MARGIN - 18;
    // Catatan kaki mengikuti isi dokumen: sejak kolom Nett/PPN dilepas, penjelasan
    // soal lantai harga & PPN dari Nett tidak lagi relevan di sini.
    doc.fillColor(C.redup).font("Helvetica").fontSize(7)
      .text("Price List belum termasuk PPN. Harga dapat berubah sewaktu-waktu.",
        MARGIN, y, { width: LEBAR - 60, lineBreak: false })
      .text(`Hal. ${halaman}`, MARGIN + LEBAR - 56, y, { width: 56, align: "right", lineBreak: false });
  }
  footer();

  doc.end();
  return selesai;
}
