import { db } from "../db.js";

// F13 PO Tracker + Sistem Barang Masuk (Purchasing). Header (purchase_order)
// = satu PO ke vendor; item (purchase_order_item) = barang yang dipesan;
// receipt (purchase_order_receipt) = log tiap kejadian barang datang per item
// (lihat 078_purchase_order.sql). qty_received & status dihitung di
// query/JS, bukan kolom tersimpan — pola computed sama dgn "telat" F39/
// "stok" F49/"variance" F51. date/timestamptz eksplisit ::text di
// SELECT/RETURNING (gotcha postgres.js yang sama di semua repo lain).

export type PurchaseOrderStatus = "ordered" | "partial_received" | "received" | "cancelled";

export interface PurchaseOrderReceiptRow {
  id: string;
  po_item_id: string;
  qty_received: number;
  received_date: string;
  received_by: string | null;
  condition_notes: string | null;
  created_at: string;
  updated_at: string;
}

function mapReceipt(r: Record<string, unknown>): PurchaseOrderReceiptRow {
  return {
    id: String(r.id),
    po_item_id: String(r.po_item_id),
    qty_received: Number(r.qty_received),
    received_date: String(r.received_date),
    received_by: r.received_by != null ? String(r.received_by) : null,
    condition_notes: r.condition_notes != null ? String(r.condition_notes) : null,
    created_at: String(r.created_at),
    updated_at: String(r.updated_at),
  };
}

function receiptCols(sql: ReturnType<typeof db>) {
  return sql`id, po_item_id, qty_received, received_date::text, received_by, condition_notes, created_at::text, updated_at::text`;
}

export interface PurchaseOrderItemRow {
  id: string;
  purchase_order_id: string;
  item_desc: string;
  qty_ordered: number;
  unit: string | null;
  unit_price: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  qty_received: number;
}

function mapItem(r: Record<string, unknown>): PurchaseOrderItemRow {
  return {
    id: String(r.id),
    purchase_order_id: String(r.purchase_order_id),
    item_desc: String(r.item_desc),
    qty_ordered: Number(r.qty_ordered),
    unit: r.unit != null ? String(r.unit) : null,
    unit_price: r.unit_price != null ? Number(r.unit_price) : null,
    notes: r.notes != null ? String(r.notes) : null,
    created_at: String(r.created_at),
    updated_at: String(r.updated_at),
    qty_received: Number(r.qty_received ?? 0),
  };
}

function itemCols(sql: ReturnType<typeof db>) {
  return sql`
    i.id, i.purchase_order_id, i.item_desc, i.qty_ordered, i.unit, i.unit_price, i.notes,
    i.created_at::text, i.updated_at::text,
    COALESCE(rc.qty_received, 0) AS qty_received
  `;
}

const ITEM_RECEIPT_JOIN = (sql: ReturnType<typeof db>) => sql`
  LEFT JOIN (
    SELECT po_item_id, SUM(qty_received) AS qty_received
    FROM purchase_order_receipt GROUP BY po_item_id
  ) rc ON rc.po_item_id = i.id
`;

export interface PurchaseOrderRow {
  id: string;
  po_number: string;
  vendor_id: string | null;
  vendor_name: string;
  order_date: string;
  eta_date: string | null;
  cabang: string | null;
  pic: string | null;
  notes: string | null;
  cancelled_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  item_count: number;
  received_item_count: number;
  any_received: boolean;
  status: PurchaseOrderStatus;
}

function computeStatus(cancelled_at: string | null, item_count: number, received_item_count: number, any_received: boolean): PurchaseOrderStatus {
  if (cancelled_at) return "cancelled";
  if (item_count === 0) return "ordered";
  if (received_item_count === item_count) return "received";
  if (any_received) return "partial_received";
  return "ordered";
}

function mapRow(r: Record<string, unknown>): PurchaseOrderRow {
  const cancelled_at = r.cancelled_at != null ? String(r.cancelled_at) : null;
  const item_count = Number(r.item_count ?? 0);
  const received_item_count = Number(r.received_item_count ?? 0);
  const any_received = Boolean(r.any_received);
  return {
    id: String(r.id),
    po_number: String(r.po_number),
    vendor_id: r.vendor_id != null ? String(r.vendor_id) : null,
    vendor_name: String(r.vendor_name),
    order_date: String(r.order_date),
    eta_date: r.eta_date != null ? String(r.eta_date) : null,
    cabang: r.cabang != null ? String(r.cabang) : null,
    pic: r.pic != null ? String(r.pic) : null,
    notes: r.notes != null ? String(r.notes) : null,
    cancelled_at,
    created_by: r.created_by != null ? String(r.created_by) : null,
    created_at: String(r.created_at),
    updated_at: String(r.updated_at),
    item_count,
    received_item_count,
    any_received,
    status: computeStatus(cancelled_at, item_count, received_item_count, any_received),
  };
}

// date/timestamptz eksplisit ::text — tanpa ini postgres.js balikin objek
// Date yang ke-serialize jadi "Mon Jul 20 2026 …" (toString()), bukan ISO
// (gotcha yang sama di supplier-eta.ts/inbound-receiving.ts/dana-ops.ts).
function poCols(sql: ReturnType<typeof db>) {
  return sql`
    po.id, po.po_number, po.vendor_id, po.vendor_name, po.order_date::text, po.eta_date::text,
    po.cabang, po.pic, po.notes, po.cancelled_at::text, po.created_by,
    po.created_at::text, po.updated_at::text,
    COALESCE(agg.item_count, 0) AS item_count,
    COALESCE(agg.received_item_count, 0) AS received_item_count,
    COALESCE(agg.any_received, false) AS any_received
  `;
}

const PO_ITEM_AGG_JOIN = (sql: ReturnType<typeof db>) => sql`
  LEFT JOIN (
    SELECT i.purchase_order_id,
      COUNT(*) AS item_count,
      COUNT(*) FILTER (WHERE COALESCE(rc.qty_received, 0) >= i.qty_ordered) AS received_item_count,
      bool_or(COALESCE(rc.qty_received, 0) > 0) AS any_received
    FROM purchase_order_item i
    LEFT JOIN (
      SELECT po_item_id, SUM(qty_received) AS qty_received
      FROM purchase_order_receipt GROUP BY po_item_id
    ) rc ON rc.po_item_id = i.id
    GROUP BY i.purchase_order_id
  ) agg ON agg.purchase_order_id = po.id
`;

export interface PurchaseOrderItemInput {
  item_desc: string;
  qty_ordered: number;
  unit?: string | null;
  unit_price?: number | null;
  notes?: string | null;
}

export interface PurchaseOrderInput {
  po_number: string;
  vendor_id?: string | null;
  vendor_name: string;
  order_date?: string;
  eta_date?: string | null;
  cabang?: string | null;
  pic?: string | null;
  notes?: string | null;
  created_by?: string | null;
  items: PurchaseOrderItemInput[];
}

export interface PurchaseOrderDetail extends PurchaseOrderRow {
  items: PurchaseOrderItemRow[];
}

export async function createPurchaseOrder(t: PurchaseOrderInput): Promise<PurchaseOrderDetail> {
  const sql = db();
  const id = await sql.begin(async (tx) => {
    const rows = await tx`
      INSERT INTO purchase_order (po_number, vendor_id, vendor_name, order_date, eta_date, cabang, pic, notes, created_by)
      VALUES (${t.po_number}, ${t.vendor_id ?? null}, ${t.vendor_name}, ${t.order_date ?? tx`CURRENT_DATE`},
              ${t.eta_date ?? null}, ${t.cabang ?? null}, ${t.pic ?? null}, ${t.notes ?? null}, ${t.created_by ?? null})
      RETURNING id
    `;
    const poId = String(rows[0].id);
    for (const it of t.items) {
      await tx`
        INSERT INTO purchase_order_item (purchase_order_id, item_desc, qty_ordered, unit, unit_price, notes)
        VALUES (${poId}, ${it.item_desc}, ${it.qty_ordered}, ${it.unit ?? null}, ${it.unit_price ?? null}, ${it.notes ?? null})
      `;
    }
    return poId;
  });
  const detail = await getPurchaseOrder(id);
  if (!detail) throw new Error("gagal membaca PO setelah dibuat");
  return detail;
}

export async function listPurchaseOrders(opts?: { vendorId?: string; cabang?: string; limit?: number }): Promise<PurchaseOrderRow[]> {
  const sql = db();
  const limit = opts?.limit ?? 1000;
  const rows = await sql`
    SELECT ${poCols(sql)}
    FROM purchase_order po
    ${PO_ITEM_AGG_JOIN(sql)}
    WHERE ${opts?.vendorId ? sql`po.vendor_id = ${opts.vendorId}` : sql`true`}
      AND ${opts?.cabang ? sql`po.cabang = ${opts.cabang}` : sql`true`}
    ORDER BY po.order_date DESC, po.created_at DESC
    LIMIT ${limit}
  `;
  return rows.map(mapRow);
}

export async function getPurchaseOrder(id: string): Promise<PurchaseOrderDetail | null> {
  const sql = db();
  const rows = await sql`SELECT ${poCols(sql)} FROM purchase_order po ${PO_ITEM_AGG_JOIN(sql)} WHERE po.id = ${id}`;
  if (!rows.length) return null;
  const items = await sql`
    SELECT ${itemCols(sql)} FROM purchase_order_item i ${ITEM_RECEIPT_JOIN(sql)}
    WHERE i.purchase_order_id = ${id} ORDER BY i.created_at ASC
  `;
  return { ...mapRow(rows[0]), items: items.map(mapItem) };
}

export interface PurchaseOrderUpdate {
  po_number?: string;
  vendor_id?: string | null;
  vendor_name?: string;
  order_date?: string;
  eta_date?: string | null;
  cabang?: string | null;
  pic?: string | null;
  notes?: string | null;
  cancelled?: boolean;
}

export async function updatePurchaseOrder(id: string, f: PurchaseOrderUpdate): Promise<PurchaseOrderRow | null> {
  const sql = db();
  const cancelledAt = f.cancelled === true ? new Date().toISOString() : f.cancelled === false ? null : undefined;
  const rows = await sql`
    UPDATE purchase_order SET
      po_number    = COALESCE(${f.po_number ?? null}, po_number),
      vendor_id    = ${f.vendor_id !== undefined ? f.vendor_id : sql`vendor_id`},
      vendor_name  = COALESCE(${f.vendor_name ?? null}, vendor_name),
      order_date   = COALESCE(${f.order_date ?? null}, order_date),
      eta_date     = ${f.eta_date !== undefined ? f.eta_date : sql`eta_date`},
      cabang       = ${f.cabang !== undefined ? f.cabang : sql`cabang`},
      pic          = ${f.pic !== undefined ? f.pic : sql`pic`},
      notes        = ${f.notes !== undefined ? f.notes : sql`notes`},
      cancelled_at = ${cancelledAt !== undefined ? cancelledAt : sql`cancelled_at`},
      updated_at   = now()
    WHERE id = ${id}
    RETURNING id
  `;
  if (!rows.length) return null;
  const [row] = await sql`SELECT ${poCols(sql)} FROM purchase_order po ${PO_ITEM_AGG_JOIN(sql)} WHERE po.id = ${id}`;
  return mapRow(row);
}

export async function deletePurchaseOrder(id: string): Promise<{ deleted: number }> {
  const sql = db();
  const rows = await sql`DELETE FROM purchase_order WHERE id = ${id} RETURNING id`;
  return { deleted: rows.length };
}

export async function addPurchaseOrderItem(purchaseOrderId: string, t: PurchaseOrderItemInput): Promise<PurchaseOrderItemRow | null> {
  const sql = db();
  const head = await sql`SELECT id FROM purchase_order WHERE id = ${purchaseOrderId}`;
  if (!head.length) return null;
  const rows = await sql`
    INSERT INTO purchase_order_item (purchase_order_id, item_desc, qty_ordered, unit, unit_price, notes)
    VALUES (${purchaseOrderId}, ${t.item_desc}, ${t.qty_ordered}, ${t.unit ?? null}, ${t.unit_price ?? null}, ${t.notes ?? null})
    RETURNING id
  `;
  const [row] = await sql`SELECT ${itemCols(sql)} FROM purchase_order_item i ${ITEM_RECEIPT_JOIN(sql)} WHERE i.id = ${rows[0].id}`;
  return mapItem(row);
}

export interface PurchaseOrderItemUpdate {
  item_desc?: string;
  qty_ordered?: number;
  unit?: string | null;
  unit_price?: number | null;
  notes?: string | null;
}

export async function updatePurchaseOrderItem(
  purchaseOrderId: string,
  itemId: string,
  f: PurchaseOrderItemUpdate,
): Promise<PurchaseOrderItemRow | null> {
  const sql = db();
  const rows = await sql`
    UPDATE purchase_order_item SET
      item_desc   = COALESCE(${f.item_desc ?? null}, item_desc),
      qty_ordered = COALESCE(${f.qty_ordered ?? null}, qty_ordered),
      unit        = ${f.unit !== undefined ? f.unit : sql`unit`},
      unit_price  = ${f.unit_price !== undefined ? f.unit_price : sql`unit_price`},
      notes       = ${f.notes !== undefined ? f.notes : sql`notes`},
      updated_at  = now()
    WHERE id = ${itemId} AND purchase_order_id = ${purchaseOrderId}
    RETURNING id
  `;
  if (!rows.length) return null;
  const [row] = await sql`SELECT ${itemCols(sql)} FROM purchase_order_item i ${ITEM_RECEIPT_JOIN(sql)} WHERE i.id = ${itemId}`;
  return mapItem(row);
}

export async function deletePurchaseOrderItem(purchaseOrderId: string, itemId: string): Promise<{ deleted: number }> {
  const sql = db();
  const rows = await sql`DELETE FROM purchase_order_item WHERE id = ${itemId} AND purchase_order_id = ${purchaseOrderId} RETURNING id`;
  return { deleted: rows.length };
}

export interface PurchaseOrderReceiptInput {
  qty_received: number;
  received_date?: string;
  received_by?: string | null;
  condition_notes?: string | null;
}

export async function addPurchaseOrderReceipt(
  purchaseOrderId: string,
  itemId: string,
  t: PurchaseOrderReceiptInput,
): Promise<PurchaseOrderReceiptRow | null> {
  const sql = db();
  const item = await sql`SELECT id FROM purchase_order_item WHERE id = ${itemId} AND purchase_order_id = ${purchaseOrderId}`;
  if (!item.length) return null;
  const rows = await sql`
    INSERT INTO purchase_order_receipt (po_item_id, qty_received, received_date, received_by, condition_notes)
    VALUES (${itemId}, ${t.qty_received}, ${t.received_date ?? sql`CURRENT_DATE`}, ${t.received_by ?? null}, ${t.condition_notes ?? null})
    RETURNING ${receiptCols(sql)}
  `;
  return mapReceipt(rows[0]);
}

export async function listPurchaseOrderReceipts(itemId: string): Promise<PurchaseOrderReceiptRow[]> {
  const sql = db();
  const rows = await sql`SELECT ${receiptCols(sql)} FROM purchase_order_receipt WHERE po_item_id = ${itemId} ORDER BY received_date ASC, created_at ASC`;
  return rows.map(mapReceipt);
}

export interface PurchaseOrderReceiptUpdate {
  qty_received?: number;
  received_date?: string;
  received_by?: string | null;
  condition_notes?: string | null;
}

export async function updatePurchaseOrderReceipt(
  itemId: string,
  receiptId: string,
  f: PurchaseOrderReceiptUpdate,
): Promise<PurchaseOrderReceiptRow | null> {
  const sql = db();
  const rows = await sql`
    UPDATE purchase_order_receipt SET
      qty_received    = COALESCE(${f.qty_received ?? null}, qty_received),
      received_date   = COALESCE(${f.received_date ?? null}, received_date),
      received_by     = ${f.received_by !== undefined ? f.received_by : sql`received_by`},
      condition_notes = ${f.condition_notes !== undefined ? f.condition_notes : sql`condition_notes`},
      updated_at      = now()
    WHERE id = ${receiptId} AND po_item_id = ${itemId}
    RETURNING ${receiptCols(sql)}
  `;
  return rows.length ? mapReceipt(rows[0]) : null;
}

export async function deletePurchaseOrderReceipt(itemId: string, receiptId: string): Promise<{ deleted: number }> {
  const sql = db();
  const rows = await sql`DELETE FROM purchase_order_receipt WHERE id = ${receiptId} AND po_item_id = ${itemId} RETURNING id`;
  return { deleted: rows.length };
}
