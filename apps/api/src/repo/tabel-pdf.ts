// F92 — Export PDF generik untuk tabel dashboard.
//
// Dipakai Report Library (repo/report-library.ts): baris sudah diratakan jadi string
// dari fungsi repo yang sama dengan halaman sumbernya, di sini hanya ditata jadi PDF.
//
// Dibuat di server (pdfkit), pola sama dengan senin-brief-pdf.ts. Helvetica bawaan PDF
// tak punya emoji / ≥ / →, jadi teks dibersihkan lewat `bersih` yang sama.

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import PDFDocumentKlass from "pdfkit";

import { bersih } from "./senin-brief-pdf.js";

const MARGIN = 28;
const HAL_L = 842; // A4 lanskap
const HAL_T = 595;
const LEBAR = HAL_L - MARGIN * 2;
const KOP = fileURLToPath(new URL("../../assets/kop-surat.png", import.meta.url));
const KOP_RASIO = 148 / 2204;
const C = { teks: "#0f172a", redup: "#64748b", garis: "#e2e8f0", kepala: "#0f766e", zebra: "#f8fafc" };

const MAKS_SEL = 160;
const PAD = 3;
const FONT = 7.5;

export interface TabelPdfInput {
  judul: string;
  /** Baris "label: nilai" di bawah judul (ringkasan angka utama laporan). */
  ringkasan?: { label: string; nilai: string }[];
  header: string[];
  baris: string[][];
}

/** Lebar kolom proporsional isi (dibatasi), total = LEBAR. Fungsi murni (dites). */
export function lebarKolom(header: string[], baris: string[][], total = LEBAR): number[] {
  const bobot = header.map((h, i) => {
    let maks = h.length;
    for (const r of baris.slice(0, 200)) maks = Math.max(maks, Math.min(r[i]?.length ?? 0, 40));
    return Math.max(6, Math.min(maks, 40));
  });
  const jml = bobot.reduce((a, b) => a + b, 0);
  return bobot.map((w) => (w / jml) * total);
}

export function namaFileTabelPdf(judul: string, tanggal = new Date()): string {
  const slug = judul.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "laporan";
  return `${slug}-${tanggal.toISOString().slice(0, 10)}.pdf`;
}

export async function tabelPdf(input: TabelPdfInput, opts: { oleh?: string | null } = {}): Promise<Buffer> {
  return susunPdf([input], input.judul, opts);
}

/** Beberapa laporan dalam SATU PDF: satu kop, tiap laporan mulai di halaman baru, nomor halaman berlanjut. */
export async function tabelPdfGabungan(bagian: TabelPdfInput[], judulDok: string, opts: { oleh?: string | null } = {}): Promise<Buffer> {
  return susunPdf(bagian, judulDok, opts);
}

async function susunPdf(bagian: TabelPdfInput[], judulDok: string, opts: { oleh?: string | null }): Promise<Buffer> {
  const doc = new PDFDocumentKlass({
    size: "A4", layout: "landscape", margin: MARGIN, bufferPages: true,
    info: { Title: bersih(judulDok), Author: "WRG-OS" },
  });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const selesai = new Promise<Buffer>((res) => doc.on("end", () => res(Buffer.concat(chunks))));

  const cetak = new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta", dateStyle: "long", timeStyle: "short" });
  const BATAS = HAL_T - MARGIN - 18;
  const gabungan = bagian.length > 1;

  if (existsSync(KOP)) {
    doc.image(KOP, MARGIN, MARGIN, { width: LEBAR });
    doc.y = MARGIN + LEBAR * KOP_RASIO + 10;
  }
  if (gabungan) {
    doc.fillColor(C.redup).font("Helvetica").fontSize(8)
      .text(`${bersih(judulDok)} · ${bagian.length} laporan · dicetak ${cetak}${opts.oleh ? ` oleh ${bersih(opts.oleh)}` : ""}`, MARGIN, doc.y);
    doc.y += 6;
  }

  bagian.forEach((input, idx) => {
    if (idx > 0) doc.addPage();
    const header = input.header.map((h) => bersih(h));
    const baris = input.baris.map((r) => r.map((s) => bersih(s.length > MAKS_SEL ? `${s.slice(0, MAKS_SEL)}...` : s)));
    const lebar = lebarKolom(header, baris);
    const xKolom = lebar.map((_, i) => MARGIN + lebar.slice(0, i).reduce((a, b) => a + b, 0));

    doc.fillColor(C.kepala).font("Helvetica-Bold").fontSize(14).text(bersih(input.judul), MARGIN, doc.y);
    doc.fillColor(C.redup).font("Helvetica").fontSize(8)
      .text(
        gabungan ? `${baris.length} baris` : `${baris.length} baris · dicetak ${cetak}${opts.oleh ? ` oleh ${bersih(opts.oleh)}` : ""}`,
        MARGIN, doc.y + 2,
      );
    doc.y += 6;

    // Ringkasan: dua kolom label/nilai, sebelum tabel.
    const ring = (input.ringkasan ?? []).map((r) => ({ label: bersih(r.label), nilai: bersih(r.nilai) }));
    if (ring.length > 0) {
      const kolW = LEBAR / 2;
      const y0 = doc.y;
      ring.forEach((r, i) => {
        const x = MARGIN + (i % 2) * kolW;
        const y = y0 + Math.floor(i / 2) * 13;
        doc.fillColor(C.redup).font("Helvetica").fontSize(8).text(`${r.label}:`, x, y, { width: 150, lineBreak: false });
        doc.fillColor(C.teks).font("Helvetica-Bold").fontSize(8).text(r.nilai, x + 150, y, { width: kolW - 156, lineBreak: false, ellipsis: true });
      });
      doc.y = y0 + Math.ceil(ring.length / 2) * 13 + 6;
    }

    const kepala = (y: number) => {
      doc.font("Helvetica-Bold").fontSize(FONT);
      const tinggi = Math.max(...header.map((h, i) => doc.heightOfString(h, { width: lebar[i] - PAD * 2 }))) + PAD * 2;
      doc.save().rect(MARGIN, y, LEBAR, tinggi).fill(C.kepala).restore();
      doc.fillColor("#ffffff");
      header.forEach((h, i) => doc.text(h, xKolom[i] + PAD, y + PAD, { width: lebar[i] - PAD * 2 }));
      doc.y = y + tinggi;
    };
    kepala(doc.y);

    baris.forEach((r, n) => {
      doc.font("Helvetica").fontSize(FONT);
      const tinggi = Math.max(...r.map((s, i) => doc.heightOfString(s, { width: lebar[i] - PAD * 2 }))) + PAD * 2;
      if (doc.y + tinggi > BATAS) { doc.addPage(); kepala(MARGIN); }
      const y = doc.y;
      if (n % 2 === 1) doc.save().rect(MARGIN, y, LEBAR, tinggi).fill(C.zebra).restore();
      doc.fillColor(C.teks).font("Helvetica").fontSize(FONT);
      r.forEach((s, i) => doc.text(s, xKolom[i] + PAD, y + PAD, { width: lebar[i] - PAD * 2 }));
      doc.save().moveTo(MARGIN, y + tinggi).lineTo(MARGIN + LEBAR, y + tinggi).strokeColor(C.garis).lineWidth(0.4).stroke().restore();
      doc.y = y + tinggi;
    });
  });

  const hal = doc.bufferedPageRange();
  for (let i = 0; i < hal.count; i++) {
    doc.switchToPage(hal.start + i);
    // Footer ada di bawah margin bawah: tanpa ini pdfkit mengira teks meluap dan
    // menambah halaman kosong di akhir dokumen.
    doc.page.margins.bottom = 0;
    doc.fillColor(C.redup).font("Helvetica").fontSize(7)
      .text(`WRG-OS · halaman ${i + 1} dari ${hal.count}`, MARGIN, HAL_T - MARGIN - 6, { width: LEBAR, align: "right", lineBreak: false });
  }
  doc.end();
  return selesai;
}
