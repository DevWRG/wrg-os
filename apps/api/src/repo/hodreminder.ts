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
  // Plan/report AM ada di sales_plan (sales_todo = jalur non-AM). Cek KEDUANYA
  // (selaras compliance.ts) — dulu cuma cek sales_todo → semua AM keliatan "Belum
  // PLAN". planned = ada plan/todo; reported = semua sudah di-report.
  const rows = await sql`
    WITH base AS (
      SELECT coalesce(mu.panggilan, mu.nama) AS nm,
        (SELECT count(*) FROM sales_plan sp WHERE sp.am_id = mu.am_id AND sp.tanggal = current_date)::int AS sp_total,
        (SELECT count(*) FROM sales_plan sp WHERE sp.am_id = mu.am_id AND sp.tanggal = current_date AND sp.reported = false)::int AS sp_unrep,
        (SELECT count(*) FROM sales_todo st WHERE st.am_id = mu.am_id AND st.tanggal = current_date)::int AS st_total,
        (SELECT count(*) FROM sales_todo st WHERE st.am_id = mu.am_id AND st.tanggal = current_date AND NOT st.reported)::int AS st_unrep
      FROM master_user mu
      WHERE mu.role = 'AM' AND mu.aktif AND mu.wajib_plan_report
        AND NOT EXISTS (
          SELECT 1 FROM user_leave ul
          WHERE ul.am_id = mu.am_id AND current_date BETWEEN ul.start_date AND ul.end_date
        )
        AND NOT EXISTS (SELECT 1 FROM master_holiday h WHERE h.tanggal = current_date)
    )
    SELECT nm,
      (sp_total + st_total) > 0 AS planned,
      ((sp_total + st_total) > 0 AND (sp_unrep + st_unrep) = 0) AS reported
    FROM base ORDER BY nm
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

// F57 — Eskalasi kepatuhan: AM yg MISS (belum plan / plan belum di-report penuh)
// di N hari-kerja terakhir BERTURUT (default 2, SEBELUM hari ini), bukan cuti →
// rekap ke grup HoD. Hari libur/weekend otomatis tak dihitung. Kirim WA (patuh
// WA_DRY_RUN) + audit_log D1. Pesan hanya dikirim bila ada yg ke-eskalasi.
export async function runMissStreakEscalation(days = 2, to?: string): Promise<{
  streak_days: number;
  workdays: string[];
  escalated: string[];
  message: string | null;
  gateway: WaSendResult | null;
  audit_id: string | null;
}> {
  const sql = db();
  const n = Math.min(Math.max(Math.trunc(days) || 2, 2), 10);
  const wdRows = await sql`
    SELECT d::date::text AS t
    FROM generate_series(current_date - 40, current_date - 1, interval '1 day') d
    WHERE EXTRACT(DOW FROM d) NOT IN (0, 6)
      AND NOT EXISTS (SELECT 1 FROM master_holiday h WHERE h.tanggal = d::date)
    ORDER BY d DESC LIMIT ${n}
  `;
  const workdays = wdRows.map((r) => String(r.t)).reverse();
  if (workdays.length < n) {
    return { streak_days: n, workdays, escalated: [], message: null, gateway: null, audit_id: null };
  }
  const rows = await sql`
    WITH wdays AS (
      SELECT d::date AS tanggal
      FROM generate_series(current_date - 40, current_date - 1, interval '1 day') d
      WHERE EXTRACT(DOW FROM d) NOT IN (0, 6)
        AND NOT EXISTS (SELECT 1 FROM master_holiday h WHERE h.tanggal = d::date)
      ORDER BY d DESC LIMIT ${n}
    ),
    am AS (
      SELECT am_id, COALESCE(initcap(panggilan), nama) AS nm FROM master_user
      WHERE role = 'AM' AND aktif AND wajib_plan_report
    ),
    grid AS (
      SELECT a.am_id, a.nm,
        EXISTS (SELECT 1 FROM user_leave ul WHERE ul.am_id = a.am_id AND w.tanggal BETWEEN ul.start_date AND ul.end_date) AS on_leave,
        (
          ((SELECT count(*) FROM sales_plan sp WHERE sp.am_id = a.am_id AND sp.tanggal = w.tanggal)
           + (SELECT count(*) FROM sales_todo st WHERE st.am_id = a.am_id AND st.tanggal = w.tanggal)) = 0
          OR ((SELECT count(*) FROM sales_plan sp WHERE sp.am_id = a.am_id AND sp.tanggal = w.tanggal AND sp.reported = false)
              + (SELECT count(*) FROM sales_todo st WHERE st.am_id = a.am_id AND st.tanggal = w.tanggal AND NOT st.reported)) > 0
        ) AS missed
      FROM am a CROSS JOIN wdays w
    )
    SELECT nm FROM grid
    GROUP BY am_id, nm
    HAVING count(*) FILTER (WHERE NOT on_leave) = ${n}
       AND count(*) FILTER (WHERE missed AND NOT on_leave) = ${n}
    ORDER BY nm
  `;
  const escalated = rows.map((r) => String(r.nm));
  if (escalated.length === 0) {
    return { streak_days: n, workdays, escalated: [], message: null, gateway: null, audit_id: null };
  }
  const message = [
    `🚨 *Eskalasi Kepatuhan — miss ${n} hari kerja berturut*`,
    `Hari kerja: ${workdays.join(", ")}`,
    "",
    `AM belum plan/report ${n} hari berturut (${escalated.length}):`,
    ...escalated.map((nm) => `  • ${nm}`),
    "",
    "Mohon ditindaklanjuti para HoD 🙏",
  ].join("\n");
  const target = to || process.env.MISS_ESCALATION_WA_TARGET || process.env.HOD_WA_TARGET || process.env.REMINDER_WA_TARGET || "";
  const gateway = await sendViaWaGateway(target || "_hod_group", message);
  if (!gateway.sent) {
    return { streak_days: n, workdays, escalated, message, gateway, audit_id: null };
  }
  const inputHash = createHash("sha256").update(`miss:${workdays.join(",")}:${escalated.join(",")}`).digest("hex");
  const outputHash = createHash("sha256").update(message).digest("hex");
  const payload = { streak_days: n, workdays, escalated };
  const [a] = await sql`
    INSERT INTO audit_log
      (use_case_id, correlation_id, agent_id, layer, event_type, r_tier, input_hash, output_hash, payload)
    VALUES
      ('D1', ${`miss-${inputHash.slice(0, 8)}`}, NULL, 4, 'crm.reminder.hod.miss_streak', 'R1',
       ${inputHash}, ${outputHash}, ${sql.json(payload as unknown as Parameters<typeof sql.json>[0])})
    RETURNING id
  `;
  return { streak_days: n, workdays, escalated, message, gateway, audit_id: a.id as string };
}
