import { db } from "../db.js";

// F36 — Inbound Receiving Checklist. Header (inbound_receiving) = satu
// kejadian penerimaan barang; item checklist (inbound_receiving_item) = poin
// verifikasi yang dicentang satu per satu (lihat 129_inbound_receiving.sql).

export type InboundReceivingStatus = "in_progress" | "completed";

export class InboundReceivingError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "InboundReceivingError";
  }
}

// Checklist default di-seed dari sini (bukan kolom config di DB) — sengaja
// hardcode, lebih simpel drpd bikin tabel master checklist utk 4 poin standar.
const DEFAULT_CHECKLIST_LABELS = [
  "Jumlah barang sesuai PO / Surat Jalan",
  "Kondisi fisik barang baik (tidak rusak/basah/penyok)",
  "Dokumen lengkap (Surat Jalan, Faktur/Invoice)",
  "Spesifikasi/jenis barang sesuai pesanan",
];

export interface InboundReceivingItemRow {
  id: string;
  receiving_id: string;
  label: string;
  is_checked: boolean;
  notes: string | null;
  sort_order: number;
}

function mapItem(r: Record<string, unknown>): InboundReceivingItemRow {
  return {
    id: String(r.id),
    receiving_id: String(r.receiving_id),
    label: String(r.label),
    is_checked: Boolean(r.is_checked),
    notes: r.notes != null ? String(r.notes) : null,
    sort_order: Number(r.sort_order),
  };
}

export interface InboundReceivingRow {
  id: string;
  vendor_id: string | null;
  vendor_name: string;
  po_number: string | null;
  received_date: string;
  cabang: string | null;
  received_by: string | null;
  status: InboundReceivingStatus;
  overall_notes: string | null;
  completed_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  checked_count: number;
  item_count: number;
}

function mapRow(r: Record<string, unknown>): InboundReceivingRow {
  return {
    id: String(r.id),
    vendor_id: r.vendor_id != null ? String(r.vendor_id) : null,
    vendor_name: String(r.vendor_name),
    po_number: r.po_number != null ? String(r.po_number) : null,
    received_date: String(r.received_date),
    cabang: r.cabang != null ? String(r.cabang) : null,
    received_by: r.received_by != null ? String(r.received_by) : null,
    status: r.status as InboundReceivingStatus,
    overall_notes: r.overall_notes != null ? String(r.overall_notes) : null,
    completed_at: r.completed_at != null ? String(r.completed_at) : null,
    created_by: r.created_by != null ? String(r.created_by) : null,
    created_at: String(r.created_at),
    updated_at: String(r.updated_at),
    checked_count: Number(r.checked_count ?? 0),
    item_count: Number(r.item_count ?? 0),
  };
}

// date/timestamptz eksplisit ::text — tanpa ini postgres.js balikin objek
// Date yang ke-serialize jadi "Mon Jul 20 2026 …" (toString()), bukan ISO
// (lihat gotcha yang sama di supplier-eta.ts/todo.ts/leave.ts).
function receivingCols(sql: ReturnType<typeof db>) {
  return sql`
    ir.id, ir.vendor_id, ir.vendor_name, ir.po_number, ir.received_date::text,
    ir.cabang, ir.received_by, ir.status, ir.overall_notes,
    ir.completed_at::text, ir.created_by, ir.created_at::text, ir.updated_at::text,
    COALESCE(it.checked_count, 0) AS checked_count,
    COALESCE(it.item_count, 0) AS item_count
  `;
}

function itemCols(sql: ReturnType<typeof db>) {
  return sql`id, receiving_id, label, is_checked, notes, sort_order`;
}

export interface InboundReceivingInput {
  vendor_id?: string | null;
  vendor_name: string;
  po_number?: string | null;
  received_date?: string;
  cabang?: string | null;
  received_by?: string | null;
  overall_notes?: string | null;
  created_by?: string | null;
}

export interface InboundReceivingDetail extends InboundReceivingRow {
  items: InboundReceivingItemRow[];
}

export async function createInboundReceiving(t: InboundReceivingInput): Promise<InboundReceivingDetail> {
  const sql = db();
  const detail = await sql.begin(async (tx) => {
    const rows = await tx`
      INSERT INTO inbound_receiving (vendor_id, vendor_name, po_number, received_date, cabang, received_by, overall_notes, created_by)
      VALUES (${t.vendor_id ?? null}, ${t.vendor_name}, ${t.po_number ?? null},
              ${t.received_date ?? tx`CURRENT_DATE`}, ${t.cabang ?? null}, ${t.received_by ?? null},
              ${t.overall_notes ?? null}, ${t.created_by ?? null})
      RETURNING id, vendor_id, vendor_name, po_number, received_date::text, cabang,
        received_by, status, overall_notes, completed_at::text, created_by,
        created_at::text, updated_at::text
    `;
    const header = rows[0];
    const items = await tx`
      INSERT INTO inbound_receiving_item (receiving_id, label, sort_order)
      SELECT ${header.id}, label, ord - 1
      FROM unnest(${DEFAULT_CHECKLIST_LABELS}::text[]) WITH ORDINALITY AS t(label, ord)
      RETURNING id, receiving_id, label, is_checked, notes, sort_order
    `;
    return { ...mapRow({ ...header, checked_count: 0, item_count: items.length }), items: items.map(mapItem) };
  });
  return detail;
}

export async function listInboundReceiving(opts?: {
  status?: InboundReceivingStatus;
  vendorId?: string;
  cabang?: string;
  limit?: number;
}): Promise<InboundReceivingRow[]> {
  const sql = db();
  const limit = opts?.limit ?? 1000;
  const rows = await sql`
    SELECT ${receivingCols(sql)}
    FROM inbound_receiving ir
    LEFT JOIN (
      SELECT receiving_id, COUNT(*) FILTER (WHERE is_checked) AS checked_count, COUNT(*) AS item_count
      FROM inbound_receiving_item GROUP BY receiving_id
    ) it ON it.receiving_id = ir.id
    WHERE ${opts?.status ? sql`ir.status = ${opts.status}` : sql`true`}
      AND ${opts?.vendorId ? sql`ir.vendor_id = ${opts.vendorId}` : sql`true`}
      AND ${opts?.cabang ? sql`ir.cabang = ${opts.cabang}` : sql`true`}
    ORDER BY ir.received_date DESC, ir.created_at DESC
    LIMIT ${limit}
  `;
  return rows.map(mapRow);
}

export async function getInboundReceiving(id: string): Promise<InboundReceivingDetail | null> {
  const sql = db();
  const rows = await sql`
    SELECT ${receivingCols(sql)}
    FROM inbound_receiving ir
    LEFT JOIN (
      SELECT receiving_id, COUNT(*) FILTER (WHERE is_checked) AS checked_count, COUNT(*) AS item_count
      FROM inbound_receiving_item GROUP BY receiving_id
    ) it ON it.receiving_id = ir.id
    WHERE ir.id = ${id}
  `;
  if (!rows.length) return null;
  const items = await sql`SELECT ${itemCols(sql)} FROM inbound_receiving_item WHERE receiving_id = ${id} ORDER BY sort_order ASC, created_at ASC`;
  return { ...mapRow(rows[0]), items: items.map(mapItem) };
}

export interface InboundReceivingUpdate {
  vendor_id?: string | null;
  vendor_name?: string;
  po_number?: string | null;
  received_date?: string;
  cabang?: string | null;
  received_by?: string | null;
  status?: InboundReceivingStatus;
  overall_notes?: string | null;
}

export async function updateInboundReceiving(id: string, f: InboundReceivingUpdate): Promise<InboundReceivingRow | null> {
  const sql = db();
  if (f.status === "completed") {
    const [agg] = await sql`
      SELECT COUNT(*) FILTER (WHERE is_checked) AS checked_count, COUNT(*) AS item_count
      FROM inbound_receiving_item WHERE receiving_id = ${id}
    `;
    if (Number(agg.checked_count) < Number(agg.item_count)) {
      throw new InboundReceivingError(400, "Checklist belum lengkap, tidak bisa ditandai selesai");
    }
  }
  const completedAt = f.status === "completed" ? new Date().toISOString() : f.status === "in_progress" ? null : undefined;
  const rows = await sql`
    UPDATE inbound_receiving SET
      vendor_id     = COALESCE(${f.vendor_id ?? null}, vendor_id),
      vendor_name   = COALESCE(${f.vendor_name ?? null}, vendor_name),
      po_number     = ${f.po_number !== undefined ? f.po_number : sql`po_number`},
      received_date = COALESCE(${f.received_date ?? null}, received_date),
      cabang        = ${f.cabang !== undefined ? f.cabang : sql`cabang`},
      received_by   = ${f.received_by !== undefined ? f.received_by : sql`received_by`},
      status        = COALESCE(${f.status ?? null}, status),
      overall_notes = ${f.overall_notes !== undefined ? f.overall_notes : sql`overall_notes`},
      completed_at  = ${completedAt !== undefined ? completedAt : sql`completed_at`},
      updated_at    = now()
    WHERE id = ${id}
    RETURNING id, vendor_id, vendor_name, po_number, received_date::text, cabang,
      received_by, status, overall_notes, completed_at::text, created_by,
      created_at::text, updated_at::text
  `;
  if (!rows.length) return null;
  const [agg] = await sql`
    SELECT COUNT(*) FILTER (WHERE is_checked) AS checked_count, COUNT(*) AS item_count
    FROM inbound_receiving_item WHERE receiving_id = ${id}
  `;
  return mapRow({ ...rows[0], ...agg });
}

export async function deleteInboundReceiving(id: string): Promise<{ deleted: number }> {
  const sql = db();
  const rows = await sql`DELETE FROM inbound_receiving WHERE id = ${id} RETURNING id`;
  return { deleted: rows.length };
}

export async function addInboundReceivingItem(receivingId: string, label: string): Promise<InboundReceivingItemRow | null> {
  const sql = db();
  const head = await sql`SELECT id FROM inbound_receiving WHERE id = ${receivingId}`;
  if (!head.length) return null;
  const [maxSort] = await sql`SELECT COALESCE(MAX(sort_order), -1) AS m FROM inbound_receiving_item WHERE receiving_id = ${receivingId}`;
  const rows = await sql`
    INSERT INTO inbound_receiving_item (receiving_id, label, sort_order)
    VALUES (${receivingId}, ${label}, ${Number(maxSort.m) + 1})
    RETURNING ${itemCols(sql)}
  `;
  return mapItem(rows[0]);
}

export interface InboundReceivingItemUpdate {
  label?: string;
  is_checked?: boolean;
  notes?: string | null;
}

export async function updateInboundReceivingItem(
  receivingId: string,
  itemId: string,
  f: InboundReceivingItemUpdate,
): Promise<InboundReceivingItemRow | null> {
  const sql = db();
  if (f.is_checked !== undefined) {
    const [header] = await sql`SELECT status FROM inbound_receiving WHERE id = ${receivingId}`;
    if (header?.status === "completed") {
      throw new InboundReceivingError(400, "Receiving sudah completed — kembalikan status ke in_progress dulu sebelum ubah checklist");
    }
  }
  const rows = await sql`
    UPDATE inbound_receiving_item SET
      label      = COALESCE(${f.label ?? null}, label),
      is_checked = COALESCE(${f.is_checked ?? null}, is_checked),
      notes      = ${f.notes !== undefined ? f.notes : sql`notes`},
      updated_at = now()
    WHERE id = ${itemId} AND receiving_id = ${receivingId}
    RETURNING ${itemCols(sql)}
  `;
  return rows.length ? mapItem(rows[0]) : null;
}

export async function deleteInboundReceivingItem(receivingId: string, itemId: string): Promise<{ deleted: number }> {
  const sql = db();
  const rows = await sql`DELETE FROM inbound_receiving_item WHERE id = ${itemId} AND receiving_id = ${receivingId} RETURNING id`;
  return { deleted: rows.length };
}
