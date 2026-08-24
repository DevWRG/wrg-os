import { db } from "../db.js";

// F13 PO Tracker + Sistem Barang Masuk (Purchasing). Header (purchase_order)
// = satu PO ke vendor; item (purchase_order_item) = barang yang dipesan;
// receipt (purchase_order_receipt) = log tiap kejadian barang datang per item
// (lihat 143_purchase_order.sql). qty_received & status dihitung di
// query/JS, bukan kolom tersimpan — pola computed sama dgn "telat" F39/
// "stok" F49/"variance" F51. date/timestamptz eksplisit ::text di
// SELECT/RETURNING (gotcha postgres.js yang sama di semua repo lain).
//
// F35 PO Approval Workflow (146_purchase_order_approval.sql) menambah gate
// berjenjang di atas: Tier 1 (paralel) HOD Business (IVD/Medical sesuai
// `lini`) + HOD Finance, lalu Tier 2 Direktur. approval_status DIHITUNG dari
// baris purchase_order_approval (pola computed yang sama), bukan kolom
// tersimpan. PO dgn lini NULL (dibuat sebelum F35) = "legacy_exempt", tidak
// kena gate. required_hod_key di-snapshot saat create (lihat createPurchaseOrder),
// bukan di-resolve ulang live dari lini saat approve.

export type PurchaseOrderStatus = "ordered" | "partial_received" | "received" | "cancelled";

export class PurchaseOrderError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "PurchaseOrderError";
  }
}

export type ApproverRole = "hod_business" | "hod_finance" | "direktur";
export type ApprovalDecisionStatus = "pending" | "approved" | "rejected";
export type ApprovalStatus = "legacy_exempt" | "pending_tier1" | "pending_direktur" | "approved" | "rejected";
export type PurchaseOrderLini = "IVD" | "Medical";

// hod_key kanonik dari apps/api/src/hod-resolver.ts (HODS) — mufid=HoD Business
// IVD, arman=HoD Business Medical, ika=HoD Finance & SC. Duplikasi konstanta
// lintas file/app sudah pola existing (HOD_DEFS di watchpoint.ts vs
// hod-options.ts di web) krn apps/api & apps/web tak saling impor.
export const LINI_HOD_KEY: Record<PurchaseOrderLini, string> = { IVD: "mufid", Medical: "arman" };
export const FINANCE_HOD_KEY = "ika";

export interface PurchaseOrderApprovalRow {
  id: string;
  purchase_order_id: string;
  approver_role: ApproverRole;
  required_hod_key: string | null;
  status: ApprovalDecisionStatus;
  decided_by: string | null;
  decided_at: string | null;
  note: string | null;
}

function mapApproval(r: Record<string, unknown>): PurchaseOrderApprovalRow {
  return {
    id: String(r.id),
    purchase_order_id: String(r.purchase_order_id),
    approver_role: r.approver_role as ApproverRole,
    required_hod_key: r.required_hod_key != null ? String(r.required_hod_key) : null,
    status: r.status as ApprovalDecisionStatus,
    decided_by: r.decided_by != null ? String(r.decided_by) : null,
    decided_at: r.decided_at != null ? String(r.decided_at) : null,
    note: r.note != null ? String(r.note) : null,
  };
}

function approvalCols(sql: ReturnType<typeof db>) {
  return sql`id, purchase_order_id, approver_role, required_hod_key, status, decided_by, decided_at::text, note`;
}

// Satu-satunya tempat state-machine approval diputuskan (dipakai list —dari
// flag agregat SQL— maupun detail/decide —dari baris penuh—, lihat
// computeApprovalStatus) supaya logikanya tidak dobel.
function deriveApprovalStatus(
  lini: PurchaseOrderLini | null,
  anyRejected: boolean,
  tier1Approved: boolean,
  direkturApproved: boolean,
): ApprovalStatus {
  if (lini === null) return "legacy_exempt";
  if (anyRejected) return "rejected";
  if (tier1Approved && direkturApproved) return "approved";
  if (tier1Approved) return "pending_direktur";
  return "pending_tier1";
}

export function computeApprovalStatus(lini: PurchaseOrderLini | null, rows: PurchaseOrderApprovalRow[]): ApprovalStatus {
  const byRole = (role: ApproverRole) => rows.find((r) => r.approver_role === role)?.status;
  const anyRejected = rows.some((r) => r.status === "rejected");
  const tier1Approved = byRole("hod_business") === "approved" && byRole("hod_finance") === "approved";
  const direkturApproved = byRole("direktur") === "approved";
  return deriveApprovalStatus(lini, anyRejected, tier1Approved, direkturApproved);
}

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
  lini: PurchaseOrderLini | null;
  approval_status: ApprovalStatus;
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
  const lini = (r.lini != null ? String(r.lini) : null) as PurchaseOrderLini | null;
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
    lini,
    approval_status: deriveApprovalStatus(lini, Boolean(r.approval_any_rejected), Boolean(r.approval_tier1_approved), Boolean(r.approval_direktur_approved)),
  };
}

// date/timestamptz eksplisit ::text — tanpa ini postgres.js balikin objek
// Date yang ke-serialize jadi "Mon Jul 20 2026 …" (toString()), bukan ISO
// (gotcha yang sama di supplier-eta.ts/inbound-receiving.ts/dana-ops.ts).
function poCols(sql: ReturnType<typeof db>) {
  return sql`
    po.id, po.po_number, po.vendor_id, po.vendor_name, po.order_date::text, po.eta_date::text,
    po.cabang, po.pic, po.notes, po.cancelled_at::text, po.created_by, po.lini,
    po.created_at::text, po.updated_at::text,
    COALESCE(agg.item_count, 0) AS item_count,
    COALESCE(agg.received_item_count, 0) AS received_item_count,
    COALESCE(agg.any_received, false) AS any_received,
    COALESCE(appr.any_rejected, false) AS approval_any_rejected,
    COALESCE(appr.tier1_approved, false) AS approval_tier1_approved,
    COALESCE(appr.direktur_approved, false) AS approval_direktur_approved
  `;
}

// Ringkasan approval utk list — flag agregat, bukan baris penuh (pola sama
// PO_ITEM_AGG_JOIN: detail baru ambil array lengkap, list cukup summary).
const PO_APPROVAL_AGG_JOIN = (sql: ReturnType<typeof db>) => sql`
  LEFT JOIN (
    SELECT purchase_order_id,
      bool_or(status = 'rejected') AS any_rejected,
      bool_and(status = 'approved') FILTER (WHERE approver_role IN ('hod_business', 'hod_finance')) AS tier1_approved,
      bool_or(status = 'approved' AND approver_role = 'direktur') AS direktur_approved
    FROM purchase_order_approval
    GROUP BY purchase_order_id
  ) appr ON appr.purchase_order_id = po.id
`;

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
  lini: PurchaseOrderLini;
  items: PurchaseOrderItemInput[];
}

export interface PurchaseOrderDetail extends PurchaseOrderRow {
  items: PurchaseOrderItemRow[];
  approvals: PurchaseOrderApprovalRow[];
}

export async function createPurchaseOrder(t: PurchaseOrderInput): Promise<PurchaseOrderDetail> {
  if (t.lini !== "IVD" && t.lini !== "Medical") {
    throw new PurchaseOrderError(400, "lini wajib diisi (IVD/Medical)");
  }
  const sql = db();
  const id = await sql.begin(async (tx) => {
    const rows = await tx`
      INSERT INTO purchase_order (po_number, vendor_id, vendor_name, order_date, eta_date, cabang, pic, notes, created_by, lini)
      VALUES (${t.po_number}, ${t.vendor_id ?? null}, ${t.vendor_name}, ${t.order_date ?? tx`CURRENT_DATE`},
              ${t.eta_date ?? null}, ${t.cabang ?? null}, ${t.pic ?? null}, ${t.notes ?? null}, ${t.created_by ?? null}, ${t.lini})
      RETURNING id
    `;
    const poId = String(rows[0].id);
    for (const it of t.items) {
      await tx`
        INSERT INTO purchase_order_item (purchase_order_id, item_desc, qty_ordered, unit, unit_price, notes)
        VALUES (${poId}, ${it.item_desc}, ${it.qty_ordered}, ${it.unit ?? null}, ${it.unit_price ?? null}, ${it.notes ?? null})
      `;
    }
    // F35 — seed 3 baris approval (Tier 1 paralel hod_business+hod_finance,
    // Tier 2 direktur). required_hod_key di-snapshot dari lini saat ini.
    await tx`
      INSERT INTO purchase_order_approval (purchase_order_id, approver_role, required_hod_key)
      VALUES
        (${poId}, 'hod_business', ${LINI_HOD_KEY[t.lini]}),
        (${poId}, 'hod_finance', ${FINANCE_HOD_KEY}),
        (${poId}, 'direktur', ${null})
    `;
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
    ${PO_APPROVAL_AGG_JOIN(sql)}
    WHERE ${opts?.vendorId ? sql`po.vendor_id = ${opts.vendorId}` : sql`true`}
      AND ${opts?.cabang ? sql`po.cabang = ${opts.cabang}` : sql`true`}
    ORDER BY po.order_date DESC, po.created_at DESC
    LIMIT ${limit}
  `;
  return rows.map(mapRow);
}

export async function getPurchaseOrder(id: string): Promise<PurchaseOrderDetail | null> {
  const sql = db();
  const rows = await sql`SELECT ${poCols(sql)} FROM purchase_order po ${PO_ITEM_AGG_JOIN(sql)} ${PO_APPROVAL_AGG_JOIN(sql)} WHERE po.id = ${id}`;
  if (!rows.length) return null;
  const items = await sql`
    SELECT ${itemCols(sql)} FROM purchase_order_item i ${ITEM_RECEIPT_JOIN(sql)}
    WHERE i.purchase_order_id = ${id} ORDER BY i.created_at ASC
  `;
  const approvals = await sql`
    SELECT ${approvalCols(sql)} FROM purchase_order_approval WHERE purchase_order_id = ${id} ORDER BY created_at ASC
  `;
  return { ...mapRow(rows[0]), items: items.map(mapItem), approvals: approvals.map(mapApproval) };
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
  const [row] = await sql`SELECT ${poCols(sql)} FROM purchase_order po ${PO_ITEM_AGG_JOIN(sql)} ${PO_APPROVAL_AGG_JOIN(sql)} WHERE po.id = ${id}`;
  return mapRow(row);
}

// FK purchase_order_receipt.po_item_id sengaja RESTRICT (143_purchase_order.sql:
// "PO/item yang sudah menerima barang tidak bisa dihapus, hanya bisa
// dibatalkan") — tapi belum ada yg menangkap error-nya sejak F13, jadi bocor
// jadi 500 mentah. Ditemukan & diperbaiki di sesi F35 (ketemu pas testing).
function isForeignKeyViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: string }).code === "23503";
}

export async function deletePurchaseOrder(id: string): Promise<{ deleted: number }> {
  const sql = db();
  try {
    const rows = await sql`DELETE FROM purchase_order WHERE id = ${id} RETURNING id`;
    return { deleted: rows.length };
  } catch (e) {
    if (isForeignKeyViolation(e)) {
      throw new PurchaseOrderError(409, "PO tidak bisa dihapus — sudah ada barang masuk tercatat. Batalkan PO, jangan dihapus.");
    }
    throw e;
  }
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
  try {
    const rows = await sql`DELETE FROM purchase_order_item WHERE id = ${itemId} AND purchase_order_id = ${purchaseOrderId} RETURNING id`;
    return { deleted: rows.length };
  } catch (e) {
    if (isForeignKeyViolation(e)) {
      throw new PurchaseOrderError(409, "Barang tidak bisa dihapus — sudah ada barang masuk tercatat utk barang ini.");
    }
    throw e;
  }
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
  // F35 — barang masuk diblokir sampai PO fully approved (legacy_exempt/lini
  // NULL = PO pra-F35, tidak kena gate ini).
  const [head] = await sql`SELECT lini FROM purchase_order WHERE id = ${purchaseOrderId}`;
  const lini = (head?.lini != null ? String(head.lini) : null) as PurchaseOrderLini | null;
  if (lini !== null) {
    const approvals = (await sql`SELECT ${approvalCols(sql)} FROM purchase_order_approval WHERE purchase_order_id = ${purchaseOrderId}`).map(mapApproval);
    if (computeApprovalStatus(lini, approvals) !== "approved") {
      throw new PurchaseOrderError(409, "PO belum fully approved — barang masuk belum bisa dicatat");
    }
  }
  const rows = await sql`
    INSERT INTO purchase_order_receipt (po_item_id, qty_received, received_date, received_by, condition_notes)
    VALUES (${itemId}, ${t.qty_received}, ${t.received_date ?? sql`CURRENT_DATE`}, ${t.received_by ?? null}, ${t.condition_notes ?? null})
    RETURNING ${receiptCols(sql)}
  `;
  return mapReceipt(rows[0]);
}

// F35 — putuskan approve/reject 1 baris approval (role). Sequencing Tier 2
// (direktur menunggu Tier 1 lengkap) & guard idempoten (WHERE status='pending'
// langsung di UPDATE, bukan SELECT-lalu-UPDATE spt leave.ts) dibungkus 1
// transaksi supaya check-then-act tidak race.
export async function decidePurchaseOrderApproval(
  purchaseOrderId: string,
  role: ApproverRole,
  decision: "approve" | "reject",
  decidedBy: string | null,
  note?: string | null,
): Promise<{ approvals: PurchaseOrderApprovalRow[]; approval_status: ApprovalStatus }> {
  const sql = db();
  return sql.begin(async (tx) => {
    const [head] = await tx`SELECT lini FROM purchase_order WHERE id = ${purchaseOrderId}`;
    if (!head) throw new PurchaseOrderError(404, "PO tidak ditemukan");
    const lini = (head.lini != null ? String(head.lini) : null) as PurchaseOrderLini | null;
    if (lini === null) throw new PurchaseOrderError(409, "PO ini dibuat sebelum F35, tidak memakai alur approval");

    // approvalCols() typed utk Sql<{}>, bukan TransactionSql<{}> (gotcha sama
    // dgn itemCols/receivingCols di sesi F36) — kolom ditulis literal di dalam tx.
    const rows = (await tx`
      SELECT id, purchase_order_id, approver_role, required_hod_key, status, decided_by, decided_at::text, note
      FROM purchase_order_approval WHERE purchase_order_id = ${purchaseOrderId}
    `).map(mapApproval);
    if (rows.some((r) => r.status === "rejected")) throw new PurchaseOrderError(409, "PO sudah ditolak");
    if (role === "direktur") {
      const tier1Done =
        rows.find((r) => r.approver_role === "hod_business")?.status === "approved" &&
        rows.find((r) => r.approver_role === "hod_finance")?.status === "approved";
      if (!tier1Done) throw new PurchaseOrderError(409, "menunggu approval Tier 1 (HOD Business & HOD Finance)");
    }

    const newStatus: ApprovalDecisionStatus = decision === "approve" ? "approved" : "rejected";
    const updated = await tx`
      UPDATE purchase_order_approval SET
        status = ${newStatus}, decided_by = ${decidedBy}, decided_at = now(), note = ${note ?? null}, updated_at = now()
      WHERE purchase_order_id = ${purchaseOrderId} AND approver_role = ${role} AND status = 'pending'
      RETURNING id
    `;
    if (!updated.length) throw new PurchaseOrderError(409, "baris approval ini sudah diputuskan");

    const finalRows = (await tx`
      SELECT id, purchase_order_id, approver_role, required_hod_key, status, decided_by, decided_at::text, note
      FROM purchase_order_approval WHERE purchase_order_id = ${purchaseOrderId} ORDER BY created_at ASC
    `).map(mapApproval);
    return { approvals: finalRows, approval_status: computeApprovalStatus(lini, finalRows) };
  });
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
