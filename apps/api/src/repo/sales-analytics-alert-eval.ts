// F127 — evaluator alert: hitung metric tiap alert aktif atas window-nya,
// bandingkan ke ambang, dan kirim WA saat TRANSISI ke breach (edge-triggered,
// anti-spam via last_state). Dijadwalkan dari scheduler.ts (SALES_ALERT_EVAL_ENABLED)
// + bisa dipicu manual via POST /sales-analytics/alerts/evaluate.

import { db } from "../db.js";
import { sendViaWaGateway } from "../wasend.js";

type Dim = { am_id?: string; cabang?: string };

function fmtRp(n: number): string {
  const v = n || 0;
  if (Math.abs(v) >= 1e9) return `Rp ${(v / 1e9).toFixed(2)} M`;
  if (Math.abs(v) >= 1e6) return `Rp ${(v / 1e6).toFixed(0)} jt`;
  return `Rp ${Math.round(v).toLocaleString("id-ID")}`;
}

const OP_LABEL: Record<string, string> = { gt: ">", gte: "≥", lt: "<", lte: "≤", eq: "=" };
function breached(op: string, value: number, threshold: number): boolean {
  switch (op) {
    case "gt": return value > threshold;
    case "gte": return value >= threshold;
    case "lt": return value < threshold;
    case "lte": return value <= threshold;
    case "eq": return value === threshold;
    default: return false; // delta_pct_*/anomaly_std_gt belum didukung evaluator
  }
}

// Hitung nilai metric atas window. Return null bila metric tak didukung.
async function metricValue(sql: ReturnType<typeof db>, metric: string, dim: Dim, windowDays: number): Promise<number | null> {
  const amClause = dim.am_id ? sql`AND mu.am_id = ${dim.am_id}` : sql``;
  const cabangClause = dim.cabang
    ? sql`AND COALESCE(NULLIF(mu.cabang,''), NULLIF(acs.cabang_override,'')) = ${dim.cabang}`
    : sql``;
  const win = Math.max(1, windowDays || 7);

  if (metric === "revenue") {
    const [r] = await sql`
      SELECT COALESCE(sum(ai.total),0)::float8 AS v FROM accurate_invoice ai
      LEFT JOIN accurate_salesman acs ON acs.id = ai.salesman_id
      LEFT JOIN master_user mu ON mu.am_id = acs.master_user_id::text
      WHERE ai.tanggal >= CURRENT_DATE - make_interval(days => ${win}) ${amClause} ${cabangClause}`;
    return Number(r?.v ?? 0);
  }
  if (metric === "ar_gt_90") {
    // AR outstanding faktur OPEN yang lebih tua dari 90 hari (window diabaikan).
    const [r] = await sql`
      SELECT COALESCE(sum(ai.total),0)::float8 AS v FROM accurate_invoice ai
      LEFT JOIN accurate_salesman acs ON acs.id = ai.salesman_id
      LEFT JOIN master_user mu ON mu.am_id = acs.master_user_id::text
      WHERE ai.status = 'OPEN' AND ai.tanggal < CURRENT_DATE - 90 ${amClause} ${cabangClause}`;
    return Number(r?.v ?? 0);
  }
  if (metric === "customer_count") {
    const [r] = await sql`
      SELECT count(DISTINCT ai.customer_id)::float8 AS v FROM accurate_invoice ai
      LEFT JOIN accurate_salesman acs ON acs.id = ai.salesman_id
      LEFT JOIN master_user mu ON mu.am_id = acs.master_user_id::text
      WHERE ai.tanggal >= CURRENT_DATE - make_interval(days => ${win}) ${amClause} ${cabangClause}`;
    return Number(r?.v ?? 0);
  }
  if (metric === "new_customer_count") {
    const [r] = await sql`
      SELECT count(*)::float8 AS v FROM (
        SELECT ai.customer_id, min(ai.tanggal) AS first_dt FROM accurate_invoice ai
        LEFT JOIN accurate_salesman acs ON acs.id = ai.salesman_id
        LEFT JOIN master_user mu ON mu.am_id = acs.master_user_id::text
        WHERE ai.customer_id IS NOT NULL ${amClause} ${cabangClause}
        GROUP BY ai.customer_id
      ) x WHERE x.first_dt >= CURRENT_DATE - make_interval(days => ${win})`;
    return Number(r?.v ?? 0);
  }
  // churn_count & lainnya: belum didukung evaluator → skip.
  return null;
}

const isRupiah = (m: string): boolean => m === "revenue" || m === "ar_gt_90";

export interface AlertEvalResult { enabled: boolean; evaluated: number; breached: number; sent: number; skipped: number }

export async function evaluateSalesAlerts(): Promise<AlertEvalResult> {
  const sql = db();
  const alerts = await sql`
    SELECT id::text, alert_name, metric_key, dimension_filter, threshold_operator,
           threshold_value::float8 AS threshold_value, window_days, wa_target_jid, last_state
    FROM sales_analytics_alert WHERE active`;
  let sent = 0, breachedN = 0, skipped = 0;
  const fallbackTarget = process.env.HOD_WA_TARGET || process.env.NOTIF_TUA_TARGET || "";

  for (const a of alerts) {
    const metric = String(a.metric_key);
    const val = await metricValue(sql, metric, (a.dimension_filter ?? {}) as Dim, Number(a.window_days));
    if (val == null) { skipped++; continue; }
    const threshold = Number(a.threshold_value);
    const isBreach = breached(String(a.threshold_operator), val, threshold);
    if (isBreach) breachedN++;

    const wasBreach = a.last_state === "breach";
    if (isBreach && !wasBreach) {
      // transisi ok→breach → kirim WA sekali.
      const target = (a.wa_target_jid && String(a.wa_target_jid)) || fallbackTarget;
      const valStr = isRupiah(metric) ? fmtRp(val) : val.toLocaleString("id-ID");
      const thrStr = isRupiah(metric) ? fmtRp(threshold) : threshold.toLocaleString("id-ID");
      const msg = `🚨 *Alert: ${a.alert_name}*\n${metric} = ${valStr} ${OP_LABEL[String(a.threshold_operator)] ?? String(a.threshold_operator)} ${thrStr} (window ${a.window_days}h)`;
      if (target) {
        await sendViaWaGateway(target, msg);
        sent++;
      }
      await sql`UPDATE sales_analytics_alert SET last_state = 'breach', last_triggered_at = now() WHERE id = ${a.id}`;
    } else {
      await sql`UPDATE sales_analytics_alert SET last_state = ${isBreach ? "breach" : "ok"} WHERE id = ${a.id}`;
    }
  }
  return { enabled: true, evaluated: alerts.length, breached: breachedN, sent, skipped };
}
