import { db } from "../db.js";

// F40 Inventory Relocation Request (Purchasing/Supply Chain, role min HOD).
// Tabel flat (satu baris = satu request pindah SATU jenis barang), pola sama
// dgn supplier_eta F39 — bukan header+item krn tak butuh multi-baris barang
// per request. date/timestamptz eksplisit ::text di SELECT/RETURNING — pola
// sama dgn repo lain (postgres.js balikin objek Date tanpa cast eksplisit).
//
// Status (pending/completed/cancelled) DISIMPAN literal, bukan computed —
// beda dari "telat" F39/"stok rendah" F49 krn di sini tak ada basis stok
// riil utk dihitung (lihat migrasi 078). Tanpa approval formal 2-pihak: HOD
// yang sama mencatat & menyelesaikan/membatalkan requestnya sendiri (seluruh
// halaman sudah di-gate HOD di BFF).

export type InventoryRelocationStatus = "pending" | "completed" | "cancelled";

export interface InventoryRelocationRow {
  id: string;
  item_desc: string;
  qty: number;
  unit: string | null;
  cabang_asal: string;
  cabang_tujuan: string;
  reason: string | null;
  requested_by: string | null;
  request_date: string;
  status: InventoryRelocationStatus;
  completed_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

function rowCols(sql: ReturnType<typeof db>) {
  return sql`
    id, item_desc, qty, unit, cabang_asal, cabang_tujuan, reason, requested_by,
    request_date::text, status, completed_at::text, notes,
    created_at::text, updated_at::text
  `;
}

function mapRow(r: Record<string, unknown>): InventoryRelocationRow {
  return {
    id: String(r.id),
    item_desc: String(r.item_desc),
    qty: Number(r.qty),
    unit: r.unit != null ? String(r.unit) : null,
    cabang_asal: String(r.cabang_asal),
    cabang_tujuan: String(r.cabang_tujuan),
    reason: r.reason != null ? String(r.reason) : null,
    requested_by: r.requested_by != null ? String(r.requested_by) : null,
    request_date: String(r.request_date),
    status: r.status as InventoryRelocationStatus,
    completed_at: r.completed_at != null ? String(r.completed_at) : null,
    notes: r.notes != null ? String(r.notes) : null,
    created_at: String(r.created_at),
    updated_at: String(r.updated_at),
  };
}

export interface InventoryRelocationInput {
  item_desc: string;
  qty: number;
  unit?: string | null;
  cabang_asal: string;
  cabang_tujuan: string;
  reason?: string | null;
  requested_by?: string | null;
  request_date?: string | null;
  notes?: string | null;
}

export async function listInventoryRelocations(): Promise<InventoryRelocationRow[]> {
  const sql = db();
  const rows = await sql`
    SELECT ${rowCols(sql)}
    FROM inventory_relocation_request
    ORDER BY request_date DESC, created_at DESC
  `;
  return rows.map(mapRow);
}

export async function getInventoryRelocation(id: string): Promise<InventoryRelocationRow | null> {
  const sql = db();
  const rows = await sql`
    SELECT ${rowCols(sql)}
    FROM inventory_relocation_request
    WHERE id = ${id}
  `;
  return rows.length ? mapRow(rows[0]) : null;
}

export async function createInventoryRelocation(t: InventoryRelocationInput): Promise<InventoryRelocationRow> {
  const sql = db();
  const rows = await sql`
    INSERT INTO inventory_relocation_request (
      item_desc, qty, unit, cabang_asal, cabang_tujuan, reason, requested_by,
      request_date, notes
    ) VALUES (
      ${t.item_desc}, ${t.qty}, ${t.unit ?? null}, ${t.cabang_asal}, ${t.cabang_tujuan},
      ${t.reason ?? null}, ${t.requested_by ?? null},
      ${t.request_date ?? new Date().toISOString().slice(0, 10)}, ${t.notes ?? null}
    )
    RETURNING id
  `;
  const created = await getInventoryRelocation(String(rows[0].id));
  if (!created) throw new Error("gagal membaca request relokasi setelah dibuat");
  return created;
}

export interface InventoryRelocationUpdate {
  item_desc?: string;
  qty?: number;
  unit?: string | null;
  cabang_asal?: string;
  cabang_tujuan?: string;
  reason?: string | null;
  requested_by?: string | null;
  request_date?: string;
  status?: InventoryRelocationStatus;
  notes?: string | null;
}

export async function updateInventoryRelocation(id: string, f: InventoryRelocationUpdate): Promise<InventoryRelocationRow | null> {
  const sql = db();
  // completed_at ikut status: masuk 'completed' → stempel waktu (kalau belum
  // ada); keluar dari 'completed' → bersihkan lagi (biar tak nyangkut kalau
  // status dikembalikan ke pending/cancelled).
  const completedAtExpr =
    f.status === undefined
      ? sql`completed_at`
      : f.status === "completed"
        ? sql`COALESCE(completed_at, now())`
        : sql`NULL`;
  const rows = await sql`
    UPDATE inventory_relocation_request SET
      item_desc     = COALESCE(${f.item_desc ?? null}, item_desc),
      qty           = COALESCE(${f.qty ?? null}, qty),
      unit          = ${f.unit !== undefined ? f.unit : sql`unit`},
      cabang_asal   = COALESCE(${f.cabang_asal ?? null}, cabang_asal),
      cabang_tujuan = COALESCE(${f.cabang_tujuan ?? null}, cabang_tujuan),
      reason        = ${f.reason !== undefined ? f.reason : sql`reason`},
      requested_by  = ${f.requested_by !== undefined ? f.requested_by : sql`requested_by`},
      request_date  = COALESCE(${f.request_date ?? null}, request_date),
      status        = COALESCE(${f.status ?? null}, status),
      completed_at  = ${completedAtExpr},
      notes         = ${f.notes !== undefined ? f.notes : sql`notes`},
      updated_at    = now()
    WHERE id = ${id}
    RETURNING id
  `;
  return rows.length ? getInventoryRelocation(id) : null;
}

export async function deleteInventoryRelocation(id: string): Promise<{ deleted: number }> {
  const sql = db();
  const rows = await sql`DELETE FROM inventory_relocation_request WHERE id = ${id} RETURNING id`;
  return { deleted: rows.length };
}
