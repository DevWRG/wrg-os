// F127 — evaluator alert: hitung metric tiap alert aktif, bandingkan ke ambang,
// kirim WA saat TRANSISI ke breach (edge-triggered, anti-spam via last_state).
// Dijadwalkan dari scheduler.ts (SALES_ALERT_EVAL_ENABLED) + trigger manual via
// POST /sales-analytics/alerts/evaluate.
//
// Metric: revenue, ar_gt_90, customer_count, new_customer_count, churn_count.
// Operator: gt/gte/lt/lte/eq (nilai absolut) · delta_pct_gt/lt (% vs window
// sebelumnya) · anomaly_std_gt (z-score vs baseline N-window). delta/anomaly
// hanya utk metric "windowed" (revenue/customer_count/new_customer_count).

import { db } from "../db.js";
import { joinAmFromSalesman } from "./salesman-am.js";
import { sendViaWaGateway } from "../wasend.js";

type Dim = { am_id?: string; cabang?: string };

function fmtRp(n: number): string {
  const v = n || 0;
  if (Math.abs(v) >= 1e9) return `Rp ${(v / 1e9).toFixed(2)} M`;
  if (Math.abs(v) >= 1e6) return `Rp ${(v / 1e6).toFixed(0)} jt`;
  return `Rp ${Math.round(v).toLocaleString("id-ID")}`;
}
const isRupiah = (m: string): boolean => m === "revenue" || m === "ar_gt_90";
const fmtMetric = (m: string, v: number): string => (isRupiah(m) ? fmtRp(v) : v.toLocaleString("id-ID"));

const SIMPLE_OPS: Record<string, string> = { gt: ">", gte: "≥", lt: "<", lte: "≤", eq: "=" };
const WINDOWED = new Set(["revenue", "customer_count", "new_customer_count"]); // aman utk delta/anomaly (window kontigu)
const ANOMALY_WINDOWS = 6;

function cmp(op: string, value: number, threshold: number): boolean {
  switch (op) {
    case "gt": return value > threshold;
    case "gte": return value >= threshold;
    case "lt": return value < threshold;
    case "lte": return value <= threshold;
    case "eq": return value === threshold;
    default: return false;
  }
}

// Klausa dimensi (join accurate_salesman→master_user tersedia di query).
function dimClauses(sql: ReturnType<typeof db>, dim: Dim) {
  const am = dim.am_id ? sql`AND mu.am_id = ${dim.am_id}` : sql``;
  const cab = dim.cabang ? sql`AND COALESCE(NULLIF(mu.cabang,''), NULLIF(acs.cabang_override,'')) = ${dim.cabang}` : sql``;
  return { am, cab };
}

// Nilai metric "windowed" pada window ke-`offset` (0 = terkini) selebar `win` hari.
// Range = (CURRENT_DATE - (offset+1)*win, CURRENT_DATE - offset*win]. Return null
// bila metric tak windowed.
async function metricWindow(sql: ReturnType<typeof db>, metric: string, dim: Dim, win: number, offset: number): Promise<number | null> {
  const { am, cab } = dimClauses(sql, dim);
  const lo = (offset + 1) * win;
  const hi = offset * win;
  const inRange = sql`ai.tanggal > CURRENT_DATE - make_interval(days => ${lo}) AND ai.tanggal <= CURRENT_DATE - make_interval(days => ${hi})`;

  if (metric === "revenue") {
    const [r] = await sql`
      SELECT COALESCE(sum(ai.total),0)::float8 AS v FROM accurate_invoice ai
      LEFT JOIN accurate_salesman acs ON acs.id = ai.salesman_id
      ${joinAmFromSalesman(sql)}
      WHERE ${inRange} ${am} ${cab}`;
    return Number(r?.v ?? 0);
  }
  if (metric === "customer_count") {
    const [r] = await sql`
      SELECT count(DISTINCT ai.customer_id)::float8 AS v FROM accurate_invoice ai
      LEFT JOIN accurate_salesman acs ON acs.id = ai.salesman_id
      ${joinAmFromSalesman(sql)}
      WHERE ${inRange} ${am} ${cab}`;
    return Number(r?.v ?? 0);
  }
  if (metric === "new_customer_count") {
    // customer yang invoice PERTAMA-nya (global, terfilter dim) jatuh di window ini.
    const [r] = await sql`
      SELECT count(*)::float8 AS v FROM (
        SELECT ai.customer_id, min(ai.tanggal) AS first_dt FROM accurate_invoice ai
        LEFT JOIN accurate_salesman acs ON acs.id = ai.salesman_id
        ${joinAmFromSalesman(sql)}
        WHERE ai.customer_id IS NOT NULL ${am} ${cab}
        GROUP BY ai.customer_id
      ) x WHERE x.first_dt > CURRENT_DATE - make_interval(days => ${lo}) AND x.first_dt <= CURRENT_DATE - make_interval(days => ${hi})`;
    return Number(r?.v ?? 0);
  }
  return null;
}

// Nilai metric terkini (window 0) — utk operator absolut. Termasuk ar_gt_90
// (snapshot) & churn_count (aktif window sebelumnya, absen window terkini).
async function metricValue(sql: ReturnType<typeof db>, metric: string, dim: Dim, win: number): Promise<number | null> {
  if (WINDOWED.has(metric)) return metricWindow(sql, metric, dim, win, 0);
  const { am, cab } = dimClauses(sql, dim);

  if (metric === "ar_gt_90") {
    const [r] = await sql`
      SELECT COALESCE(sum(ai.total),0)::float8 AS v FROM accurate_invoice ai
      LEFT JOIN accurate_salesman acs ON acs.id = ai.salesman_id
      ${joinAmFromSalesman(sql)}
      WHERE ai.status = 'OPEN' AND ai.tanggal < CURRENT_DATE - 90 ${am} ${cab}`;
    return Number(r?.v ?? 0);
  }
  if (metric === "churn_count") {
    // customer aktif di window sebelumnya [2w,w) tapi TIDAK di window terkini [w,now].
    const [r] = await sql`
      SELECT count(*)::float8 AS v FROM (
        SELECT ai.customer_id,
          count(*) FILTER (WHERE ai.tanggal > CURRENT_DATE - make_interval(days => ${win})) AS cur,
          count(*) FILTER (WHERE ai.tanggal > CURRENT_DATE - make_interval(days => ${2 * win}) AND ai.tanggal <= CURRENT_DATE - make_interval(days => ${win})) AS prev
        FROM accurate_invoice ai
        LEFT JOIN accurate_salesman acs ON acs.id = ai.salesman_id
        ${joinAmFromSalesman(sql)}
        WHERE ai.customer_id IS NOT NULL ${am} ${cab}
        GROUP BY ai.customer_id
      ) x WHERE x.prev > 0 AND x.cur = 0`;
    return Number(r?.v ?? 0);
  }
  return null;
}

// Evaluasi satu alert → { breach, valStr, thrStr } atau null bila tak bisa dihitung.
async function evalAlert(
  sql: ReturnType<typeof db>,
  a: { metric_key: string; dimension_filter: Dim; threshold_operator: string; threshold_value: number; window_days: number },
): Promise<{ breach: boolean; valStr: string; thrStr: string } | null> {
  const metric = a.metric_key;
  const op = a.threshold_operator;
  const dim = a.dimension_filter ?? {};
  const win = Math.max(1, Number(a.window_days) || 7);
  const threshold = Number(a.threshold_value);

  if (SIMPLE_OPS[op]) {
    const v = await metricValue(sql, metric, dim, win);
    if (v == null) return null;
    return { breach: cmp(op, v, threshold), valStr: fmtMetric(metric, v), thrStr: `${SIMPLE_OPS[op]} ${fmtMetric(metric, threshold)}` };
  }

  if (op === "delta_pct_gt" || op === "delta_pct_lt") {
    if (!WINDOWED.has(metric)) return null;
    const cur = await metricWindow(sql, metric, dim, win, 0);
    const prev = await metricWindow(sql, metric, dim, win, 1);
    if (cur == null || prev == null || prev <= 0) return null;
    const delta = Math.round(((cur - prev) / prev) * 1000) / 10;
    return { breach: op === "delta_pct_gt" ? delta > threshold : delta < threshold, valStr: `${delta}%`, thrStr: `${op === "delta_pct_gt" ? ">" : "<"} ${threshold}%` };
  }

  if (op === "anomaly_std_gt") {
    if (!WINDOWED.has(metric)) return null;
    const cur = await metricWindow(sql, metric, dim, win, 0);
    const base: number[] = [];
    for (let k = 1; k <= ANOMALY_WINDOWS; k++) {
      const x = await metricWindow(sql, metric, dim, win, k);
      if (x != null) base.push(x);
    }
    if (cur == null || base.length < 2) return null;
    const mean = base.reduce((s, x) => s + x, 0) / base.length;
    const sd = Math.sqrt(base.reduce((s, x) => s + (x - mean) ** 2, 0) / base.length);
    if (sd <= 0) return null;
    const z = Math.round(((cur - mean) / sd) * 10) / 10;
    return { breach: z > threshold, valStr: `z=${z}σ`, thrStr: `> ${threshold}σ` };
  }

  return null;
}

export interface AlertEvalResult { enabled: boolean; evaluated: number; breached: number; sent: number; skipped: number }

export async function evaluateSalesAlerts(): Promise<AlertEvalResult> {
  const sql = db();
  const alerts = await sql`
    SELECT sa.id::text, sa.alert_name, sa.metric_key, sa.dimension_filter, sa.threshold_operator,
           sa.threshold_value::float8 AS threshold_value, sa.window_days, sa.wa_target_jid, sa.last_state,
           au.wa_number AS owner_wa_number
    FROM sales_analytics_alert sa
    LEFT JOIN app_user au ON au.id = sa.owner_user_id
    WHERE sa.active`;
  let sent = 0, breachedN = 0, skipped = 0;

  for (const a of alerts) {
    const res = await evalAlert(sql, {
      metric_key: String(a.metric_key),
      dimension_filter: (a.dimension_filter ?? {}) as Dim,
      threshold_operator: String(a.threshold_operator),
      threshold_value: Number(a.threshold_value),
      window_days: Number(a.window_days),
    });
    if (!res) { skipped++; continue; }
    if (res.breach) breachedN++;

    const wasBreach = a.last_state === "breach";
    if (res.breach && !wasBreach) {
      // Fallback empty target → WA personal OWNER alert (BUKAN grup). Cegah test
      // alert nyasar broadcast ke grup Sales (insiden 8 Jul 2026: alert target
      // kosong → dulu fallback HOD_WA_TARGET=grup Sales ~21 org). Kalau owner gak
      // punya wa_number & wa_target_jid kosong → JANGAN kirim (warn), bukan ke grup.
      const target = (a.wa_target_jid && String(a.wa_target_jid)) || (a.owner_wa_number && String(a.owner_wa_number)) || "";
      const msg = `🚨 *Alert: ${a.alert_name}*\n${a.metric_key} = ${res.valStr} ${res.thrStr} (window ${a.window_days}h)`;
      if (target) { await sendViaWaGateway(target, msg); sent++; }
      else { console.warn(`[sales-alert-eval] alert ${a.id} "${a.alert_name}" breach tapi tanpa target (wa_target_jid & owner wa_number kosong) → tidak dikirim`); }
      await sql`UPDATE sales_analytics_alert SET last_state = 'breach', last_triggered_at = now() WHERE id = ${a.id}`;
    } else {
      await sql`UPDATE sales_analytics_alert SET last_state = ${res.breach ? "breach" : "ok"} WHERE id = ${a.id}`;
    }
  }
  return { enabled: true, evaluated: alerts.length, breached: breachedN, sent, skipped };
}
