// F15 — Surat Penawaran Harga (SPH) sebagai PDF A4 resmi dgn kop surat.
//
// Dibuat di server (pdfkit), pola sama dengan pricelist-pdf.ts/senin-brief-pdf.ts:
// hasil identik di semua perangkat, file .pdf betulan (bukan dialog print).
// Semua angka diambil APA ADANYA dari SphDetail (snapshot sph_line_item) — tak
// ada harga yang dihitung ulang di sini selain penjumlahan baris yang sama
// dengan getSphDetail. Ringkasan angka = SphDetail.total (lib/sph-diskon.ts
// totalSph, rumus yang sama dgn draft_text): tanpa diskon tambahan PPN =
// Σ round(nett×1,11)×qty − Σ nett×qty; dengan diskon tambahan baris "Diskon
// tambahan" muncul di antara Subtotal dan PPN, PPN dari DPP setelah diskon.
// Jenjang persetujuan diskon (HoD/Direktur) TIDAK dicetak — urusan internal.
//
// SPH yang belum difinalisasi tetap bisa dicetak untuk ditinjau, tapi tiap
// halamannya bertanda DRAF besar dan tanpa nomor surat.

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import PDFDocumentKlass from "pdfkit";

import { KUNCI_SYARAT, LABEL_SYARAT, NOMOR_DRAF, tanggalIndo, terbilangRupiah } from "../lib/sph-cetak.js";
import { totalSph } from "../lib/sph-diskon.js";
import { bersih } from "./senin-brief-pdf.js";
import type { SphDetail } from "./sph.js";

const MARGIN = 48;
const HAL_L = 595; // A4 potret
const HAL_T = 842;
const LEBAR = HAL_L - MARGIN * 2;
const KOP = fileURLToPath(new URL("../../assets/kop-surat.png", import.meta.url));
const KOP_RASIO = 148 / 2204; // tinggi/lebar aset (lihat pricelist-pdf.ts)
const BAWAH = HAL_T - MARGIN - 20; // batas isi; sisanya footer

const C = { teks: "#0f172a", redup: "#64748b", garis: "#cbd5e1", kepala: "#0f766e", zebra: "#f8fafc", draf: "#b91c1c" };
const PERUSAHAAN = "PT Wahana Rizky Gumilang";

const rp = (n: number): string => "Rp " + Math.round(n).toLocaleString("id-ID");
const persen = (f: number): string => `${(Math.round(f * 10000) / 100).toLocaleString("id-ID")}%`;
const qtyTeks = (n: number): string => n.toLocaleString("id-ID", { maximumFractionDigits: 2 });

export type SphCetak = Pick<
  SphDetail,
  | "status"
  | "customerName"
  | "customerAlamat"
  | "customerKota"
  | "nomorDokumen"
  | "approvedAt"
  | "createdAt"
  | "syarat"
  | "penandaTangan"
  | "items"
> &
  Partial<Pick<SphDetail, "total">>;

export function sphFinal(d: Pick<SphDetail, "status">): boolean {
  return d.status === "approved" || d.status === "sent";
}

export function namaFileSph(d: Pick<SphDetail, "nomorDokumen" | "customerName" | "status">): string {
  const dasar = sphFinal(d) && d.nomorDokumen ? d.nomorDokumen : `DRAF ${d.customerName ?? ""}`;
  const aman = dasar.replace(/[^A-Za-z0-9.-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80);
  return `SPH_${aman || "dokumen"}.pdf`;
}

interface Kolom {
  judul: string;
  lebar: number;
  align: "left" | "right" | "center";
}

export async function sphPdf(d: SphCetak, opts: { oleh?: string | null } = {}): Promise<Buffer> {
  const final = sphFinal(d);
  const tanggal = tanggalIndo(final && d.approvedAt ? new Date(d.approvedAt) : final ? new Date(d.createdAt) : new Date());
  const nomor = final ? d.nomorDokumen ?? "-" : NOMOR_DRAF;

  const baris = d.items.map((it) => ({
    nama: bersih(it.nama),
    qty: it.qty,
    satuan: it.kemasan ? bersih(it.kemasan) : "-",
    hargaList: it.priceList,
    diskon: it.diskonRequested,
    nett: it.hargaNett,
    jumlah: it.hargaNett * it.qty,
  }));
  const adaDiskon = baris.some((b) => b.diskon > 0);
  const t = d.total ?? totalSph(d.items);
  const subtotal = t.nett;
  const total = t.ppn;
  const ppn = t.ppnRp;

  // Kolom: dengan diskon → Harga Satuan = price list, kolom Diskon tampil, Jumlah
  // = nett × qty. Tanpa diskon kolom Diskon disembunyikan dan lebarnya diberikan
  // ke Nama Produk. Jumlah lebar WAJIB == LEBAR (dicek di bawah).
  const kolom: Kolom[] = [
    { judul: "No", lebar: 24, align: "center" },
    { judul: "Nama Produk", lebar: adaDiskon ? 169 : 219, align: "left" },
    { judul: "Qty", lebar: 38, align: "right" },
    { judul: "Satuan", lebar: 62, align: "left" },
    { judul: "Harga Satuan", lebar: 76, align: "right" },
    ...(adaDiskon ? [{ judul: "Diskon", lebar: 50, align: "right" as const }] : []),
    { judul: "Jumlah", lebar: 80, align: "right" },
  ];
  const lebarTotal = kolom.reduce((n, k) => n + k.lebar, 0);
  if (lebarTotal !== LEBAR) throw new Error(`lebar kolom SPH = ${lebarTotal}, harus ${LEBAR}`);
  const nilaiBaris = (b: (typeof baris)[number], i: number): string[] => [
    String(i + 1),
    b.nama,
    qtyTeks(b.qty),
    b.satuan,
    rp(adaDiskon ? b.hargaList : b.nett),
    ...(adaDiskon ? [b.diskon > 0 ? persen(b.diskon) : "-"] : []),
    rp(b.jumlah),
  ];

  const doc = new PDFDocumentKlass({
    size: "A4",
    layout: "portrait",
    margin: MARGIN,
    bufferPages: true, // nomor halaman "x / y" + tanda DRAF digambar sesudah isi selesai
    info: { Title: `Surat Penawaran Harga ${final ? nomor : "(DRAF)"}`, Author: PERUSAHAAN, Creator: "WRG-OS" },
  });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const selesai = new Promise<Buffer>((res) => doc.on("end", () => res(Buffer.concat(chunks))));

  // Kop hilang (deploy tanpa folder assets) → surat tetap terbit tanpa kop.
  const adaKop = existsSync(KOP);
  const TINGGI_KOP = adaKop ? LEBAR * KOP_RASIO : 0;
  const kop = (): number => {
    let y = MARGIN;
    if (adaKop) {
      doc.image(KOP, MARGIN, y, { width: LEBAR });
      y += TINGGI_KOP + 6;
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
  doc.font("Helvetica").fontSize(9.5).fillColor(final ? C.teks : C.draf)
    .text(`Nomor: ${nomor}`, MARGIN, y, { width: LEBAR, align: "center" });
  y += 24;

  // ── Meta (kiri) & tanggal (kanan) ──
  doc.fillColor(C.teks).font("Helvetica").fontSize(10);
  doc.text(`Tanggal: ${tanggal}`, MARGIN, y, { width: LEBAR, align: "right" });
  doc.text("Perihal", MARGIN, y, { width: 60 });
  doc.text(":  Penawaran Harga", MARGIN + 60, y, { width: 220 });
  y += 26;

  // ── Tujuan ──
  doc.text("Kepada Yth.", MARGIN, y);
  y = doc.y + 1;
  doc.font("Helvetica-Bold").text(bersih(d.customerName ?? "-"), MARGIN, y, { width: LEBAR * 0.65 });
  y = doc.y;
  doc.font("Helvetica");
  for (const l of [d.customerAlamat, d.customerKota]) {
    if (l) {
      doc.text(bersih(l), MARGIN, y, { width: LEBAR * 0.65 });
      y = doc.y;
    }
  }
  doc.text("di Tempat", MARGIN, y);
  y = doc.y + 14;

  // ── Pembuka ──
  doc.text("Dengan hormat,", MARGIN, y);
  y = doc.y + 6;
  doc.text(
    `Bersama surat ini, ${PERUSAHAAN} dengan hormat menyampaikan penawaran harga untuk produk berikut:`,
    MARGIN, y, { width: LEBAR, align: "justify", lineGap: 2 },
  );
  y = doc.y + 10;

  // ── Tabel ──
  const FONT = 8.5;
  const PAD = 4;
  const kepalaTabel = (yy: number): number => {
    doc.save().rect(MARGIN, yy, LEBAR, 18).fill(C.kepala).restore();
    let x = MARGIN;
    doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(FONT);
    for (const k of kolom) {
      doc.text(k.judul, x + PAD, yy + 5.5, { width: k.lebar - PAD * 2, align: k.align, lineBreak: false });
      x += k.lebar;
    }
    return yy + 18;
  };
  y = kepalaTabel(y);
  baris.forEach((b, i) => {
    const nilai = nilaiBaris(b, i);
    doc.font("Helvetica").fontSize(FONT);
    // Nama produk panjang dibungkus (bukan dipotong) — di surat resmi nama
    // terpotong lebih buruk daripada baris yang lebih tinggi. Kolom lain satu baris.
    const tinggiNama = doc.heightOfString(nilai[1], { width: kolom[1].lebar - PAD * 2 });
    const tinggi = Math.max(18, tinggiNama + 9);
    if (y + tinggi > BAWAH) {
      y = kepalaTabel(halamanBaru());
    }
    if (i % 2 === 1) doc.save().rect(MARGIN, y, LEBAR, tinggi).fill(C.zebra).restore();
    let x = MARGIN;
    doc.fillColor(C.teks).font("Helvetica").fontSize(FONT);
    kolom.forEach((k, j) => {
      doc.text(nilai[j], x + PAD, y + 5, {
        width: k.lebar - PAD * 2,
        align: k.align,
        ...(j === 1 ? {} : { lineBreak: false, ellipsis: true }),
      });
      x += k.lebar;
    });
    y += tinggi;
    doc.save().moveTo(MARGIN, y).lineTo(MARGIN + LEBAR, y).lineWidth(0.5).strokeColor(C.garis).stroke().restore();
  });

  // ── Ringkasan angka (rata kanan, sejajar kolom Jumlah) ──
  const ringkas: [string, number, boolean][] = [
    ["Subtotal", subtotal, false],
    ...(t.diskonTambahan > 0
      ? ([
          ["Diskon tambahan", -t.diskonTambahan, false],
          ["Subtotal setelah diskon", t.dpp, false],
        ] as [string, number, boolean][])
      : []),
    ["PPN 11%", ppn, false],
    ["Total", total, true],
  ];
  const TINGGI_RINGKAS = ringkas.length * 16 + 30;
  if (y + TINGGI_RINGKAS > BAWAH) y = halamanBaru();
  const lebarNilai = kolom[kolom.length - 1].lebar;
  const xNilai = MARGIN + LEBAR - lebarNilai;
  const lebarLabel = 150;
  const xLabel = xNilai - lebarLabel;
  y += 6;
  for (const [label, n, tebal] of ringkas) {
    if (tebal) {
      doc.save().rect(xLabel, y - 3, lebarLabel + lebarNilai, 18).fill("#e6f2f1").restore();
    }
    doc.fillColor(C.teks).font(tebal ? "Helvetica-Bold" : "Helvetica").fontSize(9.5);
    doc.text(label, xLabel + PAD, y + 1, { width: lebarLabel - PAD * 2, align: "right", lineBreak: false });
    doc.text(n < 0 ? `- ${rp(-n)}` : rp(n), xNilai + PAD, y + 1, { width: lebarNilai - PAD * 2, align: "right", lineBreak: false });
    y += 16;
  }
  y += 4;
  doc.font("Helvetica-Oblique").fontSize(9).fillColor(C.teks)
    .text(`Terbilang: ${terbilangRupiah(total)}`, MARGIN, y, { width: LEBAR, align: "right" });
  y = doc.y + 16;

  // ── Syarat & ketentuan ──
  doc.font("Helvetica").fontSize(9.5);
  const tinggiSyarat =
    16 + KUNCI_SYARAT.reduce((n, k) => n + doc.heightOfString(bersih(d.syarat[k]), { width: LEBAR - 100 }) + 3, 0);
  if (y + tinggiSyarat > BAWAH) y = halamanBaru();
  doc.font("Helvetica-Bold").fontSize(10).fillColor(C.teks).text("Syarat & Ketentuan", MARGIN, y);
  y = doc.y + 4;
  KUNCI_SYARAT.forEach((k, i) => {
    doc.font("Helvetica").fontSize(9.5);
    doc.text(`${i + 1}.`, MARGIN, y, { width: 14 });
    doc.text(LABEL_SYARAT[k], MARGIN + 14, y, { width: 80 });
    doc.text(":", MARGIN + 92, y, { width: 8 });
    doc.text(bersih(d.syarat[k]), MARGIN + 100, y, { width: LEBAR - 100 });
    y = doc.y + 3;
  });
  y += 10;

  // ── Penutup + tanda tangan (tak dipisah halaman) ──
  const TINGGI_TTD = 40 + 30 + 62 + 30;
  if (y + TINGGI_TTD > BAWAH) y = halamanBaru();
  doc.font("Helvetica").fontSize(10).fillColor(C.teks).text(
    "Demikian penawaran ini kami sampaikan. Atas perhatian dan kerja samanya, kami ucapkan terima kasih.",
    MARGIN, y, { width: LEBAR, align: "justify", lineGap: 2 },
  );
  y = doc.y + 18;
  const xTtd = MARGIN + LEBAR - 200;
  doc.text("Hormat kami,", xTtd, y, { width: 200 });
  doc.font("Helvetica-Bold").text(PERUSAHAAN, xTtd, doc.y, { width: 200 });
  y = doc.y + 62; // ruang tanda tangan basah & stempel
  const ttd = d.penandaTangan;
  if (ttd?.nama) {
    doc.font("Helvetica-Bold").fontSize(10).text(bersih(ttd.nama), xTtd, y, { width: 200, underline: true });
    if (ttd.jabatan) doc.font("Helvetica").fontSize(9.5).text(bersih(ttd.jabatan), xTtd, doc.y + 1, { width: 200 });
  } else {
    doc.save().moveTo(xTtd, y + 10).lineTo(xTtd + 170, y + 10).lineWidth(0.6).strokeColor(C.redup).stroke().restore();
    doc.font("Helvetica-Oblique").fontSize(8).fillColor(C.redup)
      .text("(penanda tangan dipilih saat finalisasi)", xTtd, y + 14, { width: 200 });
  }

  // ── Footer + tanda DRAF di tiap halaman ──
  const rentang = doc.bufferedPageRange();
  const cetak = new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta", dateStyle: "medium", timeStyle: "short" });
  for (let i = rentang.start; i < rentang.start + rentang.count; i++) {
    doc.switchToPage(i);
    // Footer ditulis di bawah margin bawah → matikan margin sementara agar
    // pdfkit tak membuat halaman baru otomatis.
    const mb = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    const yf = HAL_T - MARGIN + 8;
    doc.save().moveTo(MARGIN, yf - 6).lineTo(MARGIN + LEBAR, yf - 6).lineWidth(0.5).strokeColor(C.garis).stroke().restore();
    doc.font("Helvetica").fontSize(7).fillColor(C.redup)
      .text(`${final ? `SPH ${nomor}` : "DRAF SPH - belum disetujui, bukan penawaran resmi"} · dicetak ${cetak}${opts.oleh ? ` oleh ${bersih(opts.oleh)}` : ""}`,
        MARGIN, yf, { width: LEBAR - 60, lineBreak: false })
      .text(`Hal. ${i - rentang.start + 1}/${rentang.count}`, MARGIN + LEBAR - 60, yf, { width: 60, align: "right", lineBreak: false });
    if (!final) {
      doc.save();
      doc.rotate(-35, { origin: [HAL_L / 2, HAL_T / 2] });
      doc.font("Helvetica-Bold").fontSize(130).fillColor(C.draf).fillOpacity(0.09)
        .text("DRAF", 0, HAL_T / 2 - 65, { width: HAL_L, align: "center", lineBreak: false });
      doc.restore();
    }
    doc.page.margins.bottom = mb;
  }

  doc.end();
  return selesai;
}
