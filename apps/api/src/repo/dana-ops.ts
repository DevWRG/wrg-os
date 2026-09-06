import { db } from "../db.js";

// F51 — Dana Ops / Petty Cash Realization. Header (dana_ops) = satu pengajuan
// dana operasional (uang muka); item realisasi (dana_ops_item) = bukti
// pengeluaran yang direkonsiliasi terhadap dana yang diajukan (lihat
// 128_dana_ops.sql). Total realisasi & selisih dihitung di query/JS, bukan
// kolom tersimpan — tidak ada seed default (beda dari F36; nota masuk bertahap).

export type DanaOpsStatus = "in_progress" | "realized";

export interface DanaOpsItemRow {
  id: string;
  dana_ops_id: string;
  description: string;
  amount: number;
  receipt_date: string;
  notes: string | null;
}

function mapItem(r: Record<string, unknown>): DanaOpsItemRow {
  return {
    id: String(r.id),
    dana_ops_id: String(r.dana_ops_id),
    description: String(r.description),
    amount: Number(r.amount),
    receipt_date: String(r.receipt_date),
    notes: r.notes != null ? String(r.notes) : null,
  };
}

export interface DanaOpsRow {
  id: string;
  cabang: string | null;
  requested_by: string;
  purpose: string;
  amount_requested: number;
  request_date: string;
  status: DanaOpsStatus;
  notes: string | null;
  realized_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  amount_realized: number;
  item_count: number;
  variance: number;
}

function mapRow(r: Record<string, unknown>): DanaOpsRow {
  const amount_requested = Number(r.amount_requested);
  const amount_realized = Number(r.amount_realized ?? 0);
  return {
    id: String(r.id),
    cabang: r.cabang != null ? String(r.cabang) : null,
    requested_by: String(r.requested_by),
    purpose: String(r.purpose),
    amount_requested,
    request_date: String(r.request_date),
    status: r.status as DanaOpsStatus,
    notes: r.notes != null ? String(r.notes) : null,
    realized_at: r.realized_at != null ? String(r.realized_at) : null,
    created_by: r.created_by != null ? String(r.created_by) : null,
    created_at: String(r.created_at),
    updated_at: String(r.updated_at),
    amount_realized,
    item_count: Number(r.item_count ?? 0),
    variance: amount_requested - amount_realized,
  };
}

// date/timestamptz eksplisit ::text — tanpa ini postgres.js balikin objek Date
// yang ke-serialize jadi "Mon Jul 20 2026 …" (toString()), bukan ISO (lihat
// gotcha yang sama di supplier-eta.ts/inbound-receiving.ts).
function danaOpsCols(sql: ReturnType<typeof db>) {
  return sql`
    d.id, d.cabang, d.requested_by, d.purpose, d.amount_requested, d.request_date::text,
    d.status, d.notes, d.realized_at::text, d.created_by, d.created_at::text, d.updated_at::text,
    COALESCE(it.amount_realized, 0) AS amount_realized,
    COALESCE(it.item_count, 0) AS item_count
  `;
}

function itemCols(sql: ReturnType<typeof db>) {
  return sql`id, dana_ops_id, description, amount, receipt_date::text, notes`;
}

export interface DanaOpsInput {
  cabang?: string | null;
  requested_by: string;
  purpose: string;
  amount_requested: number;
  request_date?: string;
  notes?: string | null;
  created_by?: string | null;
}

export interface DanaOpsDetail extends DanaOpsRow {
  items: DanaOpsItemRow[];
}

export async function createDanaOps(t: DanaOpsInput): Promise<DanaOpsRow> {
  const sql = db();
  const rows = await sql`
    INSERT INTO dana_ops (cabang, requested_by, purpose, amount_requested, request_date, notes, created_by)
    VALUES (${t.cabang ?? null}, ${t.requested_by}, ${t.purpose}, ${t.amount_requested},
            ${t.request_date ?? sql`CURRENT_DATE`}, ${t.notes ?? null}, ${t.created_by ?? null})
    RETURNING id, cabang, requested_by, purpose, amount_requested, request_date::text,
      status, notes, realized_at::text, created_by, created_at::text, updated_at::text
  `;
  return mapRow({ ...rows[0], amount_realized: 0, item_count: 0 });
}

export async function listDanaOps(opts?: {
  status?: DanaOpsStatus;
  cabang?: string;
  limit?: number;
}): Promise<DanaOpsRow[]> {
  const sql = db();
  const limit = opts?.limit ?? 1000;
  const rows = await sql`
    SELECT ${danaOpsCols(sql)}
    FROM dana_ops d
    LEFT JOIN (
      SELECT dana_ops_id, SUM(amount) AS amount_realized, COUNT(*) AS item_count
      FROM dana_ops_item GROUP BY dana_ops_id
    ) it ON it.dana_ops_id = d.id
    WHERE ${opts?.status ? sql`d.status = ${opts.status}` : sql`true`}
      AND ${opts?.cabang ? sql`d.cabang = ${opts.cabang}` : sql`true`}
    ORDER BY d.request_date DESC, d.created_at DESC
    LIMIT ${limit}
  `;
  return rows.map(mapRow);
}

export async function getDanaOps(id: string): Promise<DanaOpsDetail | null> {
  const sql = db();
  const rows = await sql`
    SELECT ${danaOpsCols(sql)}
    FROM dana_ops d
    LEFT JOIN (
      SELECT dana_ops_id, SUM(amount) AS amount_realized, COUNT(*) AS item_count
      FROM dana_ops_item GROUP BY dana_ops_id
    ) it ON it.dana_ops_id = d.id
    WHERE d.id = ${id}
  `;
  if (!rows.length) return null;
  const items = await sql`SELECT ${itemCols(sql)} FROM dana_ops_item WHERE dana_ops_id = ${id} ORDER BY receipt_date ASC, created_at ASC`;
  return { ...mapRow(rows[0]), items: items.map(mapItem) };
}

export interface DanaOpsUpdate {
  cabang?: string | null;
  requested_by?: string;
  purpose?: string;
  amount_requested?: number;
  request_date?: string;
  status?: DanaOpsStatus;
  notes?: string | null;
}

export async function updateDanaOps(id: string, f: DanaOpsUpdate): Promise<DanaOpsRow | null> {
  const sql = db();
  const realizedAt = f.status === "realized" ? new Date().toISOString() : f.status === "in_progress" ? null : undefined;
  const rows = await sql`
    UPDATE dana_ops SET
      cabang           = ${f.cabang !== undefined ? f.cabang : sql`cabang`},
      requested_by     = COALESCE(${f.requested_by ?? null}, requested_by),
      purpose          = COALESCE(${f.purpose ?? null}, purpose),
      amount_requested = COALESCE(${f.amount_requested ?? null}, amount_requested),
      request_date     = COALESCE(${f.request_date ?? null}, request_date),
      status           = COALESCE(${f.status ?? null}, status),
      notes            = ${f.notes !== undefined ? f.notes : sql`notes`},
      realized_at      = ${realizedAt !== undefined ? realizedAt : sql`realized_at`},
      updated_at       = now()
    WHERE id = ${id}
    RETURNING id, cabang, requested_by, purpose, amount_requested, request_date::text,
      status, notes, realized_at::text, created_by, created_at::text, updated_at::text
  `;
  if (!rows.length) return null;
  const [agg] = await sql`
    SELECT SUM(amount) AS amount_realized, COUNT(*) AS item_count
    FROM dana_ops_item WHERE dana_ops_id = ${id}
  `;
  return mapRow({ ...rows[0], ...agg });
}

export async function deleteDanaOps(id: string): Promise<{ deleted: number }> {
  const sql = db();
  const rows = await sql`DELETE FROM dana_ops WHERE id = ${id} RETURNING id`;
  return { deleted: rows.length };
}

export interface DanaOpsItemInput {
  description: string;
  amount: number;
  receipt_date?: string;
  notes?: string | null;
}

export async function addDanaOpsItem(danaOpsId: string, t: DanaOpsItemInput): Promise<DanaOpsItemRow | null> {
  const sql = db();
  const head = await sql`SELECT id FROM dana_ops WHERE id = ${danaOpsId}`;
  if (!head.length) return null;
  const rows = await sql`
    INSERT INTO dana_ops_item (dana_ops_id, description, amount, receipt_date, notes)
    VALUES (${danaOpsId}, ${t.description}, ${t.amount}, ${t.receipt_date ?? sql`CURRENT_DATE`}, ${t.notes ?? null})
    RETURNING ${itemCols(sql)}
  `;
  return mapItem(rows[0]);
}

export interface DanaOpsItemUpdate {
  description?: string;
  amount?: number;
  receipt_date?: string;
  notes?: string | null;
}

export async function updateDanaOpsItem(
  danaOpsId: string,
  itemId: string,
  f: DanaOpsItemUpdate,
): Promise<DanaOpsItemRow | null> {
  const sql = db();
  const rows = await sql`
    UPDATE dana_ops_item SET
      description  = COALESCE(${f.description ?? null}, description),
      amount       = COALESCE(${f.amount ?? null}, amount),
      receipt_date = COALESCE(${f.receipt_date ?? null}, receipt_date),
      notes        = ${f.notes !== undefined ? f.notes : sql`notes`},
      updated_at   = now()
    WHERE id = ${itemId} AND dana_ops_id = ${danaOpsId}
    RETURNING ${itemCols(sql)}
  `;
  return rows.length ? mapItem(rows[0]) : null;
}

export async function deleteDanaOpsItem(danaOpsId: string, itemId: string): Promise<{ deleted: number }> {
  const sql = db();
  const rows = await sql`DELETE FROM dana_ops_item WHERE id = ${itemId} AND dana_ops_id = ${danaOpsId} RETURNING id`;
  return { deleted: rows.length };
}
