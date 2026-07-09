// F127 — CRUD saved views + threshold alert (tabel migrasi 049). Scoped per user
// (app_user.id). Dipakai endpoint /sales-analytics/views & /alerts.

import { db } from "../db.js";
import { loadGroupSubjects } from "./group-names.js";

const VIEW_TYPES = new Set(["executive", "per_am", "per_produk", "per_cabang", "per_customer", "trending", "custom"]);
const METRICS = new Set(["revenue", "gp", "unit_sold", "customer_count", "ar_balance", "ar_gt_90", "churn_count", "new_customer_count", "kso_count"]);
const OPS = new Set(["lt", "lte", "gt", "gte", "eq", "delta_pct_gt", "delta_pct_lt", "anomaly_std_gt"]);

type Json = Record<string, unknown>;

export interface SavedView {
  id: string; view_name: string; view_type: string; filter_config: Json;
  is_default: boolean; is_shared: boolean; updated_at: string;
}

export async function listViews(userId: string): Promise<SavedView[]> {
  const rows = await db()`
    SELECT id::text, view_name, view_type, filter_config, is_default, is_shared, updated_at::text
    FROM sales_analytics_view_config WHERE user_id = ${userId} ORDER BY view_name`;
  return rows.map((r) => ({
    id: String(r.id), view_name: String(r.view_name), view_type: String(r.view_type),
    filter_config: (r.filter_config ?? {}) as Json,
    is_default: r.is_default === true, is_shared: r.is_shared === true, updated_at: String(r.updated_at),
  }));
}

export async function saveView(
  userId: string,
  v: { view_name?: string; view_type?: string; filter_config?: Json; is_default?: boolean; is_shared?: boolean },
): Promise<{ ok: boolean; error?: string; id?: string }> {
  const name = String(v.view_name ?? "").trim();
  const type = String(v.view_type ?? "").trim();
  if (!name) return { ok: false, error: "view_name wajib" };
  if (!VIEW_TYPES.has(type)) return { ok: false, error: "view_type tidak valid" };
  const sql = db();
  const rows = await sql`
    INSERT INTO sales_analytics_view_config (user_id, view_name, view_type, filter_config, is_default, is_shared)
    VALUES (${userId}, ${name}, ${type}, ${sql.json((v.filter_config ?? {}) as Parameters<typeof sql.json>[0])}, ${!!v.is_default}, ${!!v.is_shared})
    ON CONFLICT (user_id, view_name) DO UPDATE SET
      view_type = EXCLUDED.view_type, filter_config = EXCLUDED.filter_config,
      is_default = EXCLUDED.is_default, is_shared = EXCLUDED.is_shared, updated_at = now()
    RETURNING id::text`;
  return { ok: true, id: String(rows[0].id) };
}

export async function deleteView(userId: string, id: string): Promise<boolean> {
  const rows = await db()`DELETE FROM sales_analytics_view_config WHERE id = ${id} AND user_id = ${userId} RETURNING id`;
  return rows.length > 0;
}

export interface SalesAlert {
  id: string; alert_name: string; metric_key: string; dimension_filter: Json;
  threshold_operator: string; threshold_value: number; window_days: number;
  wa_target_jid: string | null; active: boolean; last_state: string | null;
}

export async function listAlerts(userId: string): Promise<SalesAlert[]> {
  const rows = await db()`
    SELECT id::text, alert_name, metric_key, dimension_filter, threshold_operator,
           threshold_value::float8, window_days, wa_target_jid, active, last_state
    FROM sales_analytics_alert WHERE owner_user_id = ${userId} ORDER BY alert_name`;
  return rows.map((r) => ({
    id: String(r.id), alert_name: String(r.alert_name), metric_key: String(r.metric_key),
    dimension_filter: (r.dimension_filter ?? {}) as Json,
    threshold_operator: String(r.threshold_operator), threshold_value: Number(r.threshold_value),
    window_days: Number(r.window_days), wa_target_jid: r.wa_target_jid ? String(r.wa_target_jid) : null,
    active: r.active === true, last_state: r.last_state ? String(r.last_state) : null,
  }));
}

export async function createAlert(
  userId: string,
  a: { alert_name?: string; metric_key?: string; dimension_filter?: Json; threshold_operator?: string; threshold_value?: number; window_days?: number; wa_target_jid?: string | null },
): Promise<{ ok: boolean; error?: string; id?: string }> {
  const name = String(a.alert_name ?? "").trim();
  if (!name) return { ok: false, error: "alert_name wajib" };
  if (!METRICS.has(String(a.metric_key))) return { ok: false, error: "metric_key tidak valid" };
  if (!OPS.has(String(a.threshold_operator))) return { ok: false, error: "threshold_operator tidak valid" };
  if (!Number.isFinite(Number(a.threshold_value))) return { ok: false, error: "threshold_value tidak valid" };
  const sql = db();
  const rows = await sql`
    INSERT INTO sales_analytics_alert
      (alert_name, owner_user_id, metric_key, dimension_filter, threshold_operator, threshold_value, window_days, wa_target_jid)
    VALUES (${name}, ${userId}, ${String(a.metric_key)}, ${sql.json((a.dimension_filter ?? {}) as Parameters<typeof sql.json>[0])},
            ${String(a.threshold_operator)}, ${Number(a.threshold_value)}, ${Math.max(1, Number(a.window_days) || 7)}, ${a.wa_target_jid ?? null})
    RETURNING id::text`;
  return { ok: true, id: String(rows[0].id) };
}

export async function deleteAlert(userId: string, id: string): Promise<boolean> {
  const rows = await db()`DELETE FROM sales_analytics_alert WHERE id = ${id} AND owner_user_id = ${userId} RETURNING id`;
  return rows.length > 0;
}

// Toggle aktif/nonaktif (scoped ke owner).
export async function updateAlert(userId: string, id: string, patch: { active?: boolean }): Promise<boolean> {
  const rows = await db()`
    UPDATE sales_analytics_alert SET active = COALESCE(${patch.active ?? null}, active)
    WHERE id = ${id} AND owner_user_id = ${userId} RETURNING id`;
  return rows.length > 0;
}

// Kandidat tujuan notif alert: grup WA (dari wa_message) + user (master_user + wa_number).
export interface AlertTargets {
  groups: { jid: string; name: string }[];
  users: { am_id: string; nama: string; wa_number: string }[];
}
export async function listAlertTargets(): Promise<AlertTargets> {
  const sql = db();
  // Nama grup: sumber utama subject openclaw (sessions.json) — wa_message.group_name
  // selalu kosong. Fallback monitor_pola.group_name (bila bukan JID), lalu JID.
  const subjects = loadGroupSubjects();
  const g = await sql`
    SELECT j.jid, mp.group_name FROM (
      SELECT DISTINCT group_jid AS jid FROM wa_message WHERE group_jid LIKE '%@g.us'
      UNION SELECT group_jid FROM monitor_pola WHERE group_jid LIKE '%@g.us'
    ) j LEFT JOIN monitor_pola mp ON mp.group_jid = j.jid`;
  const groups = g
    .map((r) => {
      const jid = String(r.jid);
      const dbname = r.group_name && !String(r.group_name).endsWith("@g.us") ? String(r.group_name) : "";
      return { jid, name: subjects[jid] || dbname || jid };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "id"))
    .slice(0, 300);
  const u = await sql`
    SELECT am_id, nama, wa_number FROM master_user
    WHERE wa_number IS NOT NULL AND wa_number <> '' AND aktif IS NOT false
    ORDER BY nama LIMIT 500`;
  return {
    groups,
    users: u.map((r) => ({ am_id: String(r.am_id), nama: r.nama ? String(r.nama) : String(r.am_id), wa_number: String(r.wa_number) })),
  };
}
