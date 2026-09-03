// F19 — Forecast Submission Engine (SALES forecast; QC diabaikan dulu per
// arahan Direktur). Sistem scan gudang (F37 item_stock_branch, F38
// item_stock_batch) → usulan otomatis (draft) → Supply Chain edit/sortir →
// "ajukan" masuk approval berjenjang F11 (repo/approval.ts).
//
// TIDAK ADA hashtag WA di sini — beda dari blueprint lama, alur hasil
// meeting 100% sistem→Supply Chain→approval (lihat komentar migrasi 107).

import { db, isDbEnabled } from "../db.js";
import { createApprovalRequest } from "./approval.js";

// Ambang ED "dekat kedaluwarsa" — dipakai sbg SATU pemicu sederhana (bukan
// 3-tier 90/60/30/0 spt F38 ed-watch, itu utk ALERT berulang; di sini cukup
// "apakah perlu diusulkan sama sekali", jadi 1 ambang saja).
const ED_NEAR_DAYS = 90;

export interface BufferConfigRow {
  itemId: number;
  itemName: string;
  warehouseKode: string;
  warehouseNama: string;
  bufferQty: number;
  currentQty: number;
  updatedBy: string | null;
  updatedAt: string;
}

export async function listBufferConfig(): Promise<BufferConfigRow[]> {
  const sql = db();
  const rows = await sql`
    SELECT b.item_id, ai.name AS item_name, b.warehouse_kode, w.nama AS warehouse_nama,
           b.buffer_qty, COALESCE(isb.quantity, 0) AS current_qty, b.updated_by, b.updated_at::text
    FROM item_stock_buffer b
    JOIN accurate_item ai ON ai.id = b.item_id
    JOIN warehouse w ON w.kode = b.warehouse_kode
    LEFT JOIN item_stock_branch isb ON isb.item_id = b.item_id AND isb.warehouse_kode = b.warehouse_kode
    ORDER BY ai.name, w.urutan
  `;
  return rows.map((r) => ({
    itemId: Number(r.item_id),
    itemName: String(r.item_name),
    warehouseKode: String(r.warehouse_kode),
    warehouseNama: String(r.warehouse_nama),
    bufferQty: Number(r.buffer_qty),
    currentQty: Number(r.current_qty),
    updatedBy: r.updated_by ? String(r.updated_by) : null,
    updatedAt: String(r.updated_at),
  }));
}

export interface UpsertBufferInput {
  itemId: number;
  warehouseKode: string;
  bufferQty: number;
  updatedBy?: string | null;
}

export async function upsertBufferConfig(input: UpsertBufferInput): Promise<{ ok: boolean; error?: string }> {
  if (!(input.bufferQty >= 0)) return { ok: false, error: "buffer_qty harus >= 0" };
  const sql = db();
  const item = await sql`SELECT id, name FROM accurate_item WHERE id = ${input.itemId}`;
  if (item.length === 0) return { ok: false, error: `item #${input.itemId} tidak ditemukan` };
  const wh = await sql`SELECT kode FROM warehouse WHERE kode = ${input.warehouseKode} AND jenis = 'cabang'`;
  if (wh.length === 0) return { ok: false, error: `gudang "${input.warehouseKode}" tidak ditemukan (atau bukan gudang cabang)` };
  await sql`
    INSERT INTO item_stock_buffer (item_id, warehouse_kode, buffer_qty, updated_by)
    VALUES (${input.itemId}, ${input.warehouseKode}, ${input.bufferQty}, ${input.updatedBy ?? null})
    ON CONFLICT (item_id, warehouse_kode) DO UPDATE SET
      buffer_qty = EXCLUDED.buffer_qty, updated_by = EXCLUDED.updated_by, updated_at = now()
  `;
  return { ok: true };
}

// Item+gudang yg PUNYA buffer terkonfigurasi TAPI qty saat ini <= buffer.
async function findBufferBreaches(): Promise<{ itemId: number; warehouseKode: string; currentQty: number; bufferQty: number }[]> {
  const sql = db();
  const rows = await sql`
    SELECT b.item_id, b.warehouse_kode, COALESCE(isb.quantity, 0) AS current_qty, b.buffer_qty
    FROM item_stock_buffer b
    LEFT JOIN item_stock_branch isb ON isb.item_id = b.item_id AND isb.warehouse_kode = b.warehouse_kode
    WHERE COALESCE(isb.quantity, 0) <= b.buffer_qty
  `;
  return rows.map((r) => ({
    itemId: Number(r.item_id),
    warehouseKode: String(r.warehouse_kode),
    currentQty: Number(r.current_qty),
    bufferQty: Number(r.buffer_qty),
  }));
}

// Item+gudang dgn batch ber-ED dalam ED_NEAR_DAYS ke depan (ed_date IS NOT
// NULL wajib — batch non-kedaluwarsa tak pernah masuk sini, lihat komentar
// item_stock_batch.ed_date di migrasi F38).
async function findEdNear(): Promise<{ itemId: number; warehouseKode: string; nearestEd: string }[]> {
  const sql = db();
  const rows = await sql`
    SELECT item_id, warehouse_kode, min(ed_date)::text AS nearest_ed
    FROM item_stock_batch
    WHERE ed_date IS NOT NULL AND ed_date <= (current_date + ${ED_NEAR_DAYS}::int) AND quantity > 0
    GROUP BY item_id, warehouse_kode
  `;
  return rows.map((r) => ({ itemId: Number(r.item_id), warehouseKode: String(r.warehouse_kode), nearestEd: String(r.nearest_ed) }));
}

// Rata-rata qty terjual/bulan, 6 bulan terakhir — dari mirror Accurate.
// Peta 1 angka global per item (BUKAN per-gudang, krn accurate_invoice_item
// tak punya kolom gudang) — dipakai sbg estimasi kasar semua gudang.
async function avgMonthlyQty6m(itemId: number): Promise<number> {
  const sql = db();
  const rows = await sql`
    SELECT AVG(monthly.qty) AS avg_qty FROM (
      SELECT date_trunc('month', i.tanggal) AS bulan, SUM(ii.qty) AS qty
      FROM accurate_invoice_item ii
      JOIN accurate_invoice i ON i.id = ii.invoice_id
      WHERE ii.item_id = ${itemId} AND i.tanggal >= (current_date - interval '6 months')
      GROUP BY bulan
    ) monthly
  `;
  return rows[0]?.avg_qty != null ? Number(rows[0].avg_qty) : 0;
}

// KONTEKS saja (lihat komentar migrasi 107) — jumlah deal HOT aktif,
// GLOBAL, TIDAK dicocokkan ke item manapun (deal.product_ids teks bebas,
// gak ada katalog produk baku — apps/api/src/repo/product.ts).
async function pipelineHotCount(): Promise<number> {
  const sql = db();
  const [{ count }] = await sql`SELECT count(*)::int AS count FROM deal WHERE stage IN ('Closing', 'Closing-Won')`;
  return Number(count);
}

export interface GenerateResult {
  created: number;
  skippedExisting: number;
}

// Scan buffer+ED → upsert baris 'draft' baru (skip kalau sudah ada draft
// aktif utk kombinasi item+gudang yg sama — anti-spam, lihat index parsial
// di migrasi 107). Dipanggil manual (tombol "Generate Usulan") — BUKAN cron
// otomatis di versi ini (base engine dulu, lihat catatan F19 di memory).
export async function generateSuggestions(): Promise<GenerateResult> {
  if (!isDbEnabled()) return { created: 0, skippedExisting: 0 };
  const sql = db();
  const hotCount = await pipelineHotCount();

  const breaches = await findBufferBreaches();
  const edNear = await findEdNear();

  // Gabung per (item,gudang) — 1 baris bisa kena 2 alasan sekaligus.
  const combined = new Map<
    string,
    { itemId: number; warehouseKode: string; currentQty?: number; bufferQty?: number; nearestEd?: string; reasons: string[] }
  >();
  for (const b of breaches) {
    combined.set(`${b.itemId}:${b.warehouseKode}`, {
      itemId: b.itemId, warehouseKode: b.warehouseKode, currentQty: b.currentQty, bufferQty: b.bufferQty, reasons: ["near_buffer"],
    });
  }
  for (const e of edNear) {
    const key = `${e.itemId}:${e.warehouseKode}`;
    const existing = combined.get(key);
    if (existing) {
      existing.nearestEd = e.nearestEd;
      existing.reasons.push("near_ed");
    } else {
      combined.set(key, { itemId: e.itemId, warehouseKode: e.warehouseKode, nearestEd: e.nearestEd, reasons: ["near_ed"] });
    }
  }

  let created = 0;
  let skippedExisting = 0;
  for (const c of combined.values()) {
    const existingDraft = await sql`
      SELECT id FROM forecast_suggestion WHERE item_id = ${c.itemId} AND warehouse_kode = ${c.warehouseKode} AND status = 'draft'
    `;
    if (existingDraft.length > 0) {
      skippedExisting++;
      continue;
    }
    const currentQty =
      c.currentQty ??
      Number((await sql`SELECT COALESCE(quantity,0) AS q FROM item_stock_branch WHERE item_id=${c.itemId} AND warehouse_kode=${c.warehouseKode}`)[0]?.q ?? 0);
    const avgQty = await avgMonthlyQty6m(c.itemId);
    // Heuristik AWAL sederhana (Supply Chain WAJIB review, bukan angka final):
    // kalau ada gap ke buffer, tutup gap itu + 1 bulan estimasi pemakaian;
    // kalau cuma dipicu ED (barang mau kedaluwarsa, bukan kurang stok),
    // usulan cuma estimasi 1 bulan pemakaian (rotasi stok, bukan nambah).
    const gapToBuffer = c.bufferQty != null ? Math.max(0, c.bufferQty - currentQty) : 0;
    const suggestedQty = Math.round(gapToBuffer + avgQty);

    await sql`
      INSERT INTO forecast_suggestion
        (item_id, warehouse_kode, reasons, current_qty, buffer_qty, nearest_ed_date, avg_monthly_qty_6m, pipeline_hot_count, suggested_qty)
      VALUES
        (${c.itemId}, ${c.warehouseKode}, ${sql.json(c.reasons as unknown as Parameters<typeof sql.json>[0])}, ${currentQty},
         ${c.bufferQty ?? null}, ${c.nearestEd ?? null}, ${avgQty}, ${hotCount}, ${suggestedQty})
    `;
    created++;
  }
  return { created, skippedExisting };
}

export interface ForecastSuggestionRow {
  id: string;
  itemId: number;
  itemName: string;
  warehouseKode: string;
  warehouseNama: string;
  reasons: string[];
  currentQty: number;
  bufferQty: number | null;
  nearestEdDate: string | null;
  avgMonthlyQty6m: number | null;
  pipelineHotCount: number;
  suggestedQty: number;
  finalQty: number | null;
  notes: string | null;
  status: string;
  approvalRequestId: string | null;
  createdAt: string;
}

export async function listSuggestions(status?: string): Promise<ForecastSuggestionRow[]> {
  const sql = db();
  const rows = await sql`
    SELECT fs.*, ai.name AS item_name, w.nama AS warehouse_nama
    FROM forecast_suggestion fs
    JOIN accurate_item ai ON ai.id = fs.item_id
    JOIN warehouse w ON w.kode = fs.warehouse_kode
    WHERE ${status ? sql`fs.status = ${status}` : sql`true`}
    ORDER BY fs.created_at DESC LIMIT 200
  `;
  return rows.map((r) => ({
    id: String(r.id),
    itemId: Number(r.item_id),
    itemName: String(r.item_name),
    warehouseKode: String(r.warehouse_kode),
    warehouseNama: String(r.warehouse_nama),
    reasons: Array.isArray(r.reasons) ? (r.reasons as string[]) : [],
    currentQty: Number(r.current_qty),
    bufferQty: r.buffer_qty != null ? Number(r.buffer_qty) : null,
    nearestEdDate: r.nearest_ed_date ? String(r.nearest_ed_date) : null,
    avgMonthlyQty6m: r.avg_monthly_qty_6m != null ? Number(r.avg_monthly_qty_6m) : null,
    pipelineHotCount: Number(r.pipeline_hot_count),
    suggestedQty: Number(r.suggested_qty),
    finalQty: r.final_qty != null ? Number(r.final_qty) : null,
    notes: r.notes ? String(r.notes) : null,
    status: String(r.status),
    approvalRequestId: r.approval_request_id ? String(r.approval_request_id) : null,
    createdAt: String(r.created_at),
  }));
}

export async function updateSuggestion(
  id: string,
  patch: { finalQty?: number | null; notes?: string | null },
): Promise<{ ok: boolean; error?: string }> {
  const sql = db();
  if (patch.finalQty != null && (!Number.isFinite(patch.finalQty) || patch.finalQty < 0)) {
    return { ok: false, error: "finalQty tidak boleh negatif" };
  }
  const rows = await sql`SELECT status FROM forecast_suggestion WHERE id = ${id}`;
  if (rows.length === 0) return { ok: false, error: "usulan tidak ditemukan" };
  if (rows[0].status !== "draft") return { ok: false, error: `usulan sudah ${rows[0].status}, tak bisa diedit` };
  await sql`
    UPDATE forecast_suggestion SET
      final_qty = ${patch.finalQty === undefined ? sql`final_qty` : patch.finalQty},
      notes = ${patch.notes === undefined ? sql`notes` : patch.notes}
    WHERE id = ${id}
  `;
  return { ok: true };
}

export async function dismissSuggestion(id: string, reviewedBy?: string): Promise<{ ok: boolean; error?: string }> {
  const sql = db();
  const rows = await sql`SELECT status FROM forecast_suggestion WHERE id = ${id}`;
  if (rows.length === 0) return { ok: false, error: "usulan tidak ditemukan" };
  if (rows[0].status !== "draft") return { ok: false, error: `usulan sudah ${rows[0].status}` };
  await sql`UPDATE forecast_suggestion SET status = 'dismissed', reviewed_by = ${reviewedBy ?? null}, reviewed_at = now() WHERE id = ${id}`;
  return { ok: true };
}

export interface SubmitResult {
  ok: boolean;
  error?: string;
  approvalId?: string;
  approvalKode?: string;
}

// "Ajukan" — Supply Chain kirim usulan yg sudah di-review ke approval
// berjenjang F11. Reuse createApprovalRequest() APA ADANYA, tak ada logika
// approval yg diduplikasi di sini.
export async function submitSuggestion(id: string, submittedBy: string): Promise<SubmitResult> {
  const sql = db();
  const rows = await sql`
    SELECT fs.*, ai.name AS item_name, w.nama AS warehouse_nama
    FROM forecast_suggestion fs
    JOIN accurate_item ai ON ai.id = fs.item_id
    JOIN warehouse w ON w.kode = fs.warehouse_kode
    WHERE fs.id = ${id}
  `;
  if (rows.length === 0) return { ok: false, error: "usulan tidak ditemukan" };
  const r = rows[0];
  if (r.status !== "draft") return { ok: false, error: `usulan sudah ${r.status}` };

  const qty = r.final_qty != null ? Number(r.final_qty) : Number(r.suggested_qty);
  if (!(qty > 0)) return { ok: false, error: "qty final harus > 0 sebelum diajukan (isi final_qty dulu kalau usulan sistem 0)" };

  const reasons = (Array.isArray(r.reasons) ? (r.reasons as string[]) : [])
    .map((x) => (x === "near_buffer" ? "mendekati/di bawah buffer" : x === "near_ed" ? "ada batch mendekati ED" : x))
    .join(", ");
  const description =
    `Item: ${r.item_name}\nGudang: ${r.warehouse_nama}\nQty diusulkan: ${qty}\n` +
    `Stok saat ini: ${r.current_qty}${r.buffer_qty != null ? ` (buffer: ${r.buffer_qty})` : ""}\n` +
    `${r.nearest_ed_date ? `Batch ED terdekat: ${r.nearest_ed_date}\n` : ""}` +
    `Rata-rata terjual/bulan (6bln): ${r.avg_monthly_qty_6m ?? "-"}\n` +
    `Alasan sistem: ${reasons || "-"}\n` +
    `Deal HOT aktif (konteks, bukan pemicu langsung): ${r.pipeline_hot_count}\n` +
    `${r.notes ? `Catatan Supply Chain: ${r.notes}\n` : ""}`;

  const res = await createApprovalRequest({
    title: `Forecast: ${r.item_name} — ${r.warehouse_nama}`,
    description,
    requestedBy: submittedBy,
  });
  if (!res.ok || !res.id) return { ok: false, error: res.error ?? "gagal membuat approval request" };

  await sql`
    UPDATE forecast_suggestion SET status = 'submitted', approval_request_id = ${res.id}, reviewed_by = ${submittedBy}, reviewed_at = now()
    WHERE id = ${id}
  `;
  return { ok: true, approvalId: res.id, approvalKode: res.kode };
}
