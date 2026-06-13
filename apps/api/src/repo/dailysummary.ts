import { aiDryRun, callAi } from "../ai.js";
import { db } from "../db.js";
import { sendViaWaGateway } from "../wasend.js";
import { upsertDigests } from "./monitor.js";

// Daily Summary — port wrg-crm/scripts/wrg-daily.sh JOB daily_summary.
// Kumpulkan aktivitas hari ini (activity_log AM-mode + sales_todo.report_data
// TODO-mode yg sudah reported) → stats + list NO_PLAN/NON_REPORTERS/ON_LEAVE →
// services/ai POST /daily-summary (LLM ringkas) → kirim ke grup HOD Squad.
// Skema wrg-os pakai am_id + tabel user_leave (selaras compliance.ts).

// Default target = HOD Squad (hardcode legacy: grup khusus semua HOD, single
// source — supaya summary tak nyebar ke grup divisi). Override via env.
const HOD_SQUAD_JID = "120363042143432430@g.us";

const wibNow = (): Date => new Date(Date.now() + 7 * 3600 * 1000);
const HARI_ID = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
const BULAN_ID = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];
function hariTanggal(): { hari: string; tanggal: string } {
  const d = wibNow();
  return { hari: HARI_ID[d.getUTCDay()], tanggal: `${d.getUTCDate()} ${BULAN_ID[d.getUTCMonth()]} ${d.getUTCFullYear()}` };
}

export interface DailySummaryResult {
  sent: boolean;
  skipped?: "no-activity";
  error?: string;
  dryRun?: boolean;
  to?: string;
  model?: string;
  rows?: number;
  payload?: string;
}

export async function runDailySummary(
  opts: { dryRun?: boolean; target?: string } = {},
): Promise<DailySummaryResult> {
  const sql = db();
  const target = opts.target || process.env.DAILY_SUMMARY_TARGET || HOD_SQUAD_JID;

  // Aktivitas hari ini — UNION AM-mode (activity_log) + TODO-mode (report_data).
  const rows = await sql`
    SELECT mu.nama AS nama, mu.cabang AS area, COALESCE(al.customer_name, '') AS customer,
           COALESCE(al.hasil, '') AS hasil, COALESCE(al.next_action, '') AS next_action,
           COALESCE(sp.tujuan, al.tujuan, '') AS tujuan, COALESCE(al.is_unmatched, false) AS is_unmatched
    FROM activity_log al
    JOIN master_user mu ON mu.am_id = al.am_id
    LEFT JOIN sales_plan sp ON sp.id = al.plan_id
    WHERE al.tanggal = CURRENT_DATE
    UNION ALL
    SELECT mu.nama, mu.cabang, '' AS customer,
           COALESCE(item->>'task', '') AS hasil, COALESCE(item->>'result', '') AS next_action,
           '' AS tujuan, (COALESCE(item->>'status', 'matched') = 'unmatched') AS is_unmatched
    FROM sales_todo st
    JOIN master_user mu ON mu.am_id = st.am_id
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(st.report_data, '[]'::jsonb)) AS item
    WHERE st.tanggal = CURRENT_DATE AND st.reported = TRUE
    ORDER BY nama
  `;

  const [stats] = await sql`
    WITH am AS (SELECT am_id, is_unmatched FROM activity_log WHERE tanggal = CURRENT_DATE),
    todo_items AS (
      SELECT st.am_id, COALESCE(item->>'status', 'matched') AS status
      FROM sales_todo st CROSS JOIN LATERAL jsonb_array_elements(COALESCE(st.report_data, '[]'::jsonb)) AS item
      WHERE st.tanggal = CURRENT_DATE AND st.reported = TRUE
    )
    SELECT
      (SELECT count(DISTINCT am_id)::int FROM (SELECT am_id FROM am UNION SELECT am_id FROM todo_items) u) AS anggota_aktif,
      ((SELECT count(*) FROM am) + (SELECT count(*) FROM todo_items))::int AS total_report,
      ((SELECT count(*) FROM am WHERE is_unmatched = false) + (SELECT count(*) FROM todo_items WHERE status <> 'unmatched'))::int AS matched,
      ((SELECT count(*) FROM am WHERE is_unmatched = true) + (SELECT count(*) FROM todo_items WHERE status = 'unmatched'))::int AS unmatched,
      (SELECT count(DISTINCT am_id)::int FROM (
         SELECT am_id FROM sales_plan WHERE tanggal = CURRENT_DATE
         UNION SELECT am_id FROM sales_todo WHERE tanggal = CURRENT_DATE) p) AS anggota_plan
  `;

  if (rows.length === 0 && Number(stats?.anggota_plan ?? 0) === 0) {
    return { sent: false, skipped: "no-activity" };
  }

  const [wajib] = await sql`
    SELECT count(*)::int AS n FROM master_user mu
    WHERE mu.aktif AND COALESCE(mu.wajib_plan_report, true)
      AND NOT EXISTS (SELECT 1 FROM user_leave ul WHERE ul.am_id = mu.am_id AND CURRENT_DATE BETWEEN ul.start_date AND ul.end_date)
  `;

  const noPlan = await sql`
    SELECT COALESCE(mu.nama, mu.panggilan, mu.wa_number) AS nm FROM master_user mu
    WHERE mu.aktif AND COALESCE(mu.wajib_plan_report, true)
      AND NOT EXISTS (SELECT 1 FROM user_leave ul WHERE ul.am_id = mu.am_id AND CURRENT_DATE BETWEEN ul.start_date AND ul.end_date)
      AND NOT EXISTS (SELECT 1 FROM sales_plan WHERE am_id = mu.am_id AND tanggal = CURRENT_DATE)
      AND NOT EXISTS (SELECT 1 FROM sales_todo WHERE am_id = mu.am_id AND tanggal = CURRENT_DATE)
    ORDER BY mu.nama
  `;
  const nonReporters = await sql`
    SELECT COALESCE(mu.nama, mu.panggilan, mu.wa_number) AS nm FROM master_user mu
    WHERE mu.aktif AND COALESCE(mu.wajib_plan_report, true)
      AND NOT EXISTS (SELECT 1 FROM user_leave ul WHERE ul.am_id = mu.am_id AND CURRENT_DATE BETWEEN ul.start_date AND ul.end_date)
      AND (EXISTS (SELECT 1 FROM sales_plan WHERE am_id = mu.am_id AND tanggal = CURRENT_DATE)
           OR EXISTS (SELECT 1 FROM sales_todo WHERE am_id = mu.am_id AND tanggal = CURRENT_DATE))
      AND NOT EXISTS (SELECT 1 FROM activity_log WHERE am_id = mu.am_id AND tanggal = CURRENT_DATE)
      AND NOT EXISTS (SELECT 1 FROM sales_todo WHERE am_id = mu.am_id AND tanggal = CURRENT_DATE AND reported)
    ORDER BY mu.nama
  `;
  const onLeave = await sql`
    SELECT COALESCE(mu.nama, mu.panggilan, mu.wa_number) || ' (' || COALESCE(ul.jenis, 'ijin') || ')' AS nm
    FROM user_leave ul JOIN master_user mu ON mu.am_id = ul.am_id
    WHERE mu.aktif AND COALESCE(mu.wajib_plan_report, true) AND CURRENT_DATE BETWEEN ul.start_date AND ul.end_date
    ORDER BY mu.nama
  `;

  const { hari, tanggal } = hariTanggal();
  const { status, data } = await callAi("/daily-summary", {
    hari,
    tanggal,
    stats: {
      anggota_aktif: Number(stats?.anggota_aktif ?? 0),
      total_report: Number(stats?.total_report ?? 0),
      matched: Number(stats?.matched ?? 0),
      unmatched: Number(stats?.unmatched ?? 0),
      anggota_plan: Number(stats?.anggota_plan ?? 0),
      wajib_total: Number(wajib?.n ?? 0),
    },
    rows: rows.map((r) => ({
      nama: String(r.nama ?? ""),
      area: r.area ? String(r.area) : null,
      customer: String(r.customer ?? ""),
      hasil: String(r.hasil ?? ""),
      next_action: String(r.next_action ?? ""),
      tujuan: r.tujuan ? String(r.tujuan) : null,
      is_unmatched: Boolean(r.is_unmatched),
    })),
    no_plan: noPlan.map((r) => String(r.nm)).filter(Boolean),
    non_reporters: nonReporters.map((r) => String(r.nm)).filter(Boolean),
    on_leave: onLeave.map((r) => String(r.nm)).filter(Boolean),
    dry_run: aiDryRun(),
  });

  if (status !== 200) return { sent: false, error: `services/ai ${status}`, rows: rows.length };
  let summary = String(data.summary ?? "");
  if (summary.length < 50) return { sent: false, error: "AI returned empty/short", rows: rows.length };

  // Layer-2 anti-halusinasi (port pelajaran legacy ai-placeholder-hallucination):
  // prompt-only "jangan ngarang tanggal" gagal ~10% → paksa baris header tanggal
  // pakai nilai bash-known. Header format: "📊 *Daily Summary — {hari}, {tanggal}*".
  summary = summary.replace(/^.*Daily Summary\b.*$/m, `📊 *Daily Summary — ${hari}, ${tanggal}*`);

  // Simpan untuk arsip/inspeksi (monitor_digest kind='daily').
  const dateStr = wibNow().toISOString().slice(0, 10);
  const jam = wibNow().toISOString().slice(11, 16);
  await upsertDigests([{ kind: "daily", tanggal: dateStr, waktu: jam, content: summary, source_file: "generated" }]);

  if (opts.dryRun) {
    return { sent: false, dryRun: true, to: target, model: String(data.model ?? ""), rows: rows.length, payload: summary };
  }
  const g = await sendViaWaGateway(target, summary);
  return { sent: g.sent, to: target, model: String(data.model ?? ""), dryRun: Boolean(data.dry_run), rows: rows.length };
}
