// Parser format #PLAN/#REPORT NYATA tim WRG (port dari legacy wrg-inbound.sh,
// divalidasi terhadap capture openclaw asli). Pure function — tanpa DB.
//
// Format real (bukan customer|tujuan|goal):
//   #plan <nama> [tgl]            #report <nama> [tgl]
//   1. item ...                   1. item ... <status/hasil>
//   2. item ...                      - sub-detail
//      - sub-detail              ...
//
// → #PLAN  = TODO harian (items[]) → sales_todo
// → #REPORT= item + hasil → tandai sales_todo reported + report_data
import { buildIso } from "./tanggal.js";

export interface DailyParse {
  kind: "plan" | "report";
  name: string | null; // nama setelah #plan/#report (display; AM utama via pushname)
  tanggal: string | null; // ISO YYYY-MM-DD; null → caller pakai hari ini
  items: string[]; // tiap item bernomor (continuation/sub-baris digabung)
  itemCount: number;
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, mei: 5, may: 5, jun: 6, jul: 7,
  agu: 8, agt: 8, ags: 8, aug: 8, sep: 9, okt: 10, oct: 10, nov: 11, des: 12, dec: 12,
};

// Cari tanggal di sebuah teks. Dukungan: DD/MM/YYYY, DD-MM-YYYY, DD-MM-YY,
// DD <bulan> YYYY (ID/EN). Return {iso, matched} atau null.
// Tahun divalidasi di buildIso (parsers/tanggal.ts) — bareng am.ts.
function findDate(text: string, nowMs?: number): { iso: string; matched: string } | null {
  // DD <month-word> [YYYY]
  const m1 = text.match(/(\d{1,2})\s+([A-Za-z]{3,9})\.?\s*(\d{2,4})?/);
  if (m1) {
    const mon = MONTHS[m1[2].slice(0, 3).toLowerCase()];
    if (mon) {
      const iso = buildIso(Number(m1[1]), mon, m1[3], nowMs);
      if (iso) return { iso, matched: m1[0] };
    }
  }
  // DD[/-]MM[/-]YY(YY)
  const m2 = text.match(/(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
  if (m2) {
    const iso = buildIso(Number(m2[1]), Number(m2[2]), m2[3], nowMs);
    if (iso) return { iso, matched: m2[0] };
  }
  return null;
}

const HASHTAG_LINE = /^\s*#\s*(plan|report)\b/i;
// item bernomor: "1." "2)" "3:" "1 ." dst di awal baris
const ITEM_LINE = /^\s*(\d{1,2})\s*[.):]\s*(.*)$/;

// Zero-width & bidi formatting marks. WhatsApp sering menyisipkan U+200E (LRM)
// tepat sebelum '#' atau nomor pada konten campur RTL/LTR → anchor ^\s*# /
// ^\s*\d gagal (\s tak match karakter ini) → submission terbaca "no-hashtag".
// Buang dulu sebelum parsing. ZWSP/ZWNJ/ZWJ/LRM/RLM, bidi embed/override/isolate,
// word-joiner, BOM.
// Rentang code point (ASCII source, tanpa karakter literal tak terlihat):
// 200B-200F (ZWSP/ZWNJ/ZWJ/LRM/RLM), 202A-202E (bidi embed/override),
// 2060-2064 (word-joiner/invisible ops), 2066-2069 (bidi isolate), FEFF (BOM).
const INVISIBLE_MARKS = new RegExp(
  "[\\u200B-\\u200F\\u202A-\\u202E\\u2060-\\u2064\\u2066-\\u2069\\uFEFF]",
  "g",
);
export function stripInvisible(s: string): string {
  return s.replace(INVISIBLE_MARKS, "");
}

// Deteksi apakah body submission #plan/#report (line-anchored). Hindari
// false-positive teks tengah kalimat ("FORMAT #PLAN"). Return kind atau null.
export function detectDaily(body: string | null): "plan" | "report" | null {
  if (!body) return null;
  for (const line of stripInvisible(body).split(/\r?\n/)) {
    const m = line.match(HASHTAG_LINE);
    if (m) return m[1].toLowerCase() as "plan" | "report";
  }
  return null;
}

export function parseDaily(body: string, nowMs?: number): DailyParse | null {
  const lines = stripInvisible(body).split(/\r?\n/);
  // index baris hashtag
  let hIdx = -1;
  let kind: "plan" | "report" = "plan";
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(HASHTAG_LINE);
    if (m) {
      hIdx = i;
      kind = m[1].toLowerCase() as "plan" | "report";
      break;
    }
  }
  if (hIdx < 0) return null;

  // Header: sisa baris hashtag setelah "#plan/#report"
  const headerRest = lines[hIdx].replace(HASHTAG_LINE, "").trim();
  // tanggal: dari header dulu, kalau tidak ada cek 1-2 baris berikutnya
  let tanggal: string | null = null;
  let nameSrc = headerRest;
  const dh = findDate(headerRest, nowMs);
  if (dh) {
    tanggal = dh.iso;
    nameSrc = headerRest.replace(dh.matched, " "); // buang tanggal dari sumber nama
  } else {
    for (let j = hIdx + 1; j <= Math.min(hIdx + 2, lines.length - 1); j++) {
      const dn = findDate(lines[j], nowMs);
      if (dn && !ITEM_LINE.test(lines[j])) {
        tanggal = dn.iso;
        break;
      }
    }
  }
  // nama: bersihkan "tgl"/"tanggal" + sisa non-alfanumerik tepi
  const name =
    nameSrc
      .replace(/\b(tgl|tanggal|tanngal|date)\b\.?:?/gi, " ")
      .replace(/[^\p{L}\p{N}\s.'-]/gu, " ")
      .replace(/\s+/g, " ")
      .trim() || null;

  // items: kumpulkan baris bernomor + continuation
  const items: string[] = [];
  let cur: string | null = null;
  for (let i = hIdx + 1; i < lines.length; i++) {
    const raw = lines[i];
    const im = raw.match(ITEM_LINE);
    if (im) {
      if (cur !== null) items.push(cur.trim());
      cur = im[2].trim();
    } else if (cur !== null) {
      const t = raw.trim();
      if (t) cur += " " + t; // continuation/sub-detail digabung
    }
  }
  if (cur !== null) items.push(cur.trim());

  // Fallback: sebagian AM tak menomori (free-form) → pakai tiap baris non-kosong
  // setelah header sebagai item (buang baris tanggal-saja).
  if (items.length === 0) {
    for (let i = hIdx + 1; i < lines.length; i++) {
      const t = lines[i].trim();
      if (!t) continue;
      const dd = findDate(t, nowMs);
      if (dd && t.replace(dd.matched, "").replace(/\b(tgl|tanggal)\b\.?:?/gi, "").trim().length <= 3) continue; // baris tanggal-saja
      items.push(t);
    }
  }

  const cleaned = items.map((s) => s.replace(/\s+/g, " ").trim()).filter(Boolean);
  return { kind, name, tanggal, items: cleaned, itemCount: cleaned.length };
}
