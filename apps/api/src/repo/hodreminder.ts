import { createHash } from "node:crypto";

import { db } from "../db.js";
import { sendViaWaGateway, type WaSendResult } from "../wasend.js";

// D1 — HOD daily reminder (port legacy cron_hod_daily_reminder). Rekap kepatuhan
// plan/report harian: AM aktif (wajib_plan_report) yang BELUM plan / BELUM report
// hari ini, kecuali yang sedang cuti. Libur → tidak ada reminder. Kirim ke HOD/
// grup via WA gateway (stub bila target kosong) + log audit_log (Layer 4).

export async function runHodDaily(to?: string): Promise<{
  date: string;
  team: number;
  belum_plan: string[];
  belum_report: string[];
  message: string | null;
  gateway: WaSendResult | null;
  audit_id: string | null;
}> {
  const sql = db();
  const rows = await sql`
    SELECT coalesce(mu.panggilan, mu.nama) AS nm,
      EXISTS(SELECT 1 FROM sales_todo st WHERE st.am_id = mu.am_id AND st.tanggal = current_date) AS planned,
      EXISTS(SELECT 1 FROM sales_todo st WHERE st.am_id = mu.am_id AND st.tanggal = current_date AND st.reported) AS reported
    FROM master_user mu
    WHERE mu.role = 'AM' AND mu.aktif AND mu.wajib_plan_report
      AND NOT EXISTS (
        SELECT 1 FROM user_leave ul
        WHERE ul.am_id = mu.am_id AND current_date BETWEEN ul.start_date AND ul.end_date
      )
      AND NOT EXISTS (SELECT 1 FROM master_holiday h WHERE h.tanggal = current_date)
    ORDER BY nm
  `;
  const [{ d }] = await sql`SELECT current_date::text AS d`;
  const date = String(d);

  const belumPlan = rows.filter((r) => !r.planned).map((r) => String(r.nm));
  const belumReport = rows.filter((r) => r.planned && !r.reported).map((r) => String(r.nm));

  if (rows.length === 0) {
    // Hari libur atau tak ada AM wajib → tak ada reminder.
    return { date, team: 0, belum_plan: [], belum_report: [], message: null, gateway: null, audit_id: null };
  }

  const lines = [`📋 *Rekap kepatuhan HOD — ${date}*`, `Tim aktif: ${rows.length} AM`];
  lines.push("", `*Belum PLAN (${belumPlan.length}):* ${belumPlan.length ? belumPlan.join(", ") : "— semua sudah ✅"}`);
  lines.push(`*Belum REPORT (${belumReport.length}):* ${belumReport.length ? belumReport.join(", ") : "— semua sudah ✅"}`);
  const message = lines.join("\n");

  const target = to || process.env.HOD_WA_TARGET || process.env.REMINDER_WA_TARGET || "";
  const gateway = await sendViaWaGateway(target || "_hod_group", message);
  if (!gateway.sent) {
    return { date, team: rows.length, belum_plan: belumPlan, belum_report: belumReport, message, gateway, audit_id: null };
  }

  const inputHash = createHash("sha256").update(`${date}:${rows.length}`).digest("hex");
  const outputHash = createHash("sha256").update(message).digest("hex");
  const payload = { date, team: rows.length, belum_plan: belumPlan, belum_report: belumReport };
  const [a] = await sql`
    INSERT INTO audit_log
      (use_case_id, correlation_id, agent_id, layer, event_type, r_tier, input_hash, output_hash, payload)
    VALUES
      ('D1', ${`hod-${inputHash.slice(0, 8)}`}, NULL, 4, 'crm.reminder.hod', 'R1',
       ${inputHash}, ${outputHash}, ${sql.json(payload as unknown as Parameters<typeof sql.json>[0])})
    RETURNING id
  `;
  return { date, team: rows.length, belum_plan: belumPlan, belum_report: belumReport, message, gateway, audit_id: a.id as string };
}
