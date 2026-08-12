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

import PDFDocumentKlass from "pdfkit";

import { listPublishedKeagenan, PERIODE_DEFAULT, type PricebookPublishedRow } from "./pricebook.js";

// Halaman MENDATAR: 7 kolom harga tidak muat rapi di potret, dan tabel harga yang
// kolomnya berdesakan adalah cara paling mudah salah kutip angka.
const MARGIN = 32;
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
const KOLOM: Kolom[] = [
  { judul: "Kode", lebar: 96, nilai: (r) => r.productKode ?? r.kode ?? "-" },
  { judul: "Nama Produk", lebar: 232, nilai: (r) => r.nama },
  { judul: "Brand", lebar: 84, nilai: (r) => r.brand },
  { judul: "Kemasan", lebar: 64, nilai: (r) => r.kemasan ?? "-" },
  { judul: "Price List", lebar: 84, align: "right", nilai: (r) => rp(r.priceList) },
  { judul: "Diskon", lebar: 44, align: "right", nilai: (r) => `${Math.round(r.diskonMaks * 100)}%` },
  { judul: "Nett", lebar: 84, align: "right", nilai: (r) => rp(r.hargaNett) },
  { judul: "Nett + PPN", lebar: 90, align: "right", nilai: (r) => rp(r.nettPpn) },
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

  let halaman = 0;
  const kepalaHalaman = () => {
    halaman += 1;
    doc.fillColor(C.kepala).font("Helvetica-Bold").fontSize(14)
      .text("Daftar Harga Keagenan WRG", MARGIN, MARGIN);
    doc.fillColor(C.redup).font("Helvetica").fontSize(8)
      .text(`Periode ${periode} · ${rows.length} produk · dicetak ${cetak}`
            + (opts.oleh ? ` oleh ${opts.oleh}` : ""),
        MARGIN, MARGIN + 18);
    barisKepala(MARGIN + 36);
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
    doc.fillColor(C.redup).font("Helvetica").fontSize(7)
      .text("Nett adalah harga TERENDAH yang boleh dikutip tanpa izin Direksi. PPN 11% dihitung dari Nett, bukan dari Price List.",
        MARGIN, y, { width: LEBAR - 60, lineBreak: false })
      .text(`Hal. ${halaman}`, MARGIN + LEBAR - 56, y, { width: 56, align: "right", lineBreak: false });
  }
  footer();

  doc.end();
  return selesai;
}
