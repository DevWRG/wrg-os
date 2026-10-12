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

export type InboundReceivingSource = "manual" | "accurate";

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
  /** manual = diketik di WRG-OS (pra-206), accurate = salinan Penerimaan Barang Accurate. */
  source: InboundReceivingSource;
  accurate_number: string | null;
  /** Nomor surat jalan / DO vendor (receiveNumber Accurate). */
  supplier_doc_number: string | null;
  accurate_status: string | null;
  synced_at: string | null;
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
    source: String(r.source ?? "manual") as InboundReceivingSource,
    accurate_number: r.accurate_number != null ? String(r.accurate_number) : null,
    supplier_doc_number: r.supplier_doc_number != null ? String(r.supplier_doc_number) : null,
    accurate_status: r.accurate_status != null ? String(r.accurate_status) : null,
    synced_at: r.synced_at != null ? String(r.synced_at) : null,
  };
}

export interface InboundReceivingLineRow {
  id: string;
  item_no: string | null;
  item_desc: string;
  qty: number;
  unit: string | null;
  warehouse_name: string | null;
  po_number: string | null;
  /** id purchase_order WRG-OS (cermin 205) kalau PO-nya sudah tersinkron. */
  purchase_order_id: string | null;
  notes: string | null;
}

// date/timestamptz eksplisit ::text — tanpa ini postgres.js balikin objek
// Date yang ke-serialize jadi "Mon Jul 20 2026 …" (toString()), bukan ISO
// (lihat gotcha yang sama di supplier-eta.ts/todo.ts/leave.ts).
function receivingCols(sql: ReturnType<typeof db>) {
  return sql`
    ir.id, ir.vendor_id, ir.vendor_name, ir.po_number, ir.received_date::text,
    ir.cabang, ir.received_by, ir.status, ir.overall_notes,
    ir.completed_at::text, ir.created_by, ir.created_at::text, ir.updated_at::text,
    ir.source, ir.accurate_number, ir.supplier_doc_number, ir.accurate_status, ir.synced_at::text,
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
  /** Baris barang dari Accurate (kosong utk baris manual). */
  lines: InboundReceivingLineRow[];
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
        created_at::text, updated_at::text, source
    `;
    const header = rows[0];
    const items = await tx`
      INSERT INTO inbound_receiving_item (receiving_id, label, sort_order)
      SELECT ${header.id}, label, ord - 1
      FROM unnest(${DEFAULT_CHECKLIST_LABELS}::text[]) WITH ORDINALITY AS t(label, ord)
      RETURNING id, receiving_id, label, is_checked, notes, sort_order
    `;
    return { ...mapRow({ ...header, checked_count: 0, item_count: items.length }), items: items.map(mapItem), lines: [] };
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
  const lines = await sql`
    SELECT l.id, l.item_no, l.item_desc, l.qty, l.unit, l.warehouse_name, l.po_number, po.id AS purchase_order_id, l.notes
    FROM inbound_receiving_line l
    LEFT JOIN purchase_order po ON po.accurate_id = l.accurate_po_id
    WHERE l.receiving_id = ${id}
    ORDER BY l.created_at ASC, l.accurate_detail_id ASC
  `;
  return {
    ...mapRow(rows[0]),
    items: items.map(mapItem),
    lines: lines.map((l) => ({
      id: String(l.id),
      item_no: l.item_no != null ? String(l.item_no) : null,
      item_desc: String(l.item_desc),
      qty: Number(l.qty),
      unit: l.unit != null ? String(l.unit) : null,
      warehouse_name: l.warehouse_name != null ? String(l.warehouse_name) : null,
      po_number: l.po_number != null ? String(l.po_number) : null,
      purchase_order_id: l.purchase_order_id != null ? String(l.purchase_order_id) : null,
      notes: l.notes != null ? String(l.notes) : null,
    })),
  };
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

// Header salinan Accurate (206) dikelola di Accurate — supplier, nomor PO,
// tanggal terima ikut sinkron. Yang tetap milik WRG-OS: status checklist,
// catatan, dan siapa yang memeriksa.
const ACCURATE_HEADER_FIELDS: (keyof InboundReceivingUpdate)[] = ["vendor_id", "vendor_name", "po_number", "received_date", "cabang"];

export async function updateInboundReceiving(id: string, f: InboundReceivingUpdate): Promise<InboundReceivingRow | null> {
  const sql = db();
  const [src] = await sql`SELECT source FROM inbound_receiving WHERE id = ${id}`;
  if (src?.source === "accurate" && ACCURATE_HEADER_FIELDS.some((k) => f[k] !== undefined)) {
    throw new InboundReceivingError(409, "Data penerimaan ini dari Accurate — supplier, PO, tanggal, dan gudang diubah di Accurate.");
  }
  if (f.status === "completed") {
    const [agg] = await sql`
      SELECT COUNT(*) FILTER (WHERE is_checked) AS checked_count, COUNT(*) AS item_count
      FROM inbound_receiving_item WHERE receiving_id = ${id}
    `;
    // item_count 0 dulu lolos (0 < 0 = false): hapus semua poin lalu tandai
    // selesai = penerimaan "terverifikasi" tanpa satu pun poin dicek.
    if (Number(agg.item_count) === 0) {
      throw new InboundReceivingError(400, "Checklist kosong — tambahkan minimal satu poin verifikasi sebelum ditandai selesai");
    }
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
      created_at::text, updated_at::text, source, accurate_number, supplier_doc_number,
      accurate_status, synced_at::text
  `;
  if (!rows.length) return null;
  const [agg] = await sql`
    SELECT COUNT(*) FILTER (WHERE is_checked) AS checked_count, COUNT(*) AS item_count
    FROM inbound_receiving_item WHERE receiving_id = ${id}
  `;
  return mapRow({ ...rows[0], ...agg });
}

// Checklist yang sudah completed dibekukan utuh, bukan cuma centangnya: dulu
// poin baru (belum dicek) bisa ditambah, poin terverifikasi dihapus, dan label
// diganti — status tetap "completed" padahal isinya sudah bukan yang dicek.
async function assertNotCompleted(sql: ReturnType<typeof db>, receivingId: string): Promise<void> {
  const [header] = await sql`SELECT status FROM inbound_receiving WHERE id = ${receivingId}`;
  if (header?.status === "completed") {
    throw new InboundReceivingError(400, "Receiving sudah completed — kembalikan status ke in_progress dulu sebelum ubah checklist");
  }
}

export async function deleteInboundReceiving(id: string): Promise<{ deleted: number }> {
  const sql = db();
  const [src] = await sql`SELECT source FROM inbound_receiving WHERE id = ${id}`;
  if (src?.source === "accurate") {
    throw new InboundReceivingError(409, "Penerimaan dari Accurate tak bisa dihapus di sini — hapus/batalkan di Accurate.");
  }
  const rows = await sql`DELETE FROM inbound_receiving WHERE id = ${id} RETURNING id`;
  return { deleted: rows.length };
}

export async function addInboundReceivingItem(receivingId: string, label: string): Promise<InboundReceivingItemRow | null> {
  const sql = db();
  const head = await sql`SELECT id FROM inbound_receiving WHERE id = ${receivingId}`;
  if (!head.length) return null;
  await assertNotCompleted(sql, receivingId);
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
  await assertNotCompleted(sql, receivingId);
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
  await assertNotCompleted(sql, receivingId);
  const rows = await sql`DELETE FROM inbound_receiving_item WHERE id = ${itemId} AND receiving_id = ${receivingId} RETURNING id`;
  return { deleted: rows.length };
}

// ── Ringkasan KPI (dihitung di SQL, bukan rows.filter atas daftar terbatas) ──

export async function inboundReceivingSummary(): Promise<{ in_progress: number; ready_to_close: number; completed_this_month: number }> {
  const sql = db();
  const [r] = await sql`
    SELECT
      count(*) FILTER (WHERE ir.status = 'in_progress')::int AS in_progress,
      count(*) FILTER (WHERE ir.status = 'in_progress' AND it.item_count > 0 AND it.checked_count = it.item_count)::int AS ready_to_close,
      count(*) FILTER (
        WHERE ir.status = 'completed'
          AND date_trunc('month', (ir.completed_at AT TIME ZONE 'Asia/Jakarta'))
            = date_trunc('month', (now() AT TIME ZONE 'Asia/Jakarta'))
      )::int AS completed_this_month
    FROM inbound_receiving ir
    LEFT JOIN (
      SELECT receiving_id, COUNT(*) FILTER (WHERE is_checked) AS checked_count, COUNT(*) AS item_count
      FROM inbound_receiving_item GROUP BY receiving_id
    ) it ON it.receiving_id = ir.id
  `;
  return { in_progress: Number(r?.in_progress ?? 0), ready_to_close: Number(r?.ready_to_close ?? 0), completed_this_month: Number(r?.completed_this_month ?? 0) };
}

// ── Cermin Penerimaan Barang Accurate (206) — dipanggil accurateSync.ts ──

export interface AccurateReceiptHeader {
  accurate_id: number;
  accurate_number: string;
  supplier_doc_number: string | null;
  vendor_id: number | null;
  vendor_name: string;
  received_date: string; // YYYY-MM-DD (transDate)
  ship_date: string | null;
  accurate_status: string | null;
  accurate_approval: string | null;
  description: string | null;
  last_update: string | null;
}

/**
 * Upsert header penerimaan Accurate. Baris BARU langsung diberi 4 poin
 * checklist default (sama dengan createInboundReceiving) — checklist itulah
 * yang dikerjakan gudang di WRG-OS. Update hanya menyentuh kolom milik
 * Accurate; status/centang/catatan checklist tak pernah ditimpa sinkron.
 */
export async function upsertAccurateReceipts(rows: AccurateReceiptHeader[]): Promise<{ upserted: number; created: number }> {
  const sql = db();
  let upserted = 0;
  let created = 0;
  for (const r of rows) {
    const [res] = await sql`
      INSERT INTO inbound_receiving (
        vendor_id, vendor_name, received_date, overall_notes, created_by, source, accurate_id, accurate_number,
        supplier_doc_number, accurate_status, accurate_approval, ship_date, accurate_last_update, synced_at
      )
      VALUES (
        (SELECT id FROM accurate_vendor WHERE id = ${r.vendor_id}),
        COALESCE((SELECT NULLIF(name, '') FROM accurate_vendor WHERE id = ${r.vendor_id}), ${r.vendor_name}),
        ${r.received_date}, ${r.description}, 'accurate-receive-sync', 'accurate', ${r.accurate_id}, ${r.accurate_number},
        ${r.supplier_doc_number}, ${r.accurate_status}, ${r.accurate_approval}, ${r.ship_date}, ${r.last_update}, now()
      )
      ON CONFLICT (accurate_id) WHERE accurate_id IS NOT NULL DO UPDATE SET
        vendor_id = EXCLUDED.vendor_id,
        vendor_name = EXCLUDED.vendor_name,
        received_date = EXCLUDED.received_date,
        accurate_number = EXCLUDED.accurate_number,
        supplier_doc_number = EXCLUDED.supplier_doc_number,
        accurate_status = EXCLUDED.accurate_status,
        accurate_approval = EXCLUDED.accurate_approval,
        ship_date = EXCLUDED.ship_date,
        accurate_last_update = EXCLUDED.accurate_last_update,
        synced_at = now(),
        updated_at = now()
      RETURNING id, (xmax = 0) AS inserted
    `;
    upserted++;
    if (res.inserted) {
      created++;
      await sql`
        INSERT INTO inbound_receiving_item (receiving_id, label, sort_order)
        SELECT ${res.id}, label, ord - 1
        FROM unnest(${DEFAULT_CHECKLIST_LABELS}::text[]) WITH ORDINALITY AS t(label, ord)
      `;
    }
  }
  return { upserted, created };
}

export async function pendingAccurateReceiptDetails(limit: number): Promise<{ id: string; accurate_id: number; last_update: string | null }[]> {
  const sql = db();
  const rows = await sql`
    SELECT id, accurate_id, accurate_last_update::text AS last_update
    FROM inbound_receiving
    WHERE source = 'accurate'
      AND (items_last_update IS NULL OR items_last_update IS DISTINCT FROM accurate_last_update)
    ORDER BY received_date DESC
    LIMIT ${limit}
  `;
  return rows.map((r) => ({ id: String(r.id), accurate_id: Number(r.accurate_id), last_update: r.last_update != null ? String(r.last_update) : null }));
}

export async function countPendingAccurateReceiptDetails(): Promise<number> {
  const sql = db();
  const [r] = await sql`
    SELECT count(*)::int AS n FROM inbound_receiving
    WHERE source = 'accurate' AND (items_last_update IS NULL OR items_last_update IS DISTINCT FROM accurate_last_update)
  `;
  return Number(r?.n ?? 0);
}

export interface AccurateReceiptLine {
  accurate_detail_id: number;
  item_no: string | null;
  item_desc: string;
  qty: number;
  unit: string | null;
  warehouse_name: string | null;
  po_number: string | null;
  accurate_po_id: number | null;
  notes: string | null;
}

/**
 * Ganti baris barang satu penerimaan dengan versi Accurate, lalu turunkan
 * kolom header yang dipakai daftar lama: po_number = daftar nomor PO unik,
 * cabang = daftar gudang unik (dulu diketik tangan).
 */
export async function replaceAccurateReceiptLines(receivingId: string, lastUpdate: string | null, lines: AccurateReceiptLine[]): Promise<number> {
  const sql = db();
  return sql.begin(async (tx) => {
    const ids = lines.map((l) => l.accurate_detail_id);
    await tx`
      DELETE FROM inbound_receiving_line
      WHERE receiving_id = ${receivingId} AND NOT (accurate_detail_id = ANY(${ids}::bigint[]))
    `;
    for (const l of lines) {
      await tx`
        INSERT INTO inbound_receiving_line (
          receiving_id, accurate_detail_id, item_no, item_desc, qty, unit, warehouse_name, po_number, accurate_po_id, notes
        )
        VALUES (
          ${receivingId}, ${l.accurate_detail_id}, ${l.item_no}, ${l.item_desc}, ${l.qty}, ${l.unit},
          ${l.warehouse_name}, ${l.po_number}, ${l.accurate_po_id}, ${l.notes}
        )
        ON CONFLICT (accurate_detail_id) DO UPDATE SET
          receiving_id = EXCLUDED.receiving_id, item_no = EXCLUDED.item_no, item_desc = EXCLUDED.item_desc,
          qty = EXCLUDED.qty, unit = EXCLUDED.unit, warehouse_name = EXCLUDED.warehouse_name,
          po_number = EXCLUDED.po_number, accurate_po_id = EXCLUDED.accurate_po_id, notes = EXCLUDED.notes,
          updated_at = now()
      `;
    }
    await tx`
      UPDATE inbound_receiving SET
        items_last_update = ${lastUpdate},
        po_number = (SELECT string_agg(DISTINCT po_number, ', ') FROM inbound_receiving_line WHERE receiving_id = ${receivingId}),
        cabang = (SELECT string_agg(DISTINCT warehouse_name, ', ') FROM inbound_receiving_line WHERE receiving_id = ${receivingId})
      WHERE id = ${receivingId}
    `;
    return lines.length;
  });
}

export async function inboundReceivingSyncState(): Promise<{ last_synced_at: string | null; last_run_ok: boolean | null; summary: unknown }> {
  const sql = db();
  const [st] = await sql`
    SELECT last_synced_at::text, last_run_ok, last_run_summary FROM accurate_sync_state WHERE entity = 'receive-item'
  `;
  return {
    last_synced_at: st?.last_synced_at != null ? String(st.last_synced_at) : null,
    last_run_ok: st?.last_run_ok ?? null,
    summary: st?.last_run_summary ?? null,
  };
}
