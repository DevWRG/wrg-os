// WatchPoint Weekly — papan WatchPoint per MINGGU ISO + snapshot riwayat.
//
// Bedanya dengan watchpoint.ts (papan "sekarang"):
//   - Punya sumbu waktu: tiap minggu ISO (Sen–Min WIB) berdiri sendiri.
//   - Minggu berjalan  → nilai LIVE dari getWatchBoard(), boleh ditimpa input manual mingguan.
//   - Minggu lewat     → nilai dari tabel watchpoint_weekly (snapshot / input manual).
//     Minggu lewat TIDAK dihitung ulang hari ini — angka Juni harus tetap angka Juni.
//   - Trend = banding aktual minggu ini vs minggu sebelumnya (sadar arah metric),
//     bukan konstanta seperti di papan harian.
//
// Gate ambang & definisi metric TIDAK diduplikasi di sini — di-import dari
// watchpoint.ts supaya satu sumber kebenaran.

import { db, isDbEnabled } from "../db.js";
import {
  attainment, gate, worst, getWatchBoard,
  type WatchStatus, type WatchTrend, type HodWatch,
} from "./watchpoint.js";
import {
  wibToday, isoWeekOf, weekRange, periodeLabel, currentWeek, previousWeek,
} from "./watchpoint-week.js";

export interface WeeklyMetric {
  key: string;
  label: string;
  target: number | null;
  actual: number | null;
  prevActual: number | null;
  unit: string;
  direction: "higher" | "lower";
  source: "db" | "manual" | "live";
  pct: number | null;
  status: WatchStatus;
  trend: WatchTrend;
  note?: string;
}

export interface WeeklyHod {
  key: string;
  name: string;
  role: string;
  status: WatchStatus;
  metrics: WeeklyMetric[];
}

export interface WeeklyBoard {
  isoYear: number;
  isoWeek: number;
  label: string;      // "W30"
  periode: string;    // "21–27 Juli 2026"
  from: string;       // YYYY-MM-DD (Senin)
  to: string;         // YYYY-MM-DD (Minggu)
  isCurrent: boolean; // minggu berjalan → angka live, belum final
  saved: boolean;     // sudah ada baris tersimpan utk minggu ini
  asOf: string;
  hods: WeeklyHod[];
  meta: { gate: string; legend: Record<WatchStatus, string> };
}

export interface WeekRef {
  isoYear: number;
  isoWeek: number;
  label: string;
  periode: string;
  from: string;
  to: string;
  saved: boolean;
  isCurrent: boolean;
}

const LEGEND: Record<WatchStatus, string> = {
  GREEN: "≥ target",
  YELLOW: "50–99% target",
  RED: "< 50% target",
  NA: "Belum ada data",
};

const GATE_TEXT = "🟢 ≥ target · 🟡 50–99% · 🔴 < 50%";

// ── Kalender minggu ISO (basis WIB) ───────────────────────────────
// Implementasinya di watchpoint-week.ts (dipakai bersama papan "sekarang").
// Di-re-export dari sini supaya pemanggil lama tak perlu ganti jalur impor.
export { wibToday, isoWeekOf, weekRange, periodeLabel, currentWeek, previousWeek };

// ── Baris tersimpan ───────────────────────────────────────────────
interface StoredRow {
  target: number | null;
  actual: number | null;
  status: WatchStatus | null;
  note: string | null;
  source: "db" | "manual";
}

type Store = Map<string, StoredRow>; // key: `${hod_key}:${metric_key}`

const rowKey = (hod: string, metric: string) => `${hod}:${metric}`;

async function loadWeek(isoYear: number, isoWeek: number): Promise<Store> {
  const store: Store = new Map();
  if (!isDbEnabled()) return store;
  const sql = db();
  const rows = await sql<{
    hod_key: string; metric_key: string; target: string | null; actual: string | null;
    status: string | null; note: string | null; source: string;
  }[]>`
    SELECT hod_key, metric_key, target, actual, status, note, source
    FROM watchpoint_weekly
    WHERE iso_year = ${isoYear} AND iso_week = ${isoWeek}`;
  for (const r of rows) {
    store.set(rowKey(r.hod_key, r.metric_key), {
      target: r.target === null ? null : Number(r.target),
      actual: r.actual === null ? null : Number(r.actual),
      status: (r.status as WatchStatus | null) ?? null,
      note: r.note,
      source: r.source === "db" ? "db" : "manual",
    });
  }
  return store;
}

// ── Trend: banding minggu ini vs minggu lalu, sadar arah metric ────
// Ambang 2% supaya fluktuasi kecil tidak dibaca sebagai perubahan arah.
const TREND_EPS = 0.02;

function trendOf(actual: number | null, prev: number | null, dir: "higher" | "lower"): WatchTrend {
  if (actual === null || prev === null) return "stable";
  const base = Math.abs(prev);
  const delta = actual - prev;
  if (base > 0 && Math.abs(delta) / base < TREND_EPS) return "stable";
  if (delta === 0) return "stable";
  const better = dir === "higher" ? delta > 0 : delta < 0;
  return better ? "improving" : "declining";
}

// ── Papan mingguan ────────────────────────────────────────────────

/**
 * Papan WatchPoint untuk satu minggu ISO.
 *
 * Prioritas nilai per metric:
 *   1. baris manual minggu itu (input HoD)   → menang selalu
 *   2. baris snapshot 'db' minggu itu
 *   3. nilai live (HANYA bila minggu berjalan)
 *   4. selain itu → N/A
 */
export async function getWeeklyBoard(isoYear: number, isoWeek: number): Promise<WeeklyBoard> {
  const cur = currentWeek();
  const isCurrent = isoYear === cur.isoYear && isoWeek === cur.isoWeek;
  const { from, to } = weekRange(isoYear, isoWeek);

  const prevRef = previousWeek(isoYear, isoWeek);
  // Jendela = rentang minggu ISO yang diminta, BUKAN default bulan berjalan —
  // papan ini menyajikan angkanya sebagai capaian minggu tersebut.
  const [live, store, prevStore] = await Promise.all([
    getWatchBoard({ from, to }),
    loadWeek(isoYear, isoWeek),
    loadWeek(prevRef.isoYear, prevRef.isoWeek),
  ]);

  const hods: WeeklyHod[] = live.hods.map((h: HodWatch) => {
    const metrics: WeeklyMetric[] = h.metrics.map((m) => {
      const saved = store.get(rowKey(h.key, m.key));
      const prevRow = prevStore.get(rowKey(h.key, m.key));

      let actual: number | null;
      let source: WeeklyMetric["source"];
      let note: string | undefined;
      let override: WatchStatus | null = null;

      if (saved) {
        actual = saved.actual;
        source = saved.source;
        note = saved.note ?? undefined;
        override = saved.status;
      } else if (isCurrent) {
        actual = m.actual;
        // "live" hanya untuk metric yang benar-benar dihitung dari DB. Metric
        // manual yang belum diisi tetap dilabeli manual (bukan live-tapi-kosong).
        source = m.source === "db" ? "live" : "manual";
        note = m.note;
      } else {
        actual = null;
        source = "manual";
      }

      const target = saved?.target ?? m.target;
      const pct = attainment(target, actual, m.direction);
      // Metric milestone (target null) tak punya angka → status murni dari override.
      const status: WatchStatus = target === null ? (override ?? "NA") : (override ?? gate(pct));
      const prevActual = prevRow?.actual ?? null;

      return {
        key: m.key, label: m.label, target, actual, prevActual, unit: m.unit,
        direction: m.direction, source, pct, status,
        trend: trendOf(actual, prevActual, m.direction), note,
      };
    });
    return { key: h.key, name: h.name, role: h.role, status: worst(metrics), metrics };
  });

  return {
    isoYear, isoWeek,
    label: `W${isoWeek}`,
    periode: periodeLabel(from, to),
    from, to, isCurrent,
    saved: store.size > 0,
    asOf: new Date().toISOString(),
    hods,
    meta: { gate: GATE_TEXT, legend: LEGEND },
  };
}

/** Daftar minggu yang bisa dibuka: `back` minggu terakhir + semua minggu yang punya data. */
export async function listWeeks(back = 12): Promise<WeekRef[]> {
  const cur = currentWeek();
  const seen = new Map<string, { isoYear: number; isoWeek: number; saved: boolean }>();

  let cursor = cur;
  for (let i = 0; i < back; i++) {
    seen.set(`${cursor.isoYear}-${cursor.isoWeek}`, { ...cursor, saved: false });
    cursor = previousWeek(cursor.isoYear, cursor.isoWeek);
  }

  if (isDbEnabled()) {
    const sql = db();
    const rows = await sql<{ iso_year: number; iso_week: number }[]>`
      SELECT DISTINCT iso_year, iso_week FROM watchpoint_weekly
      ORDER BY iso_year DESC, iso_week DESC LIMIT 200`;
    for (const r of rows) {
      const k = `${r.iso_year}-${r.iso_week}`;
      seen.set(k, { isoYear: Number(r.iso_year), isoWeek: Number(r.iso_week), saved: true });
    }
  }

  return [...seen.values()]
    .sort((a, b) => b.isoYear - a.isoYear || b.isoWeek - a.isoWeek)
    .map((w) => {
      const { from, to } = weekRange(w.isoYear, w.isoWeek);
      return {
        isoYear: w.isoYear, isoWeek: w.isoWeek,
        label: `W${w.isoWeek}`, periode: periodeLabel(from, to), from, to,
        saved: w.saved,
        isCurrent: w.isoYear === cur.isoYear && w.isoWeek === cur.isoWeek,
      };
    });
}

/**
 * Metric mana yang boleh dibekukan saat MENGISI MUNDUR minggu lampau, dan dari
 * sumber apa ketersediaan datanya dinilai.
 *
 * 'invoice' | 'plan' | 'so' → metric CAPAIAN periode: bisa direkonstruksi kapan
 * saja selama sumbernya menjangkau minggu itu.
 *
 * 'titik-waktu' → TIDAK bisa direkonstruksi. ar90/noorder/churn menggambarkan
 * kondisi pada saat diukur (ar_aging_mv cuma menyimpan kondisi terkini, tak ada
 * riwayat harian); fia/xsell kumulatif YTD, bukan capaian minggu. Membekukannya
 * mundur berarti mencap nilai HARI INI ke kotak minggu lampau — garis datar yang
 * dikarang seluruhnya, dan karena snapshot bersifat permanen, kebohongan itu
 * tak akan pernah ketahuan lagi.
 */
const RECON_SOURCE: Record<string, "invoice" | "plan" | "so" | "titik-waktu"> = {
  revenue: "invoice",
  prod: "invoice",
  newacct: "invoice",
  visits: "plan",
  fillrate: "so",
  ar90: "titik-waktu",
  noorder: "titik-waktu",
  churn: "titik-waktu",
  fia: "titik-waktu",
  xsell: "titik-waktu",
};

/** Tanggal terlama yang dijangkau tiap sumber — dibaca dari DB, bukan dipatok. */
async function dataHorizon(sql: ReturnType<typeof db>): Promise<Record<string, string | null>> {
  const [r] = await sql<{ invoice: string | null; plan: string | null; so: string | null }[]>`
    SELECT (SELECT min(tanggal)::text FROM accurate_invoice) AS invoice,
           (SELECT min(tanggal)::text FROM sales_plan WHERE reported) AS plan,
           (SELECT min(trans_date)::text FROM accurate_sales_order) AS so`;
  return { invoice: r?.invoice ?? null, plan: r?.plan ?? null, so: r?.so ?? null };
}

/**
 * Bekukan nilai computed minggu (year, week) ke tabel.
 * Hanya metric bersumber DB yang di-snapshot — metric manual milik HoD, jangan
 * ditimpa nilai kosong. Idempoten (UPSERT), aman dijalankan ulang.
 *
 * mode 'live' (default) — perilaku lama, dipakai job Senin untuk membekukan minggu
 *   yang baru saja tutup. Metric titik-waktu ikut dibekukan, dan itu SAH karena
 *   diukur berdekatan dengan akhir minggunya.
 *
 * mode 'reconstruct' — untuk mengisi mundur minggu lampau. Hanya metric capaian
 *   periode yang dibekukan, itu pun cuma bila sumbernya menjangkau minggu tsb.
 *   Sisanya sengaja dibiarkan N/A: "belum ada data" jauh lebih berguna daripada
 *   angka karangan yang terlihat resmi.
 */
export async function snapshotWeek(
  isoYear: number,
  isoWeek: number,
  mode: "live" | "reconstruct" = "live",
): Promise<{ isoYear: number; isoWeek: number; saved: number; dilewati?: string[] }> {
  if (!isDbEnabled()) throw new Error("DATABASE_URL off");
  const sql = db();
  // Bekukan capaian MINGGU tsb. Sebelumnya memakai default (bulan berjalan),
  // sehingga snapshot yang dijalankan Senin pagi merekam month-to-date yang baru
  // berumur beberapa hari — W31 tercatat revenue 0 padahal nyatanya Rp 277 jt.
  const snapWin = weekRange(isoYear, isoWeek);
  const live = await getWatchBoard({ from: snapWin.from, to: snapWin.to });

  const rows: {
    hod_key: string; iso_year: number; iso_week: number; metric_key: string;
    target: number | null; actual: number | null; status: WatchStatus; note: string | null;
    source: "db";
  }[] = [];

  const horizon = mode === "reconstruct" ? await dataHorizon(sql) : null;
  const dilewati = new Set<string>();

  for (const h of live.hods) {
    for (const m of h.metrics) {
      if (m.source !== "db") continue; // metric manual → biarkan input HoD yang isi
      if (horizon) {
        const src = RECON_SOURCE[m.key];
        if (src === undefined || src === "titik-waktu") {
          dilewati.add(`${m.key} (tak bisa direkonstruksi)`);
          continue;
        }
        const sejak = horizon[src];
        // Sumber tak menjangkau awal minggu → hasilnya akan 0/parsial dan terbaca
        // sebagai capaian buruk, padahal artinya datanya memang belum ada.
        if (!sejak || sejak > snapWin.from) {
          dilewati.add(`${m.key} (data ${src} baru sejak ${sejak ?? "—"})`);
          continue;
        }
      }
      rows.push({
        hod_key: h.key, iso_year: isoYear, iso_week: isoWeek, metric_key: m.key,
        target: m.target, actual: m.actual, status: m.status, note: m.note ?? null,
        source: "db",
      });
    }
  }
  if (!rows.length) return { isoYear, isoWeek, saved: 0, dilewati: [...dilewati] };

  // source='db' WAJIB ikut di-INSERT (default kolom = 'manual'). Kalau tidak,
  // baris snapshot ikut terhitung manual → snapshot berikutnya tertolak oleh
  // WHERE di bawah dan angka minggu berjalan berhenti diperbarui.
  // WHERE source='db': baris yang sudah diisi HoD (manual) tak pernah tergilas.
  await sql`
    INSERT INTO watchpoint_weekly ${sql(rows, "hod_key", "iso_year", "iso_week", "metric_key", "target", "actual", "status", "note", "source")}
    ON CONFLICT (hod_key, iso_year, iso_week, metric_key) DO UPDATE
      SET target = EXCLUDED.target,
          actual = EXCLUDED.actual,
          status = EXCLUDED.status,
          note   = EXCLUDED.note,
          source = 'db',
          updated_at = now()
    WHERE watchpoint_weekly.source = 'db'`;

  return { isoYear, isoWeek, saved: rows.length, dilewati: [...dilewati] };
}

/** Snapshot minggu LALU — dipanggil scheduler Senin pagi saat minggu baru tutup. */
export async function snapshotLastWeek(): Promise<{ isoYear: number; isoWeek: number; saved: number }> {
  const cur = currentWeek();
  const prev = previousWeek(cur.isoYear, cur.isoWeek);
  return snapshotWeek(prev.isoYear, prev.isoWeek);
}

export interface UpsertMetricInput {
  hod_key: string;
  metric_key: string;
  iso_year: number;
  iso_week: number;
  target?: number | null;
  actual?: number | null;
  status?: WatchStatus | null;
  note?: string | null;
}

/** Simpan/ubah nilai manual satu metric untuk satu minggu (input HoD di UI Weekly). */
export async function upsertWeeklyMetric(input: UpsertMetricInput): Promise<{ ok: true }> {
  if (!isDbEnabled()) throw new Error("DATABASE_URL off");
  const sql = db();
  await sql`
    INSERT INTO watchpoint_weekly (hod_key, iso_year, iso_week, metric_key, target, actual, status, note, source)
    VALUES (${input.hod_key}, ${input.iso_year}, ${input.iso_week}, ${input.metric_key},
            ${input.target ?? null}, ${input.actual ?? null}, ${input.status ?? null},
            ${input.note ?? null}, 'manual')
    ON CONFLICT (hod_key, iso_year, iso_week, metric_key) DO UPDATE
      SET target = EXCLUDED.target,
          actual = EXCLUDED.actual,
          status = EXCLUDED.status,
          note   = EXCLUDED.note,
          source = 'manual',
          updated_at = now()`;
  return { ok: true };
}

/** Hapus input manual → metric balik ke nilai live/snapshot. */
export async function deleteWeeklyMetric(
  hodKey: string, isoYear: number, isoWeek: number, metricKey: string,
): Promise<{ deleted: boolean }> {
  if (!isDbEnabled()) throw new Error("DATABASE_URL off");
  const sql = db();
  const r = await sql`
    DELETE FROM watchpoint_weekly
    WHERE hod_key = ${hodKey} AND iso_year = ${isoYear}
      AND iso_week = ${isoWeek} AND metric_key = ${metricKey}`;
  return { deleted: r.count > 0 };
}

// ── Ringkasan teks (WA) ───────────────────────────────────────────
const WA_STATUS: Record<WatchStatus, string> = {
  GREEN: "🟢", YELLOW: "🟡", RED: "🔴", NA: "⚪",
};
const WA_TREND: Record<WatchTrend, string> = { improving: "↗︎", stable: "→", declining: "↘︎" };

export function fmtValue(v: number | null, unit: string): string {
  if (v === null) return "—";
  if (unit === "Rp") {
    return "Rp " + new Intl.NumberFormat("id-ID", { notation: "compact", maximumFractionDigits: 1 }).format(v);
  }
  if (unit === "%") return `${v % 1 === 0 ? v : v.toFixed(1)}%`;
  return `${new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 }).format(v)}${unit ? " " + unit : ""}`;
}

/** Ringkasan WatchPoint mingguan 1 HoD jadi teks WA. */
export function formatWeeklyHodWa(board: WeeklyBoard, hod: WeeklyHod): string {
  const lines: string[] = [
    `*WatchPoint ${board.label} — ${hod.name}*`,
    `${hod.role} · ${board.periode}`,
    "",
  ];
  for (const m of hod.metrics) {
    const val = m.target === null
      ? (m.status === "GREEN" ? "Live" : m.status === "YELLOW" ? "WIP" : m.status === "RED" ? "Off" : "—")
      : `${fmtValue(m.actual, m.unit)} / ${fmtValue(m.target, m.unit)}${m.pct !== null ? ` (${Math.round(m.pct)}%)` : ""}`;
    lines.push(`${WA_STATUS[m.status]} ${m.label}: ${val} ${WA_TREND[m.trend]}`);
    if (m.note) lines.push(`   _${m.note}_`);
  }
  lines.push("", `_WRG-OS · ${board.isCurrent ? "berjalan" : "final"} per ${new Date(board.asOf).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })} WIB_`);
  return lines.join("\n");
}
