import { db } from "../db.js";

// D1 — daily TODO/plan per AM (port legacy sales_todo). Satu plan per AM per
// tanggal (upsert). items = array kegiatan harian; is_late_plan bila plan
// hari-ini disubmit lewat 08:00 (waktu lokal). reported = sudah ada #REPORT.

// Plan dianggap "late" bila untuk tanggal hari ini & jam submit (lokal) >= 8.
export function isLatePlan(tanggal: string, now = new Date()): boolean {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const todayLocal = `${y}-${m}-${d}`;
  return tanggal.slice(0, 10) === todayLocal && now.getHours() >= 8;
}

export interface TodoInput {
  am_id: string;
  am_name?: string;
  tanggal: string; // YYYY-MM-DD
  items: string[];
  raw_body?: string;
  is_late_plan?: boolean;
}

export async function upsertDailyTodo(
  t: TodoInput,
): Promise<{ id: string; total_items: number; is_late_plan: boolean }> {
  const sql = db();
  const late = t.is_late_plan ?? isLatePlan(t.tanggal);
  const items = Array.isArray(t.items) ? t.items : [];
  const rows = await sql`
    INSERT INTO sales_todo (am_id, am_name, tanggal, items, raw_body, is_late_plan)
    VALUES (${t.am_id}, ${t.am_name ?? null}, ${t.tanggal},
            ${sql.json(items as unknown as Parameters<typeof sql.json>[0])},
            ${t.raw_body ?? null}, ${late})
    ON CONFLICT (am_id, tanggal) DO UPDATE SET
      am_name      = EXCLUDED.am_name,
      items        = EXCLUDED.items,
      raw_body     = EXCLUDED.raw_body,
      is_late_plan = EXCLUDED.is_late_plan
    RETURNING id, total_items, is_late_plan
  `;
  return {
    id: rows[0].id as string,
    total_items: Number(rows[0].total_items),
    is_late_plan: Boolean(rows[0].is_late_plan),
  };
}

export interface TodoRow {
  id: string;
  am_id: string;
  am_name: string | null;
  tanggal: string;
  items: string[];
  total_items: number;
  is_late_plan: boolean;
  reported: boolean;
  reported_at: string | null;
  created_at: string;
}

export async function listTodos(amId?: string, date?: string, limit = 50): Promise<TodoRow[]> {
  const sql = db();
  const rows = await sql`
    SELECT id, am_id, am_name, tanggal::text, items, total_items, is_late_plan,
           reported, reported_at::text, created_at::text
    FROM sales_todo
    WHERE ${amId ? sql`am_id = ${amId}` : sql`true`}
      AND ${date ? sql`tanggal = ${date}` : sql`true`}
    ORDER BY tanggal DESC, created_at DESC
    LIMIT ${limit}
  `;
  return rows.map((r) => ({
    id: String(r.id),
    am_id: String(r.am_id),
    am_name: r.am_name ? String(r.am_name) : null,
    tanggal: String(r.tanggal),
    items: Array.isArray(r.items) ? (r.items as string[]) : [],
    total_items: Number(r.total_items),
    is_late_plan: Boolean(r.is_late_plan),
    reported: Boolean(r.reported),
    reported_at: r.reported_at ? String(r.reported_at) : null,
    created_at: String(r.created_at),
  }));
}

export async function markTodoReported(
  amId: string,
  tanggal: string,
): Promise<{ ok: boolean }> {
  const sql = db();
  const rows = await sql`
    UPDATE sales_todo SET reported = TRUE, reported_at = now()
    WHERE am_id = ${amId} AND tanggal = ${tanggal}
    RETURNING id
  `;
  return { ok: rows.length > 0 };
}
