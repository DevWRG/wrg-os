import { db } from "../db.js";
import { sendViaWaGateway } from "../wasend.js";

// Compliance reminder per-grup (port legacy wrg-daily.sh plan_check/report_check):
// ingatkan user wajib_plan_report yang belum submit #PLAN / #REPORT hari ini,
// dikirim ke last_active_group masing-masing. Skip user on-leave (user_leave).
// Balasan via gateway WA (patuh WA_DRY_RUN). Throttle 0.3s anti rate-limit.

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Role AM dikoordinir di satu grup sales (The ALLIANCE) — reminder/warning AM
// SELALU ke situ, TAK ikut last_active_group (yg bisa drift / salah karena
// backfill manual). Non-AM (admin/gudang/ops) tetap ke grup aktif masing-masing.
// Override via env COMPLIANCE_AM_GROUP, fallback REMINDER_WA_TARGET.
const AM_REMINDER_GROUP = process.env.COMPLIANCE_AM_GROUP || process.env.REMINDER_WA_TARGET || "";
function targetGroup(role: unknown, lastActiveGroup: unknown): string {
  if (String(role ?? "").toUpperCase() === "AM" && AM_REMINDER_GROUP) return AM_REMINDER_GROUP;
  return lastActiveGroup ? String(lastActiveGroup) : "";
}

// #PLAN belum submit → "⚠️ Pengingat #PLAN" ke grup. (panggil hanya hari kerja.)
export async function runPlanCheck(): Promise<{ warned: number; skippedNoGroup: number; total: number }> {
  const sql = db();
  const rows = await sql`
    SELECT mu.am_id, COALESCE(initcap(mu.panggilan), mu.nama, '') AS nama, mu.last_active_group AS grp, mu.role AS role
    FROM master_user mu
    WHERE mu.aktif AND COALESCE(mu.wajib_plan_report, true)
      AND NOT EXISTS (SELECT 1 FROM user_leave ul WHERE ul.am_id = mu.am_id AND CURRENT_DATE BETWEEN ul.start_date AND ul.end_date)
      AND NOT EXISTS (SELECT 1 FROM sales_plan sp WHERE sp.am_id = mu.am_id AND sp.tanggal = CURRENT_DATE)
      AND NOT EXISTS (SELECT 1 FROM sales_todo st WHERE st.am_id = mu.am_id AND st.tanggal = CURRENT_DATE)
    ORDER BY mu.nama
  `;
  let warned = 0, skippedNoGroup = 0;
  for (const r of rows) {
    const grp = targetGroup(r.role, r.grp);
    if (!grp) { skippedNoGroup += 1; continue; }
    const body = `⚠️ *Pengingat #PLAN*\n${String(r.nama)} belum submit plan hari ini.\nSilakan kirim #PLAN sebelum mulai aktivitas.`;
    const g = await sendViaWaGateway(grp, body);
    if (g.sent) warned += 1;
    await sleep(300);
  }
  return { warned, skippedNoGroup, total: rows.length };
}

// #REPORT belum lengkap → "⚠️ Pengingat #REPORT" ke grup. isWorkday=false → hanya
// warn yang sudah submit plan/todo (weekend opt-in), tanpa "no-plan" warning.
export async function runReportCheck(isWorkday: boolean): Promise<{ partial: number; noplan: number; skipped: number }> {
  const sql = db();
  const rows = await sql`
    WITH ts AS (
      SELECT mu.am_id, COALESCE(initcap(mu.panggilan), mu.nama, '') AS nama, mu.last_active_group AS grp, mu.role AS role,
        (SELECT count(*)::int FROM sales_plan sp WHERE sp.am_id = mu.am_id AND sp.tanggal = CURRENT_DATE) AS sp_total,
        (SELECT count(*)::int FROM sales_plan sp WHERE sp.am_id = mu.am_id AND sp.tanggal = CURRENT_DATE AND sp.reported = false) AS sp_unrep,
        (SELECT count(*)::int FROM sales_todo st WHERE st.am_id = mu.am_id AND st.tanggal = CURRENT_DATE) AS st_total,
        (SELECT CASE WHEN count(*) > 0 AND count(*) FILTER (WHERE reported) = 0 THEN 1 ELSE 0 END FROM sales_todo st WHERE st.am_id = mu.am_id AND st.tanggal = CURRENT_DATE) AS st_unrep,
        (SELECT count(*)::int FROM activity_log al WHERE al.am_id = mu.am_id AND al.tanggal = CURRENT_DATE) AS al_total,
        (SELECT array_agg(customer_name ORDER BY seq) FROM sales_plan sp WHERE sp.am_id = mu.am_id AND sp.tanggal = CURRENT_DATE AND sp.reported = false) AS unrep_cust
      FROM master_user mu
      WHERE mu.aktif AND COALESCE(mu.wajib_plan_report, true)
        AND NOT EXISTS (SELECT 1 FROM user_leave ul WHERE ul.am_id = mu.am_id AND CURRENT_DATE BETWEEN ul.start_date AND ul.end_date)
    )
    SELECT * FROM ts
    WHERE ((sp_total + st_total) > 0 AND (sp_unrep + st_unrep) > 0)
       OR (${isWorkday} AND (sp_total + st_total) = 0 AND al_total = 0)
    ORDER BY nama
  `;
  let partial = 0, noplan = 0, skipped = 0;
  for (const r of rows) {
    const grp = targetGroup(r.role, r.grp);
    if (!grp) { skipped += 1; continue; }
    const totalPlan = Number(r.sp_total) + Number(r.st_total);
    let body: string;
    if (totalPlan === 0) {
      body = `⚠️ ${String(r.nama)} tidak ada plan maupun report hari ini.`;
      const g = await sendViaWaGateway(grp, body);
      if (g.sent) noplan += 1;
    } else {
      const unrep = Number(r.sp_unrep) + Number(r.st_unrep);
      const custs = Array.isArray(r.unrep_cust) ? (r.unrep_cust as string[]) : [];
      if (custs.length > 0) {
        body = `⚠️ *Pengingat #REPORT, ${String(r.nama)}*\nMasih ada ${unrep} customer belum direport:\n${custs.map((c) => `  • ${c}`).join("\n")}\nKirim #REPORT sebelum selesai hari ini ya.`;
      } else {
        body = `⚠️ *Pengingat #REPORT, ${String(r.nama)}*\nPlan kamu hari ini belum di-report.\nKirim #REPORT sebelum 20:30 ya.`;
      }
      const g = await sendViaWaGateway(grp, body);
      if (g.sent) partial += 1;
    }
    await sleep(300);
  }
  return { partial, noplan, skipped };
}
