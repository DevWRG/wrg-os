// F63 — Briefing Mingguan Direktur sebagai PDF (unduhan dari link WA / tab Briefing).
//
// Tiga lapis isi, dari yang paling pasti ke yang paling tafsiran:
//   1. Halaman ringkasan: infografis status HoD & metrik + pergerakan terbesar —
//      angka dari papan WatchPoint Weekly minggu dasar (sama dengan tab Weekly).
//   2. Papan skor per HoD: aktual vs target, bar capaian, tren 8 minggu (snapshot).
//   3. Narasi AI bagian A–H dari rekap/resume grup (briefing_mingguan.content).
// Angka tak pernah diambil dari narasi; narasi tak pernah menimpa angka.
//
// pdfkit di server, pola senin-brief-pdf.ts (kop, bersih(), footer per halaman).

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import PDFDocumentKlass from "pdfkit";

import { bersih, potongInline } from "./senin-brief-pdf.js";
import type { WatchStatus } from "./watchpoint.js";
import type { WeeklyBoard } from "./watchpoint-weekly.js";
import {
  metrikMerah, nilai, pergerakanTerbesar, ringkasHod, ringkasStatus, type Riwayat,
} from "./weekly-briefing-angka.js";

const MARGIN = 36;
const HAL_L = 595; // A4 potret
const HAL_T = 842;
const LEBAR = HAL_L - MARGIN * 2;
const BATAS = HAL_T - MARGIN - 24; // sisakan ruang footer
const KOP = fileURLToPath(new URL("../../assets/kop-surat.png", import.meta.url));
const KOP_RASIO = 148 / 2204;

const C = {
  teks: "#0f172a", redup: "#64748b", garis: "#e2e8f0", kepala: "#0f766e", zebra: "#f8fafc",
  kotak: "#f1f5f9", naik: "#047857", turun: "#b91c1c",
};
const WARNA: Record<WatchStatus, { bg: string; fg: string; isi: string; teks: string }> = {
  GREEN: { bg: "#d1fae5", fg: "#047857", isi: "#10b981", teks: "Hijau" },
  YELLOW: { bg: "#fef3c7", fg: "#b45309", isi: "#f59e0b", teks: "Kuning" },
  RED: { bg: "#fee2e2", fg: "#b91c1c", isi: "#ef4444", teks: "Merah" },
  NA: { bg: "#f1f5f9", fg: "#64748b", isi: "#cbd5e1", teks: "Belum ada" },
};

// ── Markdown narasi → blok (murni, diuji) ────────────────────────

export type BlokMd =
  | { t: "h1" | "h2" | "h3" | "p"; teks: string }
  | { t: "li"; teks: string; no?: number; level: number }
  | { t: "tabel"; kepala: string[]; baris: string[][] };

const selTabel = (l: string) => l.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());

export function parseMarkdown(content: string): BlokMd[] {
  const out: BlokMd[] = [];
  const baris = content.split("\n");
  for (let i = 0; i < baris.length; i++) {
    const raw = baris[i].replace(/\s+$/, "");
    const l = raw.trim();
    if (!l || /^([=\-_*])\1{2,}$/.test(l)) continue;
    if (l.startsWith("|")) {
      const kumpul: string[][] = [];
      while (i < baris.length && baris[i].trim().startsWith("|")) {
        const sel = selTabel(baris[i]);
        if (!sel.every((c) => /^:?-{2,}:?$/.test(c))) kumpul.push(sel);
        i++;
      }
      i--;
      if (kumpul.length) {
        const lebar = Math.max(...kumpul.map((r) => r.length));
        const rapih = kumpul.map((r) => [...r, ...Array(lebar - r.length).fill("")]);
        out.push({ t: "tabel", kepala: rapih[0], baris: rapih.slice(1) });
      }
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(l);
    if (h) {
      const lv = h[1].length;
      out.push({ t: lv === 1 ? "h1" : lv === 2 ? "h2" : "h3", teks: h[2].replace(/\*\*/g, "").trim() });
      continue;
    }
    const indent = raw.length - raw.trimStart().length;
    const level = indent >= 2 ? 1 : 0;
    const nomor = /^(\d+)[.)]\s+(.*)$/.exec(l);
    const bullet = /^[-*•]\s+(.*)$/.exec(l);
    if (nomor) out.push({ t: "li", teks: nomor[2], no: Number(nomor[1]), level });
    else if (bullet) out.push({ t: "li", teks: bullet[1], level });
    else out.push({ t: "p", teks: l });
  }
  return out;
}

/** Pisahkan bagian A (ringkasan eksekutif) dari sisanya. Tanpa heading "A." → semua jadi sisa. */
export function pisahRingkasan(blok: BlokMd[]): { ringkasan: BlokMd[]; sisa: BlokMd[] } {
  const iA = blok.findIndex((b) => b.t === "h2" && /^A[.)]\s/i.test(b.teks));
  if (iA < 0) return { ringkasan: [], sisa: blok.filter((b) => b.t !== "h1") };
  const iB = blok.findIndex((b, i) => i > iA && b.t === "h2");
  const akhir = iB < 0 ? blok.length : iB;
  return { ringkasan: blok.slice(iA + 1, akhir), sisa: blok.slice(akhir) };
}

export function namaFileBriefingPdf(isoYear: number, isoWeek: number): string {
  return `briefing-mingguan-${isoYear}-W${String(isoWeek).padStart(2, "0")}.pdf`;
}

// ── Render ───────────────────────────────────────────────────────

export interface BriefingPdfInput {
  iso_year: number;
  iso_week: number;
  periode: string;
  dasar_label: string; // "17–23 Agustus 2026"
  n_rekap: number;
  n_resume: number;
  content: string;
  narasi_ok: boolean;
  generated_at: string;
  board: WeeklyBoard | null;
  riwayat: Riwayat;
}

type Doc = InstanceType<typeof PDFDocumentKlass>;

export async function briefingMingguanPdf(b: BriefingPdfInput, opts: { oleh?: string | null } = {}): Promise<Buffer> {
  const doc: Doc = new PDFDocumentKlass({
    size: "A4", layout: "portrait", margin: MARGIN, bufferPages: true,
    info: { Title: `Briefing Mingguan W${b.iso_week} ${b.iso_year}`, Author: "WRG-OS" },
  });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const selesai = new Promise<Buffer>((res) => doc.on("end", () => res(Buffer.concat(chunks))));
  const ruang = (tinggi: number) => { if (doc.y + tinggi > BATAS) doc.addPage(); };
  const fmt = (iso: string) => new Date(iso).toLocaleString("id-ID", { timeZone: "Asia/Jakarta", dateStyle: "long", timeStyle: "short" });

  const judulBagian = (teks: string, sub?: string) => {
    ruang(50);
    doc.moveDown(0.6);
    doc.fillColor(C.kepala).font("Helvetica-Bold").fontSize(12).text(bersih(teks), MARGIN, doc.y, { width: LEBAR });
    doc.save().moveTo(MARGIN, doc.y + 1).lineTo(MARGIN + LEBAR, doc.y + 1).strokeColor(C.garis).lineWidth(0.8).stroke().restore();
    if (sub) doc.fillColor(C.redup).font("Helvetica").fontSize(7.5).text(bersih(sub), MARGIN, doc.y + 4, { width: LEBAR });
    doc.moveDown(0.5);
  };
  const tulisInline = (teks: string, x: number, lebar: number, ukuran: number, boldDasar = false, warna = C.teks) => {
    const segs = potongInline(bersih(teks));
    if (segs.length === 0) return;
    segs.forEach((p, i) => {
      doc.font(p.bold || boldDasar ? "Helvetica-Bold" : "Helvetica").fontSize(ukuran).fillColor(warna);
      const last = i === segs.length - 1;
      if (i === 0) doc.text(p.s, x, doc.y, { width: lebar, continued: !last });
      else doc.text(p.s, { continued: !last });
    });
  };
  const panah = (x: number, y: number, naik: boolean, warna: string) => {
    doc.save().fillColor(warna);
    if (naik) doc.polygon([x, y + 6], [x + 4, y], [x + 8, y + 6]);
    else doc.polygon([x, y], [x + 8, y], [x + 4, y + 6]);
    doc.fill().restore();
  };

  // ── Halaman 1: kop + judul + infografis ───────────────────────
  if (existsSync(KOP)) {
    doc.image(KOP, MARGIN, MARGIN, { width: LEBAR });
    doc.y = MARGIN + LEBAR * KOP_RASIO + 14;
  }
  doc.fillColor(C.kepala).font("Helvetica-Bold").fontSize(16).text("Briefing Mingguan Direktur", MARGIN, doc.y);
  doc.fillColor(C.teks).font("Helvetica-Bold").fontSize(10)
    .text(bersih(`Minggu W${b.iso_week} · ${b.periode}`), MARGIN, doc.y + 2);
  doc.fillColor(C.redup).font("Helvetica").fontSize(8)
    .text(bersih(`Dasar: ${b.n_rekap} rekap + ${b.n_resume} resume grup dan papan WatchPoint ${b.dasar_label} · disusun ${fmt(b.generated_at)}`),
      MARGIN, doc.y + 1, { width: LEBAR });

  if (b.board) {
    const hod = ringkasHod(b.board);
    const met = ringkasStatus(b.board);

    // Ubin status HoD.
    const yU = doc.y + 12;
    const urutan: WatchStatus[] = ["GREEN", "YELLOW", "RED", "NA"];
    const wU = (LEBAR - 3 * 8) / 4;
    urutan.forEach((s, i) => {
      const x = MARGIN + i * (wU + 8);
      doc.save().roundedRect(x, yU, wU, 52, 5).fill(WARNA[s].bg).restore();
      doc.fillColor(WARNA[s].fg).font("Helvetica-Bold").fontSize(22).text(String(hod[s]), x, yU + 7, { width: wU, align: "center" });
      doc.font("Helvetica").fontSize(7.5).text(s === "NA" ? "HoD belum ada data" : `HoD status ${WARNA[s].teks.toLowerCase()}`,
        x, yU + 35, { width: wU, align: "center" });
    });

    // Batang komposisi status metrik.
    const yB = yU + 64;
    doc.fillColor(C.teks).font("Helvetica-Bold").fontSize(8.5)
      .text(`Komposisi ${met.total} metrik WatchPoint`, MARGIN, yB, { width: LEBAR });
    const yBar = yB + 13;
    let x = MARGIN;
    for (const s of urutan) {
      if (!met[s]) continue;
      const w = (met[s] / met.total) * LEBAR;
      doc.save().rect(x, yBar, w, 14).fill(WARNA[s].isi).restore();
      if (w > 24) doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(7.5).text(String(met[s]), x, yBar + 3.5, { width: w, align: "center" });
      x += w;
    }
    let xL = MARGIN;
    const yL = yBar + 19;
    for (const s of urutan) {
      doc.save().rect(xL, yL + 1, 7, 7).fill(WARNA[s].isi).restore();
      const label = `${WARNA[s].teks} ${met[s]}`;
      doc.fillColor(C.redup).font("Helvetica").fontSize(7.5).text(label, xL + 10, yL, { lineBreak: false });
      xL += 10 + doc.widthOfString(label) + 14;
    }
    doc.fillColor(C.redup).font("Helvetica").fontSize(7)
      .text("Hijau >= target · Kuning 50-99% · Merah < 50%",
        xL, yL, { width: MARGIN + LEBAR - xL, align: "right", lineBreak: false });
    doc.y = yL + 16;

    // Pergerakan terbesar.
    const gerak = pergerakanTerbesar(b.board, 4);
    if (gerak.membaik.length || gerak.memburuk.length) {
      const yG = doc.y + 4;
      const wK = (LEBAR - 10) / 2;
      const kolom = (judul: string, data: typeof gerak.membaik, x0: number, warna: string) => {
        doc.fillColor(warna).font("Helvetica-Bold").fontSize(8.5).text(judul, x0, yG, { width: wK });
        let y = yG + 14;
        if (!data.length) doc.fillColor(C.redup).font("Helvetica").fontSize(7.5).text("Tidak ada.", x0, y, { width: wK });
        for (const p of data) {
          doc.save().roundedRect(x0, y, wK, 26, 3).fill(C.zebra).restore();
          panah(x0 + 6, y + 6, p.ubah > 0, warna);
          doc.fillColor(C.teks).font("Helvetica-Bold").fontSize(7.5)
            .text(bersih(`${p.label} · ${p.hod}`), x0 + 20, y + 4, { width: wK - 80, lineBreak: false, ellipsis: true });
          doc.fillColor(C.redup).font("Helvetica").fontSize(7)
            .text(bersih(`${nilai(p.prevActual, p.unit)} -> ${nilai(p.actual, p.unit)}`), x0 + 20, y + 14, { width: wK - 80, lineBreak: false, ellipsis: true });
          doc.fillColor(warna).font("Helvetica-Bold").fontSize(9)
            .text(`${p.ubah > 0 ? "+" : ""}${Math.round(p.ubah)}%`, x0 + wK - 58, y + 8, { width: 52, align: "right", lineBreak: false });
          y += 30;
        }
        return y;
      };
      const y1 = kolom("Membaik terbesar vs minggu sebelumnya", gerak.membaik, MARGIN, C.naik);
      const y2 = kolom("Memburuk terbesar vs minggu sebelumnya", gerak.memburuk, MARGIN + wK + 10, C.turun);
      doc.y = Math.max(y1, y2) + 2;
    }

    const merah = metrikMerah(b.board, 5);
    if (merah.length) {
      ruang(30 + merah.length * 12);
      doc.moveDown(0.4);
      doc.fillColor(C.turun).font("Helvetica-Bold").fontSize(8.5).text("Metrik merah dengan capaian terendah", MARGIN, doc.y, { width: LEBAR });
      for (const m of merah) {
        doc.fillColor(C.teks).font("Helvetica").fontSize(8)
          .text(bersih(`•  ${m.hod} — ${m.label}: ${m.teks}`), MARGIN + 4, doc.y + 2, { width: LEBAR - 4 });
      }
    }
  } else {
    doc.moveDown(0.8);
    doc.fillColor("#b45309").font("Helvetica-Bold").fontSize(9)
      .text("Papan WatchPoint minggu dasar tidak tersedia — PDF ini hanya berisi narasi.", MARGIN, doc.y, { width: LEBAR });
  }

  // Ringkasan eksekutif (bagian A narasi) dalam kotak.
  const blok = b.narasi_ok ? parseMarkdown(b.content) : [];
  const { ringkasan, sisa } = pisahRingkasan(blok);
  if (ringkasan.length) {
    judulBagian("Ringkasan Eksekutif", "Disusun AI dari rekap & resume grup WhatsApp — angka di atas berasal dari sistem, bukan dari narasi.");
    for (const bl of ringkasan) {
      if (bl.t === "tabel") continue;
      ruang(20);
      tulisInline(bl.t === "li" ? `• ${bl.teks}` : bl.teks, MARGIN, LEBAR, 9, bl.t !== "p" && bl.t !== "li");
      doc.moveDown(0.3);
    }
  }

  // ── Papan skor per HoD ───────────────────────────────────────
  if (b.board) {
    doc.addPage();
    judulBagian(`Papan Skor HoD — WatchPoint ${b.board.label} (${b.board.periode})`,
      "Capaian = aktual dibanding target minggu itu. Garis tren = 8 minggu terakhir dari snapshot tersimpan (kosong = belum ada snapshot).");
    const W_LABEL = 150, W_AKT = 78, W_TGT = 78, W_BAR = 120, W_TREN = LEBAR - 150 - 78 - 78 - 120;
    for (const h of b.board.hods) {
      const tinggi = 24 + h.metrics.length * 18;
      ruang(Math.min(tinggi, 200));
      const yH = doc.y + 4;
      doc.save().roundedRect(MARGIN, yH, LEBAR, 20, 3).fill(C.kotak).restore();
      doc.fillColor(C.teks).font("Helvetica-Bold").fontSize(9.5).text(bersih(h.name), MARGIN + 8, yH + 5.5, { lineBreak: false });
      const wNama = doc.widthOfString(bersih(h.name));
      doc.fillColor(C.redup).font("Helvetica").fontSize(7.5).text(bersih(h.role), MARGIN + 14 + wNama, yH + 7, { lineBreak: false });
      const w = WARNA[h.status];
      doc.save().roundedRect(MARGIN + LEBAR - 76, yH + 3, 70, 14, 3).fill(w.bg).restore();
      doc.fillColor(w.fg).font("Helvetica-Bold").fontSize(7.5).text(w.teks.toUpperCase(), MARGIN + LEBAR - 76, yH + 6.5, { width: 70, align: "center", lineBreak: false });
      doc.y = yH + 24;
      for (const m of h.metrics) {
        if (doc.y + 18 > BATAS) doc.addPage();
        const y = doc.y;
        const wm = WARNA[m.status];
        doc.save().circle(MARGIN + 5, y + 6, 3).fill(wm.isi).restore();
        doc.fillColor(C.teks).font("Helvetica").fontSize(7.5).text(bersih(m.label), MARGIN + 12, y + 2, { width: W_LABEL - 14, lineBreak: false, ellipsis: true });
        doc.font("Helvetica-Bold").text(nilai(m.actual, m.unit), MARGIN + W_LABEL, y + 2, { width: W_AKT - 4, align: "right", lineBreak: false });
        doc.fillColor(C.redup).font("Helvetica").text(`/ ${nilai(m.target, m.unit)}`, MARGIN + W_LABEL + W_AKT, y + 2, { width: W_TGT - 4, lineBreak: false, ellipsis: true });
        // Bar capaian (dipotong 150%).
        const xb = MARGIN + W_LABEL + W_AKT + W_TGT;
        const lebarBar = W_BAR - 34;
        doc.save().roundedRect(xb, y + 3, lebarBar, 7, 2).fill(C.garis).restore();
        if (m.pct !== null && m.status !== "NA") {
          const p = Math.max(0, Math.min(m.pct, 150));
          doc.save().roundedRect(xb, y + 3, Math.max(2, (p / 150) * lebarBar), 7, 2).fill(wm.isi).restore();
          doc.save().moveTo(xb + (100 / 150) * lebarBar, y + 1).lineTo(xb + (100 / 150) * lebarBar, y + 12).strokeColor(C.teks).lineWidth(0.6).stroke().restore();
          doc.fillColor(wm.fg).font("Helvetica-Bold").fontSize(7).text(`${Math.round(m.pct)}%`, xb + lebarBar + 2, y + 2.5, { width: 30, lineBreak: false });
        } else {
          doc.fillColor(C.redup).font("Helvetica").fontSize(6.5).text("-", xb + lebarBar + 2, y + 2.5, { width: 30, lineBreak: false });
        }
        // Garis tren 8 minggu.
        const deret = b.riwayat.get(`${h.key}:${m.key}`) ?? [];
        const xs = MARGIN + W_LABEL + W_AKT + W_TGT + W_BAR + 4;
        const ws = W_TREN - 8;
        const angka = deret.filter((v): v is number => v !== null);
        if (angka.length >= 2) {
          const mn = Math.min(...angka), mx = Math.max(...angka);
          const titik = deret.map((v, i) => (v === null ? null : [xs + (i / Math.max(1, deret.length - 1)) * ws,
            y + 12 - (mx === mn ? 0.5 : (v - mn) / (mx - mn)) * 10] as [number, number]));
          doc.save().strokeColor(m.status === "NA" ? C.redup : C.kepala).lineWidth(0.9);
          let mulai = true;
          for (const t of titik) {
            if (!t) { mulai = true; continue; }
            if (mulai) { doc.moveTo(t[0], t[1]); mulai = false; } else doc.lineTo(t[0], t[1]);
          }
          doc.stroke().restore();
          const akhir = [...titik].reverse().find((t) => t);
          if (akhir) doc.save().circle(akhir[0], akhir[1], 1.6).fill(C.kepala).restore();
        } else {
          doc.fillColor(C.redup).font("Helvetica").fontSize(6.5).text("belum cukup data", xs, y + 3, { width: ws, lineBreak: false });
        }
        doc.save().moveTo(MARGIN, y + 16).lineTo(MARGIN + LEBAR, y + 16).strokeColor(C.garis).lineWidth(0.4).stroke().restore();
        doc.y = y + 18;
      }
      doc.moveDown(0.3);
    }
  }

  // ── Narasi lengkap B–H ────────────────────────────────────────
  if (b.narasi_ok && sisa.length) {
    ruang(220);
    judulBagian("Narasi Briefing", "Disusun AI dari rekap & resume grup WhatsApp minggu dasar. Periksa angka penting dengan sumbernya sebelum diputuskan.");
    for (const bl of sisa) {
      if (bl.t === "h1") continue;
      if (bl.t === "h2") { judulBagian(bl.teks); continue; }
      if (bl.t === "h3") { ruang(30); doc.moveDown(0.3); tulisInline(bl.teks, MARGIN, LEBAR, 9.5, true, C.kepala); doc.moveDown(0.15); continue; }
      if (bl.t === "li") {
        ruang(22);
        const x0 = MARGIN + 4 + bl.level * 14;
        const y = doc.y;
        doc.fillColor(C.teks).font("Helvetica").fontSize(8.8).text(bl.no !== undefined ? `${bl.no}.` : "•", x0, y, { width: 16, lineBreak: false });
        doc.y = y;
        tulisInline(bl.teks, x0 + 16, LEBAR - (x0 - MARGIN) - 16, 8.8);
        doc.moveDown(0.2);
        continue;
      }
      if (bl.t === "p") { ruang(22); tulisInline(bl.teks, MARGIN, LEBAR, 8.8); doc.moveDown(0.3); continue; }
      if (bl.t === "tabel") tabel(doc, bl.kepala, bl.baris, ruang);
    }
  } else if (!b.narasi_ok) {
    judulBagian("Narasi Briefing");
    doc.fillColor("#b45309").font("Helvetica-Bold").fontSize(9)
      .text("Narasi AI tidak tersedia minggu ini. Angka di halaman sebelumnya tetap dihitung dari sistem.", MARGIN, doc.y, { width: LEBAR });
  }

  // Footer semua halaman.
  const cetak = fmt(new Date().toISOString());
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    const m = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    const y = HAL_T - MARGIN - 10;
    doc.fillColor(C.redup).font("Helvetica").fontSize(7)
      .text(bersih(`Dokumen internal Direktur · Briefing Mingguan W${b.iso_week} ${b.iso_year} · dicetak ${cetak}${opts.oleh ? ` oleh ${opts.oleh}` : ""}`),
        MARGIN, y, { width: LEBAR - 60, lineBreak: false })
      .text(`Hal. ${i + 1}/${range.count}`, MARGIN + LEBAR - 56, y, { width: 56, align: "right", lineBreak: false });
    doc.page.margins.bottom = m;
  }

  doc.end();
  return selesai;
}

/** Tabel markdown: lebar kolom proporsional panjang isi, teks dibungkus, kepala diulang saat pindah halaman. */
function tabel(doc: Doc, kepala: string[], baris: string[][], ruang: (t: number) => void) {
  const n = kepala.length;
  // Lebar kolom ~ kata terpanjang (tak boleh terpotong) dan rata-rata isi (sisa ruang).
  doc.font("Helvetica-Bold").fontSize(7.5);
  const kataTerpanjang = kepala.map((_, k) => Math.max(...[kepala, ...baris].flatMap((r) =>
    bersih((r[k] ?? "").replace(/\*\*/g, "")).split(/\s+/).map((w) => doc.widthOfString(w))), 10) + 10);
  const panjang = kepala.map((_, k) => Math.max(...[kepala, ...baris].map((r) => bersih((r[k] ?? "").replace(/\*\*/g, "")).length), 3));
  const total = panjang.reduce((a, b) => a + Math.min(b, 60), 0);
  const lebarKol = panjang.map((p, k) => Math.max(kataTerpanjang[k], (Math.min(p, 60) / total) * LEBAR));
  const skala = LEBAR / lebarKol.reduce((a, b) => a + b, 0);
  for (let k = 0; k < n; k++) lebarKol[k] *= skala;
  const pad = 4;
  const tinggiBaris = (sel: string[], bold: boolean) => Math.max(...sel.map((s, k) => {
    doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(7.5);
    return doc.heightOfString(bersih(s.replace(/\*\*/g, "")) || " ", { width: lebarKol[k] - pad * 2 });
  })) + pad * 2;
  const gambar = (sel: string[], y: number, h: number, kepalaBaris: boolean, zebra: boolean) => {
    if (kepalaBaris) doc.save().rect(MARGIN, y, LEBAR, h).fill(C.kepala).restore();
    else if (zebra) doc.save().rect(MARGIN, y, LEBAR, h).fill(C.zebra).restore();
    let x = MARGIN;
    sel.forEach((s, k) => {
      const tebal = kepalaBaris || /^\*\*.*\*\*$/.test(s.trim());
      doc.fillColor(kepalaBaris ? "#ffffff" : C.teks).font(tebal ? "Helvetica-Bold" : "Helvetica").fontSize(7.5)
        .text(bersih(s.replace(/\*\*/g, "")), x + pad, y + pad, { width: lebarKol[k] - pad * 2 });
      x += lebarKol[k];
    });
    doc.save().moveTo(MARGIN, y + h).lineTo(MARGIN + LEBAR, y + h).strokeColor(C.garis).lineWidth(0.5).stroke().restore();
    doc.y = y; // doc.text() di atas menggeser kursor — pemanggil yang menambah tinggi baris
  };
  ruang(40);
  doc.moveDown(0.2);
  const hK = tinggiBaris(kepala, true);
  gambar(kepala, doc.y, hK, true, false);
  doc.y += hK;
  baris.forEach((r, i) => {
    const h = tinggiBaris(r, false);
    if (doc.y + h > BATAS) {
      doc.addPage();
      gambar(kepala, doc.y, hK, true, false);
      doc.y += hK;
    }
    gambar(r, doc.y, h, false, i % 2 === 1);
    doc.y += h;
  });
  doc.moveDown(0.5);
}
