import { db } from "../db.js";
import { sendViaWaGateway } from "../wasend.js";
import { upsertDigests } from "./monitor.js";

// Weekly Report — port wrg-crm/scripts/cron_weekly_report.sh (bagian KPI).
// Hitung KPI minggu kerja lalu (Sen–Jum) LANGSUNG dari DB wrg-os (tanpa dashboard
// API legacy), susun ringkasan + link dashboard, kirim ke grup HOD Squad.
// PDF legacy (Chrome headless) TIDAK diport — diganti link ke dashboard hosted.

const HOD_SQUAD_JID = "120363042143432430@g.us";

const wibNow = (): Date => new Date(Date.now() + 7 * 3600 * 1000);
const iso = (d: Date): string => d.toISOString().slice(0, 10);

// Periode minggu kerja lalu: Senin–Jumat sebelum minggu berjalan.
// Dipanggil Senin 07:00 → Senin lalu .. Jumat lalu. Generik untuk hari apa pun.
export function lastWorkWeek(now: Date = wibNow()): { from: string; to: string } {
  const day = now.getUTCDay(); // 0=Min..6=Sab
  const diffToMon = day === 0 ? -6 : 1 - day; // ke Senin minggu ini
  const thisMon = new Date(now);
  thisMon.setUTCDate(now.getUTCDate() + diffToMon);
  const lastMon = new Date(thisMon);
  lastMon.setUTCDate(thisMon.getUTCDate() - 7);
  const lastFri = new Date(lastMon);
  lastFri.setUTCDate(lastMon.getUTCDate() + 4);
  return { from: iso(lastMon), to: iso(lastFri) };
}

export interface WeeklyKpi {
  from: string; to: string; working_days: number;
  total_plan: number; tpv: number; tti: number;
  total_reported: number; pct: number; total_late: number;
  total_activity: number; unmatched: number; match_pct: number;
  users_with_report: number;
  top_cabang: { cabang: string; pct: number; reported: number; total: number }[];
}

export async function computeWeeklyKpi(from: string, to: string): Promise<WeeklyKpi> {
  const sql = db();
  const [k] = await sql`
    SELECT
      (5 - (SELECT count(*) FROM master_holiday WHERE tanggal BETWEEN ${from} AND ${to}
            AND extract(dow from tanggal) BETWEEN 1 AND 5))::int AS wd,
      (SELECT count(*) FROM sales_plan WHERE tanggal BETWEEN ${from} AND ${to})::int AS tpv,
      (SELECT COALESCE(sum(total_items),0) FROM sales_todo WHERE tanggal BETWEEN ${from} AND ${to})::int AS tti,
      (SELECT count(*) FROM sales_plan WHERE tanggal BETWEEN ${from} AND ${to} AND reported)::int AS pr,
      (SELECT COALESCE(sum(CASE WHEN reported THEN total_items ELSE 0 END),0) FROM sales_todo WHERE tanggal BETWEEN ${from} AND ${to})::int AS tr,
      (SELECT count(*) FROM sales_plan WHERE tanggal BETWEEN ${from} AND ${to} AND is_late_plan)::int AS pl,
      (SELECT count(*) FROM sales_todo WHERE tanggal BETWEEN ${from} AND ${to} AND is_late_plan)::int AS tl,
      (SELECT count(*) FROM activity_log WHERE tanggal BETWEEN ${from} AND ${to})::int AS ta,
      (SELECT count(*) FROM activity_log WHERE tanggal BETWEEN ${from} AND ${to} AND is_unmatched)::int AS un,
      (SELECT count(DISTINCT am_id)::int FROM (
         SELECT am_id FROM activity_log WHERE tanggal BETWEEN ${from} AND ${to}
         UNION SELECT am_id FROM sales_todo WHERE tanggal BETWEEN ${from} AND ${to} AND reported) u) AS ua
  `;
  const cab = await sql`
    SELECT mu.cabang AS cabang,
           count(sp.id)::int AS total,
           count(sp.id) FILTER (WHERE sp.reported)::int AS reported
    FROM sales_plan sp JOIN master_user mu ON mu.am_id = sp.am_id
    WHERE sp.tanggal BETWEEN ${from} AND ${to} AND mu.cabang IS NOT NULL AND mu.cabang <> ''
    GROUP BY mu.cabang
    HAVING count(sp.id) >= 5
    ORDER BY (count(sp.id) FILTER (WHERE sp.reported))::float / NULLIF(count(sp.id),0) DESC
    LIMIT 3
  `;
  const tpv = Number(k?.tpv ?? 0), tti = Number(k?.tti ?? 0);
  const pr = Number(k?.pr ?? 0), tr = Number(k?.tr ?? 0);
  const pl = Number(k?.pl ?? 0), tl = Number(k?.tl ?? 0);
  const ta = Number(k?.ta ?? 0), un = Number(k?.un ?? 0);
  const total_plan = tpv + tti;
  const total_reported = pr + tr;
  return {
    from, to, working_days: Number(k?.wd ?? 0),
    total_plan, tpv, tti,
    total_reported, pct: total_plan > 0 ? Math.round((total_reported * 100) / total_plan) : 0,
    total_late: pl + tl,
    total_activity: ta, unmatched: un, match_pct: ta > 0 ? Math.round(((ta - un) * 100) / ta) : 0,
    users_with_report: Number(k?.ua ?? 0),
    top_cabang: cab.map((r) => ({
      cabang: String(r.cabang), total: Number(r.total), reported: Number(r.reported),
      pct: Number(r.total) > 0 ? Math.floor((Number(r.reported) * 100) / Number(r.total)) : 0,
    })),
  };
}

function buildMessage(k: WeeklyKpi): string {
  const top = k.top_cabang.length
    ? k.top_cabang.map((c) => `  • ${c.cabang}: ${c.pct}% (${c.reported}/${c.total})`).join("\n")
    : "  (tidak ada cabang dgn data cukup)";
  const dash = process.env.WEB_PUBLIC_URL || process.env.NOTIF_TUA_DASHBOARD_URL || "";
  const link = dash ? `\n\n🔗 Dashboard: ${dash.replace(/\/$/, "")}/dashboard` : "";
  return `📊 *WRG CRM Weekly Report*
Periode: ${k.from} → ${k.to} (${k.working_days} hari kerja)

🎯 *Ringkasan KPI*
• Total Plan: ${k.total_plan} (${k.tpv} kunjungan + ${k.tti} todo)
• Reported: ${k.total_reported} (${k.pct}% selesai)
• Late submission: ${k.total_late}
• Aktivitas: ${k.total_activity} (${k.match_pct}% matched ke plan)
• Unmatched: ${k.unmatched}

🏆 *Top 3 Cabang*
${top}${link}`;
}

export interface WeeklyReportResult {
  sent: boolean; from: string; to: string; dryRun?: boolean; to_target?: string; payload?: string;
}

export async function runWeeklyReport(
  opts: { dryRun?: boolean; target?: string; from?: string; to?: string } = {},
): Promise<WeeklyReportResult> {
  const target = opts.target || process.env.WEEKLY_REPORT_TARGET || HOD_SQUAD_JID;
  const period = opts.from && opts.to ? { from: opts.from, to: opts.to } : lastWorkWeek();
  const kpi = await computeWeeklyKpi(period.from, period.to);
  const payload = buildMessage(kpi);

  // Arsip ke monitor_digest (kind='weekly', tanggal=periode-to jadi kunci minggu;
  // waktu kolom varchar(8) → pakai placeholder pendek, periode lengkap ada di content).
  await upsertDigests([{ kind: "weekly", tanggal: period.to, waktu: "00:00", content: payload, source_file: "generated" }]);

  if (opts.dryRun) return { sent: false, from: period.from, to: period.to, dryRun: true, to_target: target, payload };
  const g = await sendViaWaGateway(target, payload);
  return { sent: g.sent, from: period.from, to: period.to, to_target: target };
}
