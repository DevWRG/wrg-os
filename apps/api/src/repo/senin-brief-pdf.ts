// F110 — Pre-Meeting Briefing Direktur (cross-check 8 HoD) sebagai PDF.
//
// Ini HANYA lapisan keluaran dari F85 (senin-brief.ts): tak ada penilaian baru.
// Status per cek, status per HoD, dan Overall Health dibaca apa adanya dari kolom
// `checks` brief yang tersimpan; narasi (gap utama, urutan bahasan, pertanyaan
// kritis, keputusan) diambil dari `content`. Dengan begitu PDF yang dibawa ke
// rapat tak bisa berbeda dari yang tampil di /briefings maupun yang dikirim via WA.
//
// Dibuat di server (pdfkit), pola sama dengan pricelist-pdf.ts: hasilnya identik di
// semua perangkat. Helvetica bawaan PDF tak punya emoji / ≥ / →, jadi teks
// dibersihkan dulu (`bersih`) — tanpa itu karakter tak dikenal tercetak sebagai sampah.

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import PDFDocumentKlass from "pdfkit";

import type { CekHasil, Health, HodStatus, SeninBriefRow } from "./senin-brief.js";

const MARGIN = 36;
const HAL_L = 595; // A4 potret
const HAL_T = 842;
const LEBAR = HAL_L - MARGIN * 2;
const KOP = fileURLToPath(new URL("../../assets/kop-surat.png", import.meta.url));
const KOP_RASIO = 148 / 2204;

const C = { teks: "#0f172a", redup: "#64748b", garis: "#e2e8f0", kepala: "#0f766e", zebra: "#f8fafc" };
const WARNA_CEK: Record<CekHasil, { bg: string; fg: string; teks: string }> = {
  OK: { bg: "#d1fae5", fg: "#047857", teks: "OK" },
  WARN: { bg: "#fef3c7", fg: "#b45309", teks: "Kurang" },
  FAIL: { bg: "#fee2e2", fg: "#b91c1c", teks: "Gagal" },
  NA: { bg: "#ffffff", fg: "#94a3b8", teks: "-" },
};
const WARNA_STATUS: Record<HodStatus, { bg: string; fg: string }> = {
  SIAP: { bg: WARNA_CEK.OK.bg, fg: WARNA_CEK.OK.fg },
  "PERLU KLARIFIKASI": { bg: WARNA_CEK.WARN.bg, fg: WARNA_CEK.WARN.fg },
  "TIDAK SIAP": { bg: WARNA_CEK.FAIL.bg, fg: WARNA_CEK.FAIL.fg },
};
const WARNA_HEALTH: Record<Health, { bg: string; fg: string }> = {
  "ON-TRACK": WARNA_STATUS.SIAP,
  RISK: WARNA_STATUS["PERLU KLARIFIKASI"],
  RED: WARNA_STATUS["TIDAK SIAP"],
};

// ── Fungsi murni (dites) ─────────────────────────────────────────

const GANTI: [RegExp, string][] = [
  [/≥/g, ">="], [/≤/g, "<="], [/→/g, "->"], [/←/g, "<-"], [/…/g, "..."], [/[‐-―]/g, "-"],
];

/**
 * Sisakan karakter yang ada di Helvetica (WinAnsi): Latin-1 + tanda baca umum.
 * Emoji status (✅🟡🔴) dibuang; padanannya sudah dicetak sebagai teks.
 */
export function bersih(teks: string): string {
  let t = teks;
  for (const [re, ganti] of GANTI) t = t.replace(re, ganti);
  let out = "";
  for (const ch of t) {
    const k = ch.codePointAt(0)!;
    // Pertahankan: tab/newline, ASCII, Latin-1, kutip & bullet tipografis (WinAnsi 0x91-0x95).
    const ok = k === 9 || k === 10 || (k >= 0x20 && k <= 0x7e) || (k >= 0xa0 && k <= 0xff)
      || k === 0x2018 || k === 0x2019 || k === 0x201c || k === 0x201d || k === 0x2022;
    if (ok) out += ch;
  }
  return out.replace(/ {2,}/g, " ").trim();
}

export type Blok =
  | { t: "p"; teks: string }
  | { t: "h3"; teks: string }
  | { t: "li"; teks: string; no?: number };

export interface Narasi {
  gap: Blok[];
  urutan: Blok[];
  pertanyaan: Blok[];
  keputusan: Blok[];
}

const JUDUL_NARASI: Record<keyof Narasi, string> = {
  gap: "Gap Utama per HoD",
  urutan: "Urutan Prioritas Bahasan",
  pertanyaan: "Pertanyaan Kritis Direktur",
  keputusan: "Keputusan Direktur Minggu Ini",
};

/** Markdown minimal (### / bullet / bernomor / paragraf) → blok. Garis pemisah & baris kosong dibuang. */
export function parseBlok(baris: string[]): Blok[] {
  const out: Blok[] = [];
  for (const raw of baris) {
    const line = raw.trimEnd();
    if (!line.trim() || /^\s*([-*_])\1{2,}\s*$/.test(line)) continue;
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    const nomor = /^\s*(\d+)[.)]\s+(.*)$/.exec(line);
    if (nomor) out.push({ t: "li", teks: nomor[2], no: Number(nomor[1]) });
    else if (bullet) out.push({ t: "li", teks: bullet[1] });
    else if (line.startsWith("### ")) out.push({ t: "h3", teks: line.slice(4) });
    else if (line.startsWith("## ")) out.push({ t: "h3", teks: line.slice(3) });
    else out.push({ t: "p", teks: line.trim() });
  }
  return out;
}

/**
 * Ambil empat bagian narasi LLM dari `content`. Bagian yang tak ada → array kosong
 * (brief tanpa narasi: `narasi_ok=false`). Heading dikenali persis seperti yang
 * diminta prompt services/ai/app/senin.py.
 */
export function parseNarasi(content: string): Narasi {
  const hasil: Narasi = { gap: [], urutan: [], pertanyaan: [], keputusan: [] };
  const urutanKey = Object.entries(JUDUL_NARASI) as [keyof Narasi, string][];
  let aktif: keyof Narasi | null = null;
  const buf: Record<keyof Narasi, string[]> = { gap: [], urutan: [], pertanyaan: [], keputusan: [] };
  for (const line of content.split("\n")) {
    if (line.startsWith("## ")) {
      const judul = line.slice(3).trim();
      aktif = urutanKey.find(([, j]) => j === judul)?.[0] ?? null;
      continue;
    }
    if (aktif) buf[aktif].push(line);
  }
  for (const [k] of urutanKey) hasil[k] = parseBlok(buf[k]);
  return hasil;
}

/** "**tebal** biasa" → potongan; dipakai agar tebal tercetak sebagai font bold, bukan tanda bintang. */
export function potongInline(teks: string): { s: string; bold: boolean }[] {
  return teks.split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map((p) =>
    p.startsWith("**") && p.endsWith("**") && p.length > 4 ? { s: p.slice(2, -2), bold: true } : { s: p, bold: false });
}

export function namaFilePdf(b: Pick<SeninBriefRow, "iso_year" | "iso_week">): string {
  return `pre-meeting-briefing-${b.iso_year}-W${String(b.iso_week).padStart(2, "0")}.pdf`;
}

// ── Render ───────────────────────────────────────────────────────

export interface PdfOpts {
  /** Nama yang dicetak di footer sebagai pencetak dokumen (diisi server dari sesi). */
  oleh?: string | null;
}

export async function seninBriefPdf(b: SeninBriefRow, opts: PdfOpts = {}): Promise<Buffer> {
  const doc = new PDFDocumentKlass({
    size: "A4", layout: "portrait", margin: MARGIN, bufferPages: true,
    info: { Title: `Pre-Meeting Briefing W${b.iso_week} ${b.iso_year}`, Author: "WRG-OS" },
  });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const selesai = new Promise<Buffer>((res) => doc.on("end", () => res(Buffer.concat(chunks))));

  const cetak = new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta", dateStyle: "long", timeStyle: "short" });
  const disusun = new Date(b.generated_at).toLocaleString("id-ID", { timeZone: "Asia/Jakarta", dateStyle: "long", timeStyle: "short" });
  const BATAS = HAL_T - MARGIN - 24; // sisakan ruang footer
  const ruang = (tinggi: number) => {
    if (doc.y + tinggi > BATAS) doc.addPage();
  };

  // Kop surat hanya halaman pertama — dokumen internal Direktur, bukan surat keluar.
  if (existsSync(KOP)) {
    doc.image(KOP, MARGIN, MARGIN, { width: LEBAR });
    doc.y = MARGIN + LEBAR * KOP_RASIO + 14;
  }

  doc.fillColor(C.kepala).font("Helvetica-Bold").fontSize(15)
    .text("Pre-Meeting Briefing Direktur", MARGIN, doc.y);
  doc.fillColor(C.redup).font("Helvetica").fontSize(8.5)
    .text(bersih(`Cross-check kesiapan ${b.checks.length} HoD · Senin Brief W${b.iso_week} ${b.iso_year} · periode ${b.periode}`), MARGIN, doc.y + 2);
  doc.text(bersih(`Disusun ${disusun}`), MARGIN, doc.y + 1);

  // Overall Health + hitungan status.
  const n = (s: HodStatus) => b.checks.filter((h) => h.status === s).length;
  const wh = WARNA_HEALTH[b.health];
  const yH = doc.y + 8;
  doc.save().roundedRect(MARGIN, yH, 150, 20, 3).fill(wh.bg).restore();
  doc.fillColor(wh.fg).font("Helvetica-Bold").fontSize(10)
    .text(`Overall Health: ${b.health}`, MARGIN + 8, yH + 5, { width: 140, lineBreak: false });
  doc.fillColor(C.teks).font("Helvetica").fontSize(9)
    .text(`${n("SIAP")} SIAP  ·  ${n("PERLU KLARIFIKASI")} perlu klarifikasi  ·  ${n("TIDAK SIAP")} tidak siap`,
      MARGIN + 162, yH + 6, { width: LEBAR - 162, lineBreak: false });
  doc.y = yH + 30;

  // Tabel ringkasan 1 halaman.
  const W_HOD = 131, W_STATUS = 100, W_CEK = 60; // 131 + 100 + 5*60 = 531 = LEBAR
  const labelCek = b.checks[0]?.checks.map((c) => c.label) ?? [];
  const barisKepala = (y: number) => {
    doc.save().rect(MARGIN, y, LEBAR, 28).fill(C.kepala).restore();
    doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(7.5);
    doc.text("HOD", MARGIN + 4, y + 10, { width: W_HOD - 8, lineBreak: false });
    doc.text("STATUS", MARGIN + W_HOD + 4, y + 10, { width: W_STATUS - 8, lineBreak: false });
    labelCek.forEach((l, i) => {
      doc.text(bersih(`${i + 1}. ${l}`), MARGIN + W_HOD + W_STATUS + i * W_CEK + 3, y + 5, { width: W_CEK - 6, height: 20 });
    });
    doc.y = y + 28;
  };
  barisKepala(doc.y);
  const TINGGI_BARIS = 26;
  b.checks.forEach((h, i) => {
    if (doc.y + TINGGI_BARIS > BATAS) { doc.addPage(); barisKepala(MARGIN); }
    const y = doc.y;
    if (i % 2 === 1) doc.save().rect(MARGIN, y, LEBAR, TINGGI_BARIS).fill(C.zebra).restore();
    doc.fillColor(C.teks).font("Helvetica-Bold").fontSize(8.5)
      .text(bersih(h.nama), MARGIN + 4, y + 4, { width: W_HOD - 8, lineBreak: false, ellipsis: true });
    doc.fillColor(C.redup).font("Helvetica").fontSize(6.5)
      .text(bersih(h.peran), MARGIN + 4, y + 15, { width: W_HOD - 8, lineBreak: false, ellipsis: true });
    const ws = WARNA_STATUS[h.status];
    doc.save().roundedRect(MARGIN + W_HOD + 2, y + 5, W_STATUS - 6, 16, 3).fill(ws.bg).restore();
    doc.fillColor(ws.fg).font("Helvetica-Bold").fontSize(7)
      .text(h.status, MARGIN + W_HOD + 2, y + 10, { width: W_STATUS - 6, align: "center", lineBreak: false });
    h.checks.forEach((c, k) => {
      const w = WARNA_CEK[c.hasil];
      const x = MARGIN + W_HOD + W_STATUS + k * W_CEK;
      if (c.hasil !== "NA") doc.save().roundedRect(x + 6, y + 5, W_CEK - 12, 16, 3).fill(w.bg).restore();
      doc.fillColor(w.fg).font("Helvetica-Bold").fontSize(7.5)
        .text(w.teks, x, y + 10, { width: W_CEK, align: "center", lineBreak: false });
    });
    doc.save().moveTo(MARGIN, y + TINGGI_BARIS).lineTo(MARGIN + LEBAR, y + TINGGI_BARIS)
      .strokeColor(C.garis).lineWidth(0.5).stroke().restore();
    doc.y = y + TINGGI_BARIS;
  });
  doc.fillColor(C.redup).font("Helvetica").fontSize(7)
    .text("Status dihitung dari data, bukan AI: SIAP = semua cek hijau · TIDAK SIAP = 3 cek gagal atau lebih · "
      + "PERLU KLARIFIKASI = sisanya · '-' = cek tak berlaku.", MARGIN, doc.y + 4, { width: LEBAR });

  // Narasi.
  const nar = parseNarasi(b.content);
  const adaNarasi = b.narasi_ok && Object.values(nar).some((x) => x.length > 0);
  const tulisInline = (teks: string, x: number, lebar: number, ukuran: number, boldDasar = false) => {
    const segs = potongInline(bersih(teks));
    segs.forEach((p, i) => {
      doc.font(p.bold || boldDasar ? "Helvetica-Bold" : "Helvetica").fontSize(ukuran).fillColor(C.teks);
      const last = i === segs.length - 1;
      if (i === 0) doc.text(p.s, x, doc.y, { width: lebar, continued: !last });
      else doc.text(p.s, { continued: !last });
    });
  };
  const bagian = (judul: string, blok: Blok[]) => {
    if (blok.length === 0) return;
    ruang(60);
    doc.moveDown(0.9);
    doc.fillColor(C.kepala).font("Helvetica-Bold").fontSize(11).text(judul, MARGIN, doc.y, { width: LEBAR });
    doc.save().moveTo(MARGIN, doc.y + 1).lineTo(MARGIN + LEBAR, doc.y + 1).strokeColor(C.garis).lineWidth(0.8).stroke().restore();
    doc.moveDown(0.4);
    for (const bl of blok) {
      ruang(24);
      if (bl.t === "h3") { doc.moveDown(0.3); tulisInline(bl.teks, MARGIN, LEBAR, 9, true); }
      else if (bl.t === "li") {
        const label = bl.no !== undefined ? `${bl.no}.` : "•";
        const y = doc.y;
        doc.fillColor(C.teks).font("Helvetica").fontSize(9).text(label, MARGIN + 4, y, { width: 16, lineBreak: false });
        doc.y = y;
        tulisInline(bl.teks, MARGIN + 22, LEBAR - 22, 9);
      } else tulisInline(bl.teks, MARGIN, LEBAR, 9);
      doc.moveDown(0.25);
    }
  };

  if (adaNarasi) {
    bagian("Gap Utama per HoD", nar.gap);
    bagian("Urutan Prioritas Bahasan", nar.urutan);
    bagian("Pertanyaan Kritis Direktur", nar.pertanyaan);
    bagian("Keputusan Direktur Minggu Ini", nar.keputusan);
  } else {
    ruang(50);
    doc.moveDown(0.9);
    doc.fillColor("#b45309").font("Helvetica-Bold").fontSize(9)
      .text("Narasi AI (gap utama, pertanyaan kritis, keputusan) tidak tersedia minggu ini.", MARGIN, doc.y, { width: LEBAR });
    doc.fillColor(C.redup).font("Helvetica").fontSize(8)
      .text("Tabel kesiapan & detail cek tetap dihitung dari data.", MARGIN, doc.y, { width: LEBAR });
  }

  // Lampiran: detail cek per HoD.
  doc.addPage();
  doc.fillColor(C.kepala).font("Helvetica-Bold").fontSize(11).text("Lampiran — Detail Cek per HoD", MARGIN, MARGIN, { width: LEBAR });
  doc.moveDown(0.4);
  for (const h of b.checks) {
    ruang(14 + h.checks.length * 12);
    doc.moveDown(0.4);
    doc.fillColor(C.teks).font("Helvetica-Bold").fontSize(9)
      .text(bersih(`${h.nama} - ${h.peran}`), MARGIN, doc.y, { width: LEBAR, continued: true })
      .fillColor(WARNA_STATUS[h.status].fg).text(`   ${h.status}`, { continued: false });
    for (const c of h.checks) {
      const w = WARNA_CEK[c.hasil];
      const y = doc.y;
      doc.fillColor(w.fg).font("Helvetica-Bold").fontSize(7.5).text(w.teks, MARGIN + 6, y, { width: 36, lineBreak: false });
      doc.y = y;
      doc.fillColor(C.teks).font("Helvetica").fontSize(8)
        .text(bersih(`${c.no}. ${c.label} - ${c.detail}`), MARGIN + 46, y, { width: LEBAR - 46 });
    }
  }

  // Footer semua halaman: nomor halaman + pencetak. Margin bawah dinolkan sementara
  // supaya teks di zona margin tak memicu halaman baru.
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    const m = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    const y = HAL_T - MARGIN - 10;
    doc.fillColor(C.redup).font("Helvetica").fontSize(7)
      .text(bersih(`Dokumen internal Direktur · dicetak ${cetak}${opts.oleh ? ` oleh ${opts.oleh}` : ""}`),
        MARGIN, y, { width: LEBAR - 60, lineBreak: false })
      .text(`Hal. ${i + 1}/${range.count}`, MARGIN + LEBAR - 56, y, { width: 56, align: "right", lineBreak: false });
    doc.page.margins.bottom = m;
  }

  doc.end();
  return selesai;
}
