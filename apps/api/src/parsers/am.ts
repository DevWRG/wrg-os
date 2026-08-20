// Parser format AM per-customer (#PLAN/#REPORT) — port legacy handle_plan_am /
// handle_report_am, divalidasi vs capture nyata. Pure function (tanpa DB).
//
// #PLAN AM: `customer | tujuan | goal` (multi, nomor di-strip) atau cust:/tujuan:/goal:.
// #REPORT AM: blok per-customer — `N. Customer` + `hasil: ...` / `next: ...`
//   (multi-baris), atau inline `Customer | hasil… | next…`.
import { normalizeTujuan } from "./tujuan.js";
import { buildIso } from "./tanggal.js";
// dailyplan.ts sudah membuang mark tak terlihat sejak lama; am.ts TIDAK, dan itu
// menghasilkan baris sampah di activity_log (lihat catatan di bawah).
import { stripInvisible } from "./dailyplan.js";

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, mei: 5, may: 5, jun: 6, jul: 7,
  agu: 8, agt: 8, ags: 8, aug: 8, sep: 9, okt: 10, oct: 10, nov: 11, des: 12, dec: 12,
};
// Tahun divalidasi di buildIso (parsers/tanggal.ts) — bareng dailyplan.ts.
function findDate(text: string, nowMs?: number): string | null {
  const m1 = text.match(/(\d{1,2})\s+([A-Za-z]{3,9})\.?\s*(\d{2,4})?/);
  if (m1) {
    const mon = MONTHS[m1[2].slice(0, 3).toLowerCase()];
    if (mon) {
      const iso = buildIso(Number(m1[1]), mon, m1[3], nowMs);
      if (iso) return iso;
    }
  }
  const m2 = text.match(/(\d{1,2})[/-]\s?(\d{1,2})[/-]\s?(\d{2,4})/);
  if (m2) {
    const iso = buildIso(Number(m2[1]), Number(m2[2]), m2[3], nowMs);
    if (iso) return iso;
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
function headerDate(lines: string[], hIdx: number, nowMs?: number): string | null {
  const rest = lines[hIdx].replace(HASH, "");
  const dh = findDate(rest, nowMs);
  if (dh) return dh;
  for (let j = hIdx + 1; j <= Math.min(hIdx + 3, lines.length - 1); j++) {
    if (/^\s*tgl|tanggal/i.test(lines[j]) || !/[a-z]/i.test(lines[j].replace(/\d|[/-]/g, ""))) {
      const d = findDate(lines[j], nowMs);
      if (d) return d;
    }
  }
  return null;
}

/**
 * Buang prefiks "Cust :" dari nama faskes SEBELUM dicocokkan ke plan.
 *
 * AM sering menulis `Cust : RS PHC` di #REPORT — 834 dari 2.775 baris
 * activity_log membawanya. Prefiks itu ikut dihitung sebagai trigram oleh
 * pg_trgm, jadi ia menggerus skor kecocokan terhadap nama plan yang bersih
 * (`sales_plan` NOL baris berprefiks). Akibatnya kunjungan yang benar
 * terlihat seperti tidak cocok.
 *
 * Dibatasi HANYA pada `cust`/`customer`, tidak digeneralisasi ke pola
 * `kata:` apa pun — prefiks lain yang muncul di data justru BERMAKNA
 * (`PT` nama perusahaan, `dr` nama dokter) dan membuangnya akan merusak nama.
 *
 * Tanda kurung di ekor SENGAJA dibiarkan: isinya diperiksa dan ternyata
 * catatan bermakna ("Laborat Sentral", "Semarang", "cost per test"), bukan
 * derau — membuangnya berisiko menghapus pembeda antar faskes.
 *
 * Diukur pada 2.745 baris berskor: 758 skor naik (rata-rata +0,169 di band
 * bawah), 88 dari 176 baris band-bawah melewati 0,7, dan NOL baris jatuh ke
 * bawah ambang yang berlaku. Tidak pernah mengembalikan string kosong.
 */
export function bersihkanNamaCustomer(nama: string): string {
  const bersih = nama.replace(/^\s*cust(?:omer)?\s*[:.]\s*/i, "").trim();
  return bersih || nama.trim();
}

export interface PlanCustomer { customer: string; tujuan: string; goal: string }
export interface AmPlanResult { tanggal: string | null; customers: PlanCustomer[] }

export function parseAmPlan(body: string, nowMs?: number): AmPlanResult {
  const lines = stripInvisible(body).split(/\r?\n/);
  let hIdx = lines.findIndex((l) => HASH.test(l));
  if (hIdx < 0) hIdx = 0;
  const tanggal = headerDate(lines, hIdx, nowMs);
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

// Tanda baca pembuka ditoleransi: AM nyata menulis ".      next: kawal pengadaan",
// dan tanpa toleransi ini baris tersebut lolos jadi "customer" bernama titik.
const FIELD = /^\s*[.\-•*]*\s*(hasil(?:nya)?|next|tindak\s*lanjut|tipe|jenis)\s*:?\s*(.*)$/i;
const NOTE = /^\s*[.\-•*]*\s*note\s*:?\s*(.+)$/i;

/**
 * Panjang minimum nama faskes yang masuk akal. Di bawah ini hampir pasti derau
 * (sisa tanda baca, satu huruf). Nama faskes terpendek yang nyata di data
 * berukuran jauh di atas ini.
 */
const MIN_NAMA_CUSTOMER = 3;
// bersihkan tanggal dari teks → sisanya keterangan
function dateMatchText(s: string): string | null {
  const m1 = s.match(/\d{1,2}\s+[A-Za-z]{3,9}\.?(?:\s+\d{2,4})?/);
  if (m1 && MONTHS[m1[0].match(/[A-Za-z]{3,}/)?.[0]?.slice(0, 3).toLowerCase() ?? ""]) return m1[0];
  const m2 = s.match(/\d{1,2}[/-]\s?\d{1,2}[/-]\s?\d{2,4}/);
  return m2 ? m2[0] : null;
}

export function parseAmReport(body: string, nowMs?: number): AmReportResult {
  // WhatsApp menyisipkan U+200E (LRM) dsb di awal baris pada konten campur
  // RTL/LTR. Tanpa dibuang, anchor `^\s*#` GAGAL — `\s` tak match karakter itu —
  // sehingga baris header "#Report Irul 18/8/2026" lolos dan tersimpan sebagai
  // customer. `.trim()` juga tak membuangnya, jadi baris yang tampak kosong
  // menjadi customer bernama karakter tak terlihat. Terhitung di produksi:
  // 27 baris header + 35 baris kosong + 184 baris memuat mark tak terlihat.
  // dailyplan.ts sudah melakukan ini sejak lama; am.ts terlewat.
  const lines = stripInvisible(body).split(/\r?\n/);
  let hIdx = lines.findIndex((l) => HASH.test(l));
  if (hIdx < 0) hIdx = 0;
  const tanggal = headerDate(lines, hIdx, nowMs);
  const items: ReportItem[] = [];
  const notes: ReportNote[] = [];
  let cur: ReportItem | null = null;
  // Kandidat nama faskes yang jelas bukan nama: kosong, sisa tanda baca, atau
  // baris hashtag yang lolos saringan di atas.
  const namaMasukAkal = (s: string): boolean => {
    const v = s.trim();
    if (v.length < MIN_NAMA_CUSTOMER) return false;
    if (HASH.test(v)) return false;
    if (/^[\s.\-•*_,:;|]+$/.test(v)) return false;
    return true;
  };
  const push = () => { if (cur && namaMasukAkal(cur.customer)) items.push(cur); };

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
      const reminder_date = dm ? findDate(dm, nowMs) : null;
      const keterangan = (dm ? content.replace(dm, " ") : content).replace(/\s+/g, " ").trim();
      notes.push({ customer: cur?.customer ?? null, reminder_date, keterangan });
      continue;
    }

    const fm = t.match(FIELD);
    const numbered = /^\s*\d+\s*[.)]/.test(raw);

    // Baris hasil:/next:/tipe: TANPA customer berjalan tidak punya tempat
    // menempel — dulu ia jatuh ke cabang "customer baru" dan tersimpan sebagai
    // faskes bernama "next: kawal pengadaan". Dibuang, bukan ditebak.
    if (fm && !cur && !numbered) continue;

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
      // Kandidat yang jelas bukan nama faskes DILEWATI, bukan sekadar dibuang
      // saat push(): kalau ia tetap dibuat, baris faskes berikutnya akan
      // tersedot jadi `hasil`-nya dan kunjungan nyata itu hilang.
      if (!namaMasukAkal(line)) continue;
      push();
      cur = { customer: line, hasil: "", next_action: "", activity_type: null };
      continue;
    }

    // non-field continuation tanpa label → tambah ke hasil
    if (cur && !fm) cur.hasil = (cur.hasil ? cur.hasil + " " : "") + t;
  }
  push();
  return { tanggal, items: items.filter((it) => namaMasukAkal(it.customer)), notes };
}
