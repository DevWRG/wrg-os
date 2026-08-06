// Parser format AM per-customer (#PLAN/#REPORT) — port legacy handle_plan_am /
// handle_report_am, divalidasi vs capture nyata. Pure function (tanpa DB).
//
// #PLAN AM: `customer | tujuan | goal` (multi, nomor di-strip) atau cust:/tujuan:/goal:.
// #REPORT AM: blok per-customer — `N. Customer` + `hasil: ...` / `next: ...`
//   (multi-baris), atau inline `Customer | hasil… | next…`.
import { normalizeTujuan } from "./tujuan.js";

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, mei: 5, may: 5, jun: 6, jul: 7,
  agu: 8, agt: 8, ags: 8, aug: 8, sep: 9, okt: 10, oct: 10, nov: 11, des: 12, dec: 12,
};
const pad = (n: number) => String(n).padStart(2, "0");
const yyyy = (y: number) => (y < 100 ? 2000 + y : y);

function findDate(text: string): string | null {
  const m1 = text.match(/(\d{1,2})\s+([A-Za-z]{3,9})\.?\s*(\d{2,4})?/);
  if (m1) {
    const mon = MONTHS[m1[2].slice(0, 3).toLowerCase()];
    if (mon) {
      const d = Number(m1[1]);
      const y = m1[3] ? yyyy(Number(m1[3])) : new Date(Date.now() + 7 * 3600 * 1000).getUTCFullYear();
      if (d >= 1 && d <= 31) return `${y}-${pad(mon)}-${pad(d)}`;
    }
  }
  const m2 = text.match(/(\d{1,2})[/-]\s?(\d{1,2})[/-]\s?(\d{2,4})/);
  if (m2) {
    const d = Number(m2[1]), mon = Number(m2[2]), y = yyyy(Number(m2[3]));
    if (d >= 1 && d <= 31 && mon >= 1 && mon <= 12) return `${y}-${pad(mon)}-${pad(d)}`;
  }
  return null;
}

const HASH = /^\s*#\s*(plan|report)\b/i;
const stripNum = (s: string) => s.replace(/^\s*\d+\s*[.)]\s*[^A-Za-z(]*/, "").trim();

// Pemisah segmen: pipe (format lama) ATAU em/en dash (format terstruktur CRM
// Fase 1: `[CUSTOMER] — [HASIL] — [NEXT STEP]`). Hyphen biasa `-` SENGAJA tak
// diterima — terlalu sering muncul di dalam nama faskes ("RS Al-Islam") dan di
// teks hasil, jadi akan memotong kalimat di tempat yang salah.
const SEP = /\s*[|—–]\s*/;
export const hasSegments = (line: string): boolean => /[|—–]/.test(line);
export const splitSegments = (line: string): string[] => line.split(SEP).map((p) => p.trim());

// Tipe aktivitas kanonik (migrasi 068 activity_log.activity_type CHECK).
export const ACTIVITY_TYPES = ["Fisik", "Telepon", "WA", "Demo", "Presentasi", "Follow-up"] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

const TYPE_ALIAS: Record<string, ActivityType> = {
  fisik: "Fisik", kunjungan: "Fisik", visit: "Fisik", onsite: "Fisik", langsung: "Fisik",
  telepon: "Telepon", telp: "Telepon", tlp: "Telepon", call: "Telepon", phone: "Telepon",
  wa: "WA", whatsapp: "WA", chat: "WA",
  demo: "Demo", trial: "Demo", uji: "Demo",
  presentasi: "Presentasi", presentation: "Presentasi", present: "Presentasi", paparan: "Presentasi",
  "follow-up": "Follow-up", followup: "Follow-up", "follow up": "Follow-up", fu: "Follow-up",
};

// Normalisasi teks bebas → tipe kanonik. null bila tak dikenali (biar caller
// yang menentukan default; jangan tebak "Fisik" di sini — salah-tebak bikin
// KPI kunjungan fisik menggelembung).
export function normalizeActivityType(input: string | null | undefined): ActivityType | null {
  const k = (input ?? "").trim().toLowerCase();
  if (!k) return null;
  return TYPE_ALIAS[k] ?? null;
}
// header line + cari tgl (scope: baris header + 2 baris berikut, sebelum item)
function headerDate(lines: string[], hIdx: number): string | null {
  const rest = lines[hIdx].replace(HASH, "");
  const dh = findDate(rest);
  if (dh) return dh;
  for (let j = hIdx + 1; j <= Math.min(hIdx + 3, lines.length - 1); j++) {
    if (/^\s*tgl|tanggal/i.test(lines[j]) || !/[a-z]/i.test(lines[j].replace(/\d|[/-]/g, ""))) {
      const d = findDate(lines[j]);
      if (d) return d;
    }
  }
  return null;
}

export interface PlanCustomer { customer: string; tujuan: string; goal: string }
export interface AmPlanResult { tanggal: string | null; customers: PlanCustomer[] }

export function parseAmPlan(body: string): AmPlanResult {
  const lines = body.split(/\r?\n/);
  let hIdx = lines.findIndex((l) => HASH.test(l));
  if (hIdx < 0) hIdx = 0;
  const tanggal = headerDate(lines, hIdx);
  const customers: PlanCustomer[] = [];

  const pipeLines = lines.filter((l, i) => i !== hIdx && hasSegments(l) && !/^\s*\d+\s*[|—–]?\s*$/.test(l));
  if (pipeLines.length > 0) {
    for (const l of pipeLines) {
      if (HASH.test(l) || /^\s*tgl|tanggal/i.test(l)) continue;
      const parts = splitSegments(l);
      const customer = stripNum(parts[0]);
      if (!customer) continue;
      customers.push({ customer, tujuan: normalizeTujuan(parts[1] ?? ""), goal: parts[2] ?? "" });
    }
    return { tanggal, customers };
  }
  // single: cust/tujuan/goal
  const field = (name: string) =>
    lines.find((l) => new RegExp(`^\\s*${name}\\s*:`, "i").test(l))?.split(":").slice(1).join(":").trim() ?? "";
  const cust = field("cust");
  if (cust) {
    customers.push({ customer: cust, tujuan: normalizeTujuan(field("tujuan")), goal: field("goal") });
    return { tanggal, customers };
  }
  // fallback: numbered "N. Customer" (tanpa pipe) → customer-only
  for (let i = hIdx + 1; i < lines.length; i++) {
    const m = lines[i].match(/^\s*\d+\s*[.)]\s*(.+)$/);
    if (m && m[1].trim()) customers.push({ customer: m[1].trim(), tujuan: "", goal: "" });
  }
  return { tanggal, customers };
}

export interface ReportItem { customer: string; hasil: string; next_action: string; activity_type: ActivityType | null }
export interface ReportNote { customer: string | null; reminder_date: string | null; keterangan: string }
export interface AmReportResult { tanggal: string | null; items: ReportItem[]; notes: ReportNote[] }

const FIELD = /^\s*(hasil(?:nya)?|next|tindak\s*lanjut|tipe|jenis)\s*:?\s*(.*)$/i;
const NOTE = /^\s*note\s*:?\s*(.+)$/i;
// bersihkan tanggal dari teks → sisanya keterangan
function dateMatchText(s: string): string | null {
  const m1 = s.match(/\d{1,2}\s+[A-Za-z]{3,9}\.?(?:\s+\d{2,4})?/);
  if (m1 && MONTHS[m1[0].match(/[A-Za-z]{3,}/)?.[0]?.slice(0, 3).toLowerCase() ?? ""]) return m1[0];
  const m2 = s.match(/\d{1,2}[/-]\s?\d{1,2}[/-]\s?\d{2,4}/);
  return m2 ? m2[0] : null;
}

export function parseAmReport(body: string): AmReportResult {
  const lines = body.split(/\r?\n/);
  let hIdx = lines.findIndex((l) => HASH.test(l));
  if (hIdx < 0) hIdx = 0;
  const tanggal = headerDate(lines, hIdx);
  const items: ReportItem[] = [];
  const notes: ReportNote[] = [];
  let cur: ReportItem | null = null;
  const push = () => { if (cur && cur.customer) items.push(cur); };

  for (let i = hIdx + 1; i < lines.length; i++) {
    const raw = lines[i];
    const t = raw.trim();
    if (!t) continue;
    if (HASH.test(raw) || /^\s*tgl\b|^\s*tanggal\b/i.test(raw)) continue;

    // note: TGL keterangan → reminder, bind ke customer berjalan (positional).
    const nm = t.match(NOTE);
    if (nm) {
      const content = nm[1].trim();
      const dm = dateMatchText(content);
      const reminder_date = dm ? findDate(dm) : null;
      const keterangan = (dm ? content.replace(dm, " ") : content).replace(/\s+/g, " ").trim();
      notes.push({ customer: cur?.customer ?? null, reminder_date, keterangan });
      continue;
    }

    const fm = t.match(FIELD);
    const numbered = /^\s*\d+\s*[.)]/.test(raw);

    if (fm && cur && !numbered) {
      // hasil:/next:/tipe: untuk customer berjalan
      const label = fm[1].toLowerCase();
      if (label.startsWith("tipe") || label.startsWith("jenis")) {
        cur.activity_type = normalizeActivityType(fm[2]) ?? cur.activity_type;
      } else if (label.startsWith("next") || label.startsWith("tindak")) {
        cur.next_action = (cur.next_action ? cur.next_action + " " : "") + fm[2].trim();
      } else {
        cur.hasil = (cur.hasil ? cur.hasil + " " : "") + fm[2].trim();
      }
      continue;
    }

    // baris customer baru (numbered, atau non-field saat butuh customer baru)
    if (numbered || !cur || (cur.hasil && !fm)) {
      const line = stripNum(raw);
      // inline bersegmen: "Customer | hasil… | next…" atau "Customer — hasil — next [— tipe]"
      if (hasSegments(line)) {
        const parts = splitSegments(line);
        push();
        cur = {
          customer: parts[0],
          hasil: parts[1] ?? "",
          next_action: parts[2] ?? "",
          activity_type: normalizeActivityType(parts[3]),
        };
        // bersihkan label "hasil:"/"next:" bila ada di parts
        cur.hasil = cur.hasil.replace(FIELD, "$2").trim();
        cur.next_action = cur.next_action.replace(FIELD, "$2").trim();
        continue;
      }
      push();
      cur = { customer: line, hasil: "", next_action: "", activity_type: null };
      continue;
    }

    // non-field continuation tanpa label → tambah ke hasil
    if (cur && !fm) cur.hasil = (cur.hasil ? cur.hasil + " " : "") + t;
  }
  push();
  return { tanggal, items: items.filter((it) => it.customer), notes };
}
