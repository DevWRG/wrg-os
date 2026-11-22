import { db } from "../db.js";

// D1 — daily TODO/plan per AM (port legacy sales_todo). Satu plan per AM per
// tanggal (upsert). items = array kegiatan harian. reported = sudah ada #REPORT.

// Threshold telat per role (port legacy late_threshold_for_role): batch-1
// non-lapangan 08:30, selainnya (AM/Teknisi/HOD/dll) 08:00.
export function lateThresholdForRole(role?: string | null): number {
  switch ((role ?? "").trim()) {
    case "Admin":
    case "Finance":
    case "Accounting":
    case "Purchasing":
    case "Supply Chain":
    case "Logistik":
    case "GA":
    case "Operasional":
      return 830;
    default:
      return 800;
  }
}

// Late = plan untuk HARI INI (WIB) & jam KIRIM (WIB) > threshold role. Pakai
// waktu kirim pesan (submittedAt), bukan waktu proses — message telat-proses
// tetap dinilai dari kapan user kirim (port legacy compute_is_late).
export function computeIsLate(tanggal: string, role?: string | null, submittedAt?: string | Date | null): boolean {
  const d = submittedAt ? new Date(submittedAt) : new Date();
  if (Number.isNaN(d.getTime())) return false;
  const wib = new Date(d.getTime() + 7 * 3600 * 1000);
  const submitDate = wib.toISOString().slice(0, 10);
  const hhmm = Number(wib.toISOString().slice(11, 16).replace(":", ""));
  return tanggal.slice(0, 10) === submitDate && hhmm > lateThresholdForRole(role);
}

export interface TodoInput {
  am_id: string;
  am_name?: string;
  tanggal: string; // YYYY-MM-DD
  items: string[];
  raw_body?: string;
  role?: string | null; // untuk threshold telat
  submitted_at?: string | Date | null; // waktu kirim pesan (ts JSONL)
  is_late_plan?: boolean; // override eksplisit (jarang)
}

export async function upsertDailyTodo(
  t: TodoInput,
): Promise<{ id: string; total_items: number; is_late_plan: boolean }> {
  const sql = db();
  const submittedAt = t.submitted_at ? new Date(t.submitted_at) : new Date();
  const late = t.is_late_plan ?? computeIsLate(t.tanggal, t.role, submittedAt);
  const items = Array.isArray(t.items) ? t.items : [];
  // ON CONFLICT: PRESERVE is_late_plan + earliest submitted_at (re-submit tak
  // boleh balikkan ontime→late atau geser waktu submit awal — port legacy).
  const rows = await sql`
    INSERT INTO sales_todo (am_id, am_name, tanggal, items, raw_body, is_late_plan, submitted_at)
    VALUES (${t.am_id}, ${t.am_name ?? null}, ${t.tanggal},
            ${sql.json(items as unknown as Parameters<typeof sql.json>[0])},
            ${t.raw_body ?? null}, ${late}, ${submittedAt})
    ON CONFLICT (am_id, tanggal) DO UPDATE SET
      am_name      = EXCLUDED.am_name,
      items        = EXCLUDED.items,
      raw_body     = EXCLUDED.raw_body,
      is_late_plan = sales_todo.is_late_plan,
      submitted_at = LEAST(sales_todo.submitted_at, EXCLUDED.submitted_at)
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

export async function listTodos(amId?: string, date?: string, limit = 1000): Promise<TodoRow[]> {
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

// Menu Plan Operasional (/todos) — daftar per halaman. Dulu halaman memanggil
// listTodos() tanpa parameter: LIMIT 1000 memotong 4.300 plan (prod 22 Nov) jadi
// hanya yang sejak ±9 Okt, dan filter tanggal di klien kosong untuk rentang
// lama. Sekarang cari, rentang tanggal, urut, dan halaman dikerjakan di SQL.
export const TODO_SORTS = ["tanggal", "am", "total"] as const;
export type TodoSort = (typeof TODO_SORTS)[number];
export const isTodoSort = (v: unknown): v is TodoSort => TODO_SORTS.includes(String(v) as TodoSort);

export async function listTodosPaged(o: {
  q?: string;
  from?: string;
  to?: string;
  sort?: TodoSort;
  dir?: "asc" | "desc";
  limit?: number;
  offset?: number;
} = {}): Promise<{ rows: TodoRow[]; total: number; limit: number; offset: number }> {
  const sql = db();
  const limit = Math.min(Math.max(Math.trunc(Number(o.limit) || 25), 1), 500);
  const offset = Math.max(Math.trunc(Number(o.offset) || 0), 0);
  const q = (o.q ?? "").trim();
  const like = `%${q}%`;
  const tglOk = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);
  const from = tglOk(o.from);
  const to = tglOk(o.to);
  const where = sql`WHERE true
    ${q ? sql`AND (am_name ILIKE ${like} OR am_id ILIKE ${like} OR items::text ILIKE ${like})` : sql``}
    ${from ? sql`AND tanggal >= ${from}::date` : sql``}
    ${to ? sql`AND tanggal <= ${to}::date` : sql``}`;
  const key = o.sort ?? "tanggal";
  const col = key === "am" ? sql`COALESCE(am_name, am_id)` : key === "total" ? sql`total_items` : sql`tanggal`;
  const order = o.dir === "asc"
    ? sql`ORDER BY ${col} ASC NULLS LAST, created_at ASC, id ASC`
    : sql`ORDER BY ${col} DESC NULLS LAST, created_at DESC, id DESC`;
  const [rows, [count]] = await Promise.all([
    sql`
      SELECT id, am_id, am_name, tanggal::text, items, total_items, is_late_plan,
             reported, reported_at::text, created_at::text
      FROM sales_todo ${where} ${order}
      LIMIT ${limit} OFFSET ${offset}`,
    sql`SELECT count(*)::int AS total FROM sales_todo ${where}`,
  ]);
  return {
    rows: rows.map((r) => ({
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
    })),
    total: Number(count?.total ?? 0),
    limit,
    offset,
  };
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
