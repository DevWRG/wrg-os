// F170 Komite KSO — PDF SPH KSO (issue #2297). Pola & kop surat sama dengan SPH penjualan (sph-pdf.ts, pdfkit):
// file .pdf betulan, identik di semua perangkat. Semua isi diambil APA ADANYA dari snapshot kso.sph (migrasi 312),
// tak ada angka yang dihitung ulang selain terbilang.
//
// Isi (keputusan product owner 12 Nov 2026): penawaran KSO per test untuk satu faskes — alat, jumlah unit, harga per
// test (BELUM termasuk PPN 11%), masa KSO, volume minimum, ketentuan wajib dari mandat, masa berlaku 30 hari,
// ditandatangani Direktur. Angka internal (HPP, margin, batas bawah mandat) TIDAK pernah dicetak.

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import PDFDocumentKlass from "pdfkit";

import { tanggalIndo, terbilangRupiah } from "../lib/sph-cetak.js";
import { namaTampilFaskes } from "./kso-format.js";
import type { SphKso } from "./kso-sph.js";
import { bersih } from "./senin-brief-pdf.js";

const MARGIN = 48;
const HAL_L = 595; // A4 potret
const HAL_T = 842;
const LEBAR = HAL_L - MARGIN * 2;
const KOP = fileURLToPath(new URL("../../assets/kop-surat.png", import.meta.url));
const KOP_RASIO = 148 / 2204;
const BAWAH = HAL_T - MARGIN - 20;

const C = { teks: "#0f172a", redup: "#64748b", garis: "#cbd5e1", kepala: "#0f766e", zebra: "#f8fafc" };
const PERUSAHAAN = "PT Wahana Rizky Gumilang";

const rp = (n: number): string => "Rp " + Math.round(n).toLocaleString("id-ID");
const angka = (n: number): string => Math.round(n).toLocaleString("id-ID");

/** Ketentuan wajib mandat (perlindungan WRG, migrasi 224/242) → kalimat surat. Kode tak dikenal dilewati. */
export const KETENTUAN_WAJIB: Record<string, string> = {
  eskalasi_tahunan: "Harga per test dapat disesuaikan setiap tahun sesuai ketentuan dalam Perjanjian Kerja Sama.",
  lapor_test: "Rumah sakit/faskes melaporkan jumlah test yang dikerjakan secara berkala.",
  denda_telat: "Keterlambatan pembayaran dikenakan denda sesuai ketentuan dalam Perjanjian Kerja Sama.",
};

export type SphKsoCetak = Pick<
  SphKso,
  | "nomor" | "harga_per_test" | "jumlah" | "tenor_bulan" | "volume_minimum" | "klausul_wajib" | "faskes_nama"
  | "faskes_kota" | "alat_nama" | "berlaku_hari" | "terbit_at" | "berlaku_sampai" | "ttd_nama" | "ttd_jabatan"
>;

export function namaFileSphKso(s: Pick<SphKso, "nomor">): string {
  const aman = s.nomor.replace(/[^A-Za-z0-9.-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80);
  return `SPH_KSO_${aman || "dokumen"}.pdf`;
}

/** Baris ketentuan surat (urut tetap). Diekspor untuk uji. */
export function ketentuanSphKso(s: SphKsoCetak): string[] {
  const out = [
    `Harga per test belum termasuk PPN 11%.`,
    `Masa kerja sama operasional ${angka(s.tenor_bulan)} bulan sejak alat terpasang dan diserahterimakan.`,
  ];
  if (s.volume_minimum != null && s.volume_minimum > 0) out.push(`Volume minimum ${angka(s.volume_minimum)} test per bulan.`);
  for (const k of s.klausul_wajib ?? []) if (KETENTUAN_WAJIB[k]) out.push(KETENTUAN_WAJIB[k]);
  out.push(
    `Ketentuan rinci kerja sama dituangkan dalam Perjanjian Kerja Sama (PKS) yang ditandatangani kedua belah pihak.`,
    `Penawaran ini berlaku ${angka(s.berlaku_hari)} hari sejak tanggal surat, sampai dengan ${tanggalIndo(new Date(`${s.berlaku_sampai}T00:00:00+07:00`))}.`,
  );
  return out;
}

export async function sphKsoPdf(s: SphKsoCetak, opts: { oleh?: string | null } = {}): Promise<Buffer> {
  const tanggal = tanggalIndo(new Date(s.terbit_at));
  const faskes = namaTampilFaskes(bersih(s.faskes_nama));

  const doc = new PDFDocumentKlass({
    size: "A4",
    layout: "portrait",
    margin: MARGIN,
    bufferPages: true,
    info: { Title: `Surat Penawaran Harga KSO ${s.nomor}`, Author: PERUSAHAAN, Creator: "WRG-OS" },
  });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const selesai = new Promise<Buffer>((res) => doc.on("end", () => res(Buffer.concat(chunks))));

  const adaKop = existsSync(KOP);
  const kop = (): number => {
    let y = MARGIN;
    if (adaKop) {
      doc.image(KOP, MARGIN, y, { width: LEBAR });
      y += LEBAR * KOP_RASIO + 6;
    }
    doc.save().moveTo(MARGIN, y).lineTo(MARGIN + LEBAR, y).lineWidth(1.2).strokeColor(C.kepala).stroke().restore();
    return y + 18;
  };
  const halamanBaru = (): number => {
    doc.addPage();
    return kop();
  };

  let y = kop();

  // ── Judul + nomor ──
  doc.fillColor(C.teks).font("Helvetica-Bold").fontSize(14)
    .text("SURAT PENAWARAN HARGA", MARGIN, y, { width: LEBAR, align: "center", characterSpacing: 0.6 });
  y += 19;
  doc.font("Helvetica").fontSize(9.5).text(`Nomor: ${bersih(s.nomor)}`, MARGIN, y, { width: LEBAR, align: "center" });
  y += 24;

  doc.fontSize(10);
  doc.text(`Tanggal: ${tanggal}`, MARGIN, y, { width: LEBAR, align: "right" });
  doc.text("Perihal", MARGIN, y, { width: 60 });
  doc.text(":  Penawaran Kerja Sama Operasional (KSO)", MARGIN + 60, y, { width: 280 });
  y += 26;

  // ── Tujuan ──
  doc.text("Kepada Yth.", MARGIN, y);
  y = doc.y + 1;
  doc.font("Helvetica-Bold").text(faskes, MARGIN, y, { width: LEBAR * 0.65 });
  y = doc.y;
  doc.font("Helvetica");
  if (s.faskes_kota) {
    doc.text(bersih(s.faskes_kota), MARGIN, y, { width: LEBAR * 0.65 });
    y = doc.y;
  }
  doc.text("di Tempat", MARGIN, y);
  y = doc.y + 14;

  // ── Pembuka ──
  doc.text("Dengan hormat,", MARGIN, y);
  y = doc.y + 6;
  doc.text(
    `Bersama surat ini, ${PERUSAHAAN} dengan hormat menyampaikan penawaran Kerja Sama Operasional (KSO) ` +
      `penyediaan alat laboratorium dengan sistem harga per test, sebagai berikut:`,
    MARGIN, y, { width: LEBAR, align: "justify", lineGap: 2 },
  );
  y = doc.y + 10;

  // ── Tabel penawaran ──
  const kolom = [
    { judul: "No", lebar: 24, align: "center" as const },
    { judul: "Alat", lebar: 225, align: "left" as const },
    { judul: "Jumlah", lebar: 56, align: "right" as const },
    { judul: "Masa KSO", lebar: 84, align: "right" as const },
    { judul: "Harga per Test", lebar: 110, align: "right" as const },
  ];
  if (kolom.reduce((n, k) => n + k.lebar, 0) !== LEBAR) throw new Error("lebar kolom SPH KSO tak sama dengan lebar halaman");
  const PAD = 4;
  doc.save().rect(MARGIN, y, LEBAR, 18).fill(C.kepala).restore();
  let x = MARGIN;
  doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(8.5);
  for (const k of kolom) {
    doc.text(k.judul, x + PAD, y + 5.5, { width: k.lebar - PAD * 2, align: k.align, lineBreak: false });
    x += k.lebar;
  }
  y += 18;
  const nilai = ["1", bersih(s.alat_nama), `${angka(s.jumlah)} unit`, `${angka(s.tenor_bulan)} bulan`, rp(s.harga_per_test)];
  doc.font("Helvetica").fontSize(9);
  const tinggi = Math.max(20, doc.heightOfString(nilai[1], { width: kolom[1].lebar - PAD * 2 }) + 10);
  x = MARGIN;
  doc.fillColor(C.teks);
  kolom.forEach((k, j) => {
    doc.font(j === 4 ? "Helvetica-Bold" : "Helvetica").text(nilai[j], x + PAD, y + 6, {
      width: k.lebar - PAD * 2,
      align: k.align,
      ...(j === 1 ? {} : { lineBreak: false }),
    });
    x += k.lebar;
  });
  y += tinggi;
  doc.save().moveTo(MARGIN, y).lineTo(MARGIN + LEBAR, y).lineWidth(0.5).strokeColor(C.garis).stroke().restore();
  y += 6;
  doc.font("Helvetica-Oblique").fontSize(9).fillColor(C.teks)
    .text(`Terbilang: ${terbilangRupiah(s.harga_per_test)} per test`, MARGIN, y, { width: LEBAR, align: "right" });
  y = doc.y + 16;

  // ── Ketentuan ──
  const ketentuan = ketentuanSphKso(s);
  doc.font("Helvetica").fontSize(9.5);
  const tinggiK = 16 + ketentuan.reduce((n, t) => n + doc.heightOfString(t, { width: LEBAR - 16 }) + 3, 0);
  if (y + tinggiK > BAWAH) y = halamanBaru();
  doc.font("Helvetica-Bold").fontSize(10).fillColor(C.teks).text("Ketentuan", MARGIN, y);
  y = doc.y + 4;
  ketentuan.forEach((t, i) => {
    doc.font("Helvetica").fontSize(9.5);
    doc.text(`${i + 1}.`, MARGIN, y, { width: 16 });
    doc.text(t, MARGIN + 16, y, { width: LEBAR - 16, align: "justify" });
    y = doc.y + 3;
  });
  y += 10;

  // ── Penutup + tanda tangan (tak dipisah halaman) ──
  if (y + 162 > BAWAH) y = halamanBaru();
  doc.font("Helvetica").fontSize(10).fillColor(C.teks).text(
    "Demikian penawaran ini kami sampaikan. Atas perhatian dan kerja samanya, kami ucapkan terima kasih.",
    MARGIN, y, { width: LEBAR, align: "justify", lineGap: 2 },
  );
  y = doc.y + 18;
  const xTtd = MARGIN + LEBAR - 200;
  doc.text("Hormat kami,", xTtd, y, { width: 200 });
  doc.font("Helvetica-Bold").text(PERUSAHAAN, xTtd, doc.y, { width: 200 });
  y = doc.y + 62; // ruang tanda tangan basah & stempel
  doc.font("Helvetica-Bold").fontSize(10).text(bersih(s.ttd_nama), xTtd, y, { width: 200, underline: true });
  doc.font("Helvetica").fontSize(9.5).text(bersih(s.ttd_jabatan ?? "Direktur"), xTtd, doc.y + 1, { width: 200 });

  // ── Footer tiap halaman ──
  const rentang = doc.bufferedPageRange();
  const cetak = new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta", dateStyle: "medium", timeStyle: "short" });
  for (let i = rentang.start; i < rentang.start + rentang.count; i++) {
    doc.switchToPage(i);
    const mb = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    const yf = HAL_T - MARGIN + 8;
    doc.save().moveTo(MARGIN, yf - 6).lineTo(MARGIN + LEBAR, yf - 6).lineWidth(0.5).strokeColor(C.garis).stroke().restore();
    doc.font("Helvetica").fontSize(7).fillColor(C.redup)
      .text(`SPH KSO ${bersih(s.nomor)} · dicetak ${cetak}${opts.oleh ? ` oleh ${bersih(opts.oleh)}` : ""}`,
        MARGIN, yf, { width: LEBAR - 60, lineBreak: false })
      .text(`Hal. ${i - rentang.start + 1}/${rentang.count}`, MARGIN + LEBAR - 60, yf, { width: 60, align: "right", lineBreak: false });
    doc.page.margins.bottom = mb;
  }

  doc.end();
  return selesai;
}
