// Export deck PPTX untuk WatchPoint Weekly.
//
// Mereplikasi slide "STATUS WATCHPOINT" pada deck Weekly Report HoD:
//   kolom WATCHPOINT · TARGET · AKTUAL W-xx · STATUS · TREND · KETERANGAN.
//
// Isi deck (semua HoD):
//   1. Cover        — periode + minggu + ringkasan status
//   2. Ringkasan    — 1 baris per HoD (status + hitungan hijau/kuning/merah)
//   3..N. Per HoD   — tabel WatchPoint minggu tsb
//
// Angka SELALU datang dari getWeeklyBoard() — generator ini murni penyaji,
// tidak menghitung apa pun sendiri (biar deck & dashboard tak pernah beda).

import * as pptxgenjs from "pptxgenjs";

import { fmtValue, type WeeklyBoard, type WeeklyHod, type WeeklyMetric } from "./watchpoint-weekly.js";
import type { WatchStatus, WatchTrend } from "./watchpoint.js";

// Tipe pptxgenjs dipakai lewat `pptxgenjs.default` (class + namespace ada di
// default export). Sisi VALUE-nya perlu cast: file .d.ts pptxgenjs memakai
// `export as namespace PptxGenJS` + `export default PptxGenJS` dengan nama yang
// sama, sehingga TS mengikat default ke module namespace (tak constructable).
// Runtime-nya normal — hanya deklarasi tipenya yang keliru.
type Deck = pptxgenjs.default;
type Slide = ReturnType<Deck["addSlide"]>;
type TableRow = pptxgenjs.default.TableRow;
const PptxDeck = pptxgenjs.default as unknown as new () => Deck;

// Palet: biru korporat + status hijau/kuning/merah (kontras cukup di proyektor).
const C = {
  navy: "0B2A4A",
  blue: "1B5E9E",
  blueSoft: "EAF2FA",
  ink: "1F2937",
  muted: "6B7280",
  line: "D6DEE7",
  white: "FFFFFF",
  green: "15803D",
  greenBg: "E7F6EC",
  amber: "B45309",
  amberBg: "FEF3E2",
  red: "B91C1C",
  redBg: "FDECEC",
  naBg: "F1F3F5",
};

const STATUS_TEXT: Record<WatchStatus, string> = {
  GREEN: "HIJAU", YELLOW: "KUNING", RED: "MERAH", NA: "N/A",
};
const STATUS_FILL: Record<WatchStatus, string> = {
  GREEN: C.greenBg, YELLOW: C.amberBg, RED: C.redBg, NA: C.naBg,
};
const STATUS_COLOR: Record<WatchStatus, string> = {
  GREEN: C.green, YELLOW: C.amber, RED: C.red, NA: C.muted,
};
const TREND_TEXT: Record<WatchTrend, string> = {
  improving: "▲ Naik", stable: "= Stabil", declining: "▼ Turun",
};
const TREND_COLOR: Record<WatchTrend, string> = {
  improving: C.green, stable: C.muted, declining: C.red,
};

// Milestone (target null) tak punya angka — nilainya state, sama seperti di UI.
const MILESTONE: Record<WatchStatus, string> = { GREEN: "Live", YELLOW: "WIP", RED: "Off", NA: "—" };

function targetText(m: WeeklyMetric): string {
  if (m.target === null) return "Milestone";
  const prefix = m.direction === "higher" ? "≥ " : "≤ ";
  return prefix + fmtValue(m.target, m.unit);
}

function actualText(m: WeeklyMetric): string {
  if (m.target === null) return MILESTONE[m.status];
  const v = fmtValue(m.actual, m.unit);
  return m.pct === null ? v : `${v} (${Math.round(m.pct)}%)`;
}

function countByStatus(hod: WeeklyHod): Record<WatchStatus, number> {
  const c: Record<WatchStatus, number> = { GREEN: 0, YELLOW: 0, RED: 0, NA: 0 };
  for (const m of hod.metrics) c[m.status]++;
  return c;
}

// ── Elemen berulang ───────────────────────────────────────────────
function headerBar(slide: Slide, title: string, subtitle: string): void {
  slide.addShape("rect", { x: 0, y: 0, w: "100%", h: 0.95, fill: { color: C.navy } });
  slide.addText(title, {
    x: 0.45, y: 0.12, w: 8.6, h: 0.42, fontSize: 20, bold: true, color: C.white, fontFace: "Arial",
  });
  slide.addText(subtitle, {
    x: 0.45, y: 0.52, w: 8.6, h: 0.3, fontSize: 11, color: "BBD0E3", fontFace: "Arial",
  });
  slide.addText("WAHANALIFELINE", {
    x: 7.6, y: 0.3, w: 2.0, h: 0.35, fontSize: 11, bold: true, color: C.white,
    align: "right", fontFace: "Arial",
  });
}

function footer(slide: Slide, text: string): void {
  slide.addShape("line", { x: 0.45, y: 5.15, w: 9.1, h: 0, line: { color: C.line, width: 1 } });
  slide.addText(text, {
    x: 0.45, y: 5.2, w: 9.1, h: 0.3, fontSize: 9, color: C.muted, fontFace: "Arial",
  });
}

// ── Slide ─────────────────────────────────────────────────────────
function coverSlide(pptx: Deck, board: WeeklyBoard): void {
  const slide = pptx.addSlide();
  slide.background = { color: C.navy };

  slide.addText("WEEKLY REPORT", {
    x: 0.8, y: 1.45, w: 8.4, h: 0.55, fontSize: 34, bold: true, color: C.white, fontFace: "Arial",
  });
  slide.addText("STATUS WATCHPOINT HoD", {
    x: 0.8, y: 2.0, w: 8.4, h: 0.5, fontSize: 22, color: "8FB8DC", fontFace: "Arial",
  });
  slide.addShape("line", { x: 0.8, y: 2.65, w: 3.0, h: 0, line: { color: "3D7CB8", width: 3 } });

  const tally = board.hods.reduce(
    (a, h) => { a[h.status]++; return a; },
    { GREEN: 0, YELLOW: 0, RED: 0, NA: 0 } as Record<WatchStatus, number>,
  );

  slide.addText(
    [
      { text: `${board.label} · ${board.periode}\n`, options: { fontSize: 16, bold: true, color: C.white } },
      { text: `${board.hods.length} Head of Department · `, options: { fontSize: 13, color: "BBD0E3" } },
      { text: `${tally.GREEN} hijau `, options: { fontSize: 13, color: "7BD59A" } },
      { text: `· ${tally.YELLOW} kuning `, options: { fontSize: 13, color: "F5C578" } },
      { text: `· ${tally.RED} merah`, options: { fontSize: 13, color: "F19C9C" } },
    ],
    { x: 0.8, y: 2.9, w: 8.4, h: 0.9, fontFace: "Arial" },
  );

  slide.addText(
    `${board.isCurrent ? "Minggu berjalan — angka belum final" : "Minggu final"} · dibuat WRG-OS ${new Date(board.asOf).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })} WIB`,
    { x: 0.8, y: 4.6, w: 8.4, h: 0.3, fontSize: 10, color: "7E9CB8", fontFace: "Arial" },
  );
}

function summarySlide(pptx: Deck, board: WeeklyBoard): void {
  const slide = pptx.addSlide();
  headerBar(slide, `RINGKASAN WATCHPOINT ${board.label}`, `${board.periode} · status terburuk per HoD menentukan warna`);

  const head = ["HEAD OF DEPARTMENT", "PERAN", "STATUS", "HIJAU", "KUNING", "MERAH", "N/A"];
  const rows: TableRow[] = [
    head.map((t) => ({
      text: t,
      options: { bold: true, color: C.white, fill: { color: C.blue }, fontSize: 10, align: "center" as const },
    })),
  ];

  for (const h of board.hods) {
    const c = countByStatus(h);
    rows.push([
      { text: h.name, options: { bold: true, color: C.ink, fontSize: 11 } },
      { text: h.role, options: { color: C.muted, fontSize: 10 } },
      {
        text: STATUS_TEXT[h.status],
        options: { bold: true, color: STATUS_COLOR[h.status], fill: { color: STATUS_FILL[h.status] }, fontSize: 10, align: "center" as const },
      },
      { text: String(c.GREEN), options: { color: C.green, fontSize: 10, align: "center" as const } },
      { text: String(c.YELLOW), options: { color: C.amber, fontSize: 10, align: "center" as const } },
      { text: String(c.RED), options: { color: C.red, fontSize: 10, align: "center" as const } },
      { text: String(c.NA), options: { color: C.muted, fontSize: 10, align: "center" as const } },
    ]);
  }

  slide.addTable(rows, {
    x: 0.45, y: 1.2, w: 9.1,
    colW: [2.3, 2.6, 1.3, 0.73, 0.83, 0.73, 0.58],
    border: { type: "solid", color: C.line, pt: 1 },
    fontFace: "Arial", valign: "middle", rowH: 0.32, autoPage: false,
  });

  footer(slide, `Gate: ${board.meta.gate}`);
}

function hodSlide(pptx: Deck, board: WeeklyBoard, hod: WeeklyHod): void {
  const slide = pptx.addSlide();
  headerBar(slide, `WATCHPOINT — ${hod.name.toUpperCase()}`, `${hod.role} · ${board.label} · ${board.periode}`);

  slide.addText(STATUS_TEXT[hod.status], {
    x: 8.1, y: 1.15, w: 1.45, h: 0.32, fontSize: 11, bold: true, align: "center", valign: "middle",
    color: STATUS_COLOR[hod.status], fill: { color: STATUS_FILL[hod.status] }, fontFace: "Arial",
  });

  const head = ["WATCHPOINT", "TARGET", `AKTUAL ${board.label}`, "STATUS", "TREND", "KETERANGAN"];
  const rows: TableRow[] = [
    head.map((t) => ({
      text: t,
      options: { bold: true, color: C.white, fill: { color: C.blue }, fontSize: 10 },
    })),
  ];

  hod.metrics.forEach((m, i) => {
    const zebra = i % 2 === 1 ? { color: C.blueSoft } : { color: C.white };
    rows.push([
      { text: m.label, options: { bold: true, color: C.ink, fontSize: 10, fill: zebra } },
      { text: targetText(m), options: { color: C.muted, fontSize: 10, fill: zebra } },
      { text: actualText(m), options: { bold: true, color: C.ink, fontSize: 10, fill: zebra } },
      {
        text: STATUS_TEXT[m.status],
        options: { bold: true, color: STATUS_COLOR[m.status], fill: { color: STATUS_FILL[m.status] }, fontSize: 10, align: "center" as const },
      },
      { text: TREND_TEXT[m.trend], options: { color: TREND_COLOR[m.trend], fontSize: 9, align: "center" as const, fill: zebra } },
      { text: m.note ?? "—", options: { color: C.muted, fontSize: 8, fill: zebra } },
    ]);
  });

  slide.addTable(rows, {
    x: 0.45, y: 1.6, w: 9.1,
    colW: [2.3, 1.35, 1.5, 0.95, 0.9, 2.1],
    border: { type: "solid", color: C.line, pt: 1 },
    fontFace: "Arial", valign: "middle", autoPage: false,
  });

  const c = countByStatus(hod);
  footer(slide, `${board.label}: ${c.GREEN} hijau · ${c.YELLOW} kuning · ${c.RED} merah · ${c.NA} belum ada data`);
}

/** Nama file deck, mis. "WatchPoint-Weekly-W30-2026.pptx". */
export function weeklyDeckFilename(board: WeeklyBoard): string {
  return `WatchPoint-Weekly-${board.label}-${board.isoYear}.pptx`;
}

/**
 * Bangun deck PPTX untuk satu minggu.
 * `hodKey` opsional → deck 1 HoD saja (cover + slide HoD tsb).
 */
export async function buildWeeklyDeck(board: WeeklyBoard, hodKey?: string): Promise<Buffer> {
  const hods = hodKey ? board.hods.filter((h) => h.key === hodKey) : board.hods;
  const scoped: WeeklyBoard = { ...board, hods };

  const pptx = new PptxDeck();
  pptx.layout = "LAYOUT_16x9";
  pptx.author = "WRG-OS";
  pptx.company = "Wahana Lifeline";
  pptx.title = `WatchPoint Weekly ${board.label} ${board.isoYear}`;
  pptx.subject = `Status WatchPoint HoD ${board.periode}`;

  coverSlide(pptx, scoped);
  if (hods.length > 1) summarySlide(pptx, scoped);
  for (const h of hods) hodSlide(pptx, scoped, h);

  const out = await pptx.write({ outputType: "nodebuffer" });
  return out as Buffer;
}
