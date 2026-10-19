// F92 — Export PDF generik untuk tabel dashboard.
//
// Dipakai tombol "Export PDF" di ExportButton: browser mengirim judul + header + baris
// yang SAMA dengan yang ditulis ke CSV, server hanya menata ulang jadi PDF. Tak ada
// query atau angka baru di sini, jadi PDF tak bisa berbeda dari yang tampil di layar.
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

export const MAKS_BARIS = 5000;
export const MAKS_KOLOM = 20;
const MAKS_SEL = 160;
const PAD = 3;
const FONT = 7.5;

export interface TabelPdfInput {
  judul: string;
  header: string[];
  baris: string[][];
}

/** Validasi body mentah; kembalikan pesan galat atau data bersih. */
export function cekTabelPdf(body: unknown): { ok: true; data: TabelPdfInput } | { ok: false; error: string } {
  const b = body as Partial<TabelPdfInput> | null;
  if (!b || typeof b.judul !== "string" || !Array.isArray(b.header) || !Array.isArray(b.baris)) {
    return { ok: false, error: "body harus {judul, header[], baris[][]}" };
  }
  if (b.header.length === 0 || b.header.length > MAKS_KOLOM) return { ok: false, error: `kolom 1-${MAKS_KOLOM}` };
  if (b.baris.length === 0) return { ok: false, error: "tidak ada baris" };
  if (b.baris.length > MAKS_BARIS) return { ok: false, error: `maksimal ${MAKS_BARIS} baris` };
  const sel = (v: unknown) => (v === null || v === undefined ? "" : String(v));
  const header = b.header.map(sel);
  const baris = b.baris.map((r) => {
    const arr = Array.isArray(r) ? r.map(sel) : [];
    while (arr.length < header.length) arr.push("");
    return arr.slice(0, header.length);
  });
  return { ok: true, data: { judul: sel(b.judul).slice(0, 120) || "Laporan", header, baris } };
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
  const doc = new PDFDocumentKlass({
    size: "A4", layout: "landscape", margin: MARGIN, bufferPages: true,
    info: { Title: bersih(input.judul), Author: "WRG-OS" },
  });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const selesai = new Promise<Buffer>((res) => doc.on("end", () => res(Buffer.concat(chunks))));

  const cetak = new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta", dateStyle: "long", timeStyle: "short" });
  const BATAS = HAL_T - MARGIN - 18;
  const header = input.header.map((h) => bersih(h));
  const baris = input.baris.map((r) => r.map((s) => bersih(s.length > MAKS_SEL ? `${s.slice(0, MAKS_SEL)}...` : s)));
  const lebar = lebarKolom(header, baris);
  const xKolom = lebar.map((_, i) => MARGIN + lebar.slice(0, i).reduce((a, b) => a + b, 0));

  if (existsSync(KOP)) {
    doc.image(KOP, MARGIN, MARGIN, { width: LEBAR });
    doc.y = MARGIN + LEBAR * KOP_RASIO + 10;
  }
  doc.fillColor(C.kepala).font("Helvetica-Bold").fontSize(14).text(bersih(input.judul), MARGIN, doc.y);
  doc.fillColor(C.redup).font("Helvetica").fontSize(8)
    .text(`${baris.length} baris · dicetak ${cetak}${opts.oleh ? ` oleh ${bersih(opts.oleh)}` : ""}`, MARGIN, doc.y + 2);
  doc.y += 8;

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

  const hal = doc.bufferedPageRange();
  for (let i = 0; i < hal.count; i++) {
    doc.switchToPage(hal.start + i);
    doc.fillColor(C.redup).font("Helvetica").fontSize(7)
      .text(`WRG-OS · halaman ${i + 1} dari ${hal.count}`, MARGIN, HAL_T - MARGIN - 6, { width: LEBAR, align: "right", lineBreak: false });
  }
  doc.end();
  return selesai;
}
