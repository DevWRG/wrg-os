import { db } from "../db.js";

// F39 — Supplier ETA Tracker. "Telat" dihitung, bukan disimpan: overdue =
// status masih 'pending' tapi eta_date sudah lewat hari ini (lihat 131_supplier_eta.sql).

export type SupplierEtaStatus = "pending" | "arrived" | "cancelled";

export interface SupplierEtaRow {
  id: string;
  vendor_id: string | null;
  vendor_name: string;
  po_number: string | null;
  item_desc: string;
  qty: number | null;
  eta_date: string;
  status: SupplierEtaStatus;
  actual_arrival_date: string | null;
  cabang: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  overdue: boolean;
}

function mapRow(r: Record<string, unknown>): SupplierEtaRow {
  return {
    id: String(r.id),
    vendor_id: r.vendor_id != null ? String(r.vendor_id) : null,
    vendor_name: String(r.vendor_name),
    po_number: r.po_number != null ? String(r.po_number) : null,
    item_desc: String(r.item_desc),
    qty: r.qty != null ? Number(r.qty) : null,
    eta_date: String(r.eta_date),
    status: r.status as SupplierEtaStatus,
    actual_arrival_date: r.actual_arrival_date != null ? String(r.actual_arrival_date) : null,
    cabang: r.cabang != null ? String(r.cabang) : null,
    notes: r.notes != null ? String(r.notes) : null,
    created_by: r.created_by != null ? String(r.created_by) : null,
    created_at: String(r.created_at),
    updated_at: String(r.updated_at),
    overdue: Boolean(r.overdue),
  };
}

export interface SupplierEtaInput {
  vendor_id?: string | null;
  vendor_name: string;
  po_number?: string | null;
  item_desc: string;
  qty?: number | null;
  eta_date: string;
  cabang?: string | null;
  notes?: string | null;
  created_by?: string | null;
}

// date/timestamptz eksplisit ::text — tanpa ini postgres.js balikin objek Date,
// yang ke-serialize jadi "Mon Jul 20 2026 …" (toString()), bukan ISO (lihat todo.ts/leave.ts).
function etaCols(sql: ReturnType<typeof db>) {
  return sql`
    id, vendor_id, vendor_name, po_number, item_desc, qty, eta_date::text,
    status, actual_arrival_date::text, cabang, notes, created_by,
    created_at::text, updated_at::text,
    (status = 'pending' AND eta_date < CURRENT_DATE) AS overdue
  `;
}

export async function createSupplierEta(t: SupplierEtaInput): Promise<SupplierEtaRow> {
  const sql = db();
  const rows = await sql`
    INSERT INTO supplier_eta (vendor_id, vendor_name, po_number, item_desc, qty, eta_date, cabang, notes, created_by)
    VALUES (${t.vendor_id ?? null}, ${t.vendor_name}, ${t.po_number ?? null}, ${t.item_desc},
            ${t.qty ?? null}, ${t.eta_date}, ${t.cabang ?? null}, ${t.notes ?? null}, ${t.created_by ?? null})
    RETURNING ${etaCols(sql)}
  `;
  return mapRow(rows[0]);
}

export async function listSupplierEta(opts?: {
  status?: SupplierEtaStatus;
  vendorId?: string;
  overdueOnly?: boolean;
  limit?: number;
}): Promise<SupplierEtaRow[]> {
  const sql = db();
  const limit = opts?.limit ?? 1000;
  const rows = await sql`
    SELECT ${etaCols(sql)}
    FROM supplier_eta
    WHERE ${opts?.status ? sql`status = ${opts.status}` : sql`true`}
      AND ${opts?.vendorId ? sql`vendor_id = ${opts.vendorId}` : sql`true`}
      AND ${opts?.overdueOnly ? sql`(status = 'pending' AND eta_date < CURRENT_DATE)` : sql`true`}
    ORDER BY eta_date ASC, created_at DESC
    LIMIT ${limit}
  `;
  return rows.map(mapRow);
}

export interface SupplierEtaUpdate {
  vendor_id?: string | null;
  vendor_name?: string;
  po_number?: string | null;
  item_desc?: string;
  qty?: number | null;
  eta_date?: string;
  status?: SupplierEtaStatus;
  actual_arrival_date?: string | null;
  cabang?: string | null;
  notes?: string | null;
}

export async function updateSupplierEta(id: string, f: SupplierEtaUpdate): Promise<SupplierEtaRow | null> {
  const sql = db();
  // Tandai 'arrived' tanpa actual_arrival_date eksplisit → pakai hari ini.
  const actualArrival =
    f.actual_arrival_date !== undefined ? f.actual_arrival_date : f.status === "arrived" ? new Date().toISOString().slice(0, 10) : undefined;
  const rows = await sql`
    UPDATE supplier_eta SET
      vendor_id           = COALESCE(${f.vendor_id ?? null}, vendor_id),
      vendor_name         = COALESCE(${f.vendor_name ?? null}, vendor_name),
      po_number           = ${f.po_number !== undefined ? f.po_number : sql`po_number`},
      item_desc           = COALESCE(${f.item_desc ?? null}, item_desc),
      qty                 = ${f.qty !== undefined ? f.qty : sql`qty`},
      eta_date            = COALESCE(${f.eta_date ?? null}, eta_date),
      status              = COALESCE(${f.status ?? null}, status),
      actual_arrival_date = ${actualArrival !== undefined ? actualArrival : sql`actual_arrival_date`},
      cabang              = ${f.cabang !== undefined ? f.cabang : sql`cabang`},
      notes               = ${f.notes !== undefined ? f.notes : sql`notes`},
      updated_at          = now()
    WHERE id = ${id}
    RETURNING ${etaCols(sql)}
  `;
  return rows.length ? mapRow(rows[0]) : null;
}

export async function deleteSupplierEta(id: string): Promise<{ deleted: number }> {
  const sql = db();
  const rows = await sql`DELETE FROM supplier_eta WHERE id = ${id} RETURNING id`;
  return { deleted: rows.length };
}
