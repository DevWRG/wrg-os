import { createHash } from "node:crypto";

import { db } from "../db.js";
import { sendViaWaGateway, type WaSendResult } from "../wasend.js";

// D2 — collection_draft. Sumber: invoice overdue di ar_aging_mv. A3 (Sari
// Collection Drafter) menyusun draft per invoice; status awal 'draft' (R2/L2 —
// wajib direview manusia sebelum approved/sent, tidak auto-kirim).

export interface OverdueItem {
  customer_id: string;
  customer_name: string | null;
  invoice_no: string;
  amount: number;
  days_overdue: number;
  bucket: string;
}

// Invoice overdue yang BELUM punya draft (hindari duplikat antar-run).
export async function getOverdueForDrafting(limit = 10): Promise<OverdueItem[]> {
  const sql = db();
  const rows = await sql`
    SELECT a.customer_id, a.customer_name, a.invoice_no, a.amount, a.days_overdue, a.bucket
    FROM ar_aging_mv a
    WHERE a.days_overdue > 0
      AND NOT EXISTS (
        SELECT 1 FROM collection_draft d
        WHERE d.invoice_no = a.invoice_no AND d.customer_id = a.customer_id
      )
    ORDER BY a.days_overdue DESC, a.amount DESC
    LIMIT ${limit}
  `;
  return rows.map((r) => ({
    customer_id: String(r.customer_id),
    customer_name: r.customer_name ? String(r.customer_name) : null,
    invoice_no: String(r.invoice_no),
    amount: Number(r.amount),
    days_overdue: Number(r.days_overdue),
    bucket: String(r.bucket),
  }));
}

export async function insertCollectionDraft(opts: {
  customer_id: string;
  invoice_no: string;
  draft_text: string;
  draft_type: string;
}): Promise<string> {
  const sql = db();
  const rows = await sql`
    INSERT INTO collection_draft
      (customer_id, invoice_no, draft_text, draft_type, status, generated_by)
    VALUES
      (${opts.customer_id}, ${opts.invoice_no}, ${opts.draft_text},
       ${opts.draft_type}, 'draft', 'A3')
    RETURNING id
  `;
  return rows[0].id as string;
}

export interface CollectionDraftRow {
  id: string;
  customer_id: string;
  invoice_no: string | null;
  draft_text: string;
  draft_type: string | null;
  status: string;
  generated_by: string | null;
  approved_by: string | null;
  created_at: string;
}

// ── Siklus kirim A3: draft → (approve) → approved → (send) → sent ──
// Tiap aksi manusia dicatat sebagai event audit_log Layer 5 (Human), terkait
// agen A3 — menutup loop tata kelola agen→manusia.

async function logHumanAction(
  eventType: string,
  actor: string | undefined,
  payload: Record<string, unknown>,
  decision: string,
): Promise<void> {
  const sql = db();
  const hash = createHash("sha256").update(JSON.stringify({ eventType, payload })).digest("hex");
  await sql`
    INSERT INTO audit_log
      (use_case_id, correlation_id, agent_id, layer, event_type, r_tier, input_hash, output_hash, payload, human_actor, decision)
    VALUES
      ('D2', ${`a3-act-${hash.slice(0, 8)}`}, 'A3', 5, ${eventType}, 'R2', ${hash}, ${hash},
       ${sql.json(payload as unknown as Parameters<typeof sql.json>[0])}, ${actor ?? null}, ${decision})
  `;
}

export interface DraftActionResult {
  ok: boolean;
  error?: string;
  status?: string;
  gateway?: WaSendResult;
}

export async function approveCollectionDraft(
  id: string,
  approverId?: string,
): Promise<DraftActionResult> {
  const sql = db();
  const rows = await sql`SELECT id, status, customer_id, invoice_no FROM collection_draft WHERE id = ${id}`;
  if (rows.length === 0) return { ok: false, error: "draft tidak ditemukan" };
  if (rows[0].status !== "draft") return { ok: false, error: `draft sudah ${rows[0].status}` };
  await sql`UPDATE collection_draft SET status = 'approved', approved_by = ${approverId ?? null} WHERE id = ${id}`;
  await logHumanAction(
    "collection.draft.approve",
    approverId,
    { draft_id: id, customer_id: rows[0].customer_id, invoice_no: rows[0].invoice_no },
    "approve",
  );
  return { ok: true, status: "approved" };
}

export async function sendCollectionDraft(
  id: string,
  to: string,
  approverId?: string,
): Promise<DraftActionResult> {
  const sql = db();
  if (!to) return { ok: false, error: "tujuan (to) wajib" };
  const rows = await sql`SELECT id, status, draft_text, customer_id, invoice_no FROM collection_draft WHERE id = ${id}`;
  if (rows.length === 0) return { ok: false, error: "draft tidak ditemukan" };
  if (rows[0].status !== "approved") {
    return { ok: false, error: `harus di-approve dulu (status sekarang: ${rows[0].status})` };
  }
  const gateway = await sendViaWaGateway(to, String(rows[0].draft_text));
  if (!gateway.sent) {
    return { ok: false, error: `gateway WA gagal: ${gateway.error ?? gateway.status}`, gateway };
  }
  await sql`UPDATE collection_draft SET status = 'sent' WHERE id = ${id}`;
  await logHumanAction(
    "collection.draft.send",
    approverId,
    { draft_id: id, to, customer_id: rows[0].customer_id, invoice_no: rows[0].invoice_no, gateway },
    "send",
  );
  return { ok: true, status: "sent", gateway };
}

export async function cancelCollectionDraft(
  id: string,
  approverId?: string,
): Promise<DraftActionResult> {
  const sql = db();
  const rows = await sql`SELECT id, status, customer_id, invoice_no FROM collection_draft WHERE id = ${id}`;
  if (rows.length === 0) return { ok: false, error: "draft tidak ditemukan" };
  if (rows[0].status === "sent") return { ok: false, error: "draft sudah terkirim, tak bisa dibatalkan" };
  if (rows[0].status === "canceled") return { ok: false, error: "draft sudah dibatalkan" };
  await sql`UPDATE collection_draft SET status = 'canceled', approved_by = ${approverId ?? null} WHERE id = ${id}`;
  await logHumanAction(
    "collection.draft.cancel",
    approverId,
    { draft_id: id, customer_id: rows[0].customer_id, invoice_no: rows[0].invoice_no },
    "reject",
  );
  return { ok: true, status: "canceled" };
}

export async function listCollectionDrafts(
  status?: string,
  limit = 50,
): Promise<CollectionDraftRow[]> {
  const sql = db();
  const rows = await sql`
    SELECT id, customer_id, invoice_no, draft_text, draft_type, status,
           generated_by, approved_by, created_at::text
    FROM collection_draft
    WHERE ${status ? sql`status = ${status}` : sql`true`}
    ORDER BY created_at DESC
    LIMIT ${limit}
  `;
  return rows.map((r) => ({
    id: String(r.id),
    customer_id: String(r.customer_id),
    invoice_no: r.invoice_no ? String(r.invoice_no) : null,
    draft_text: String(r.draft_text ?? ""),
    draft_type: r.draft_type ? String(r.draft_type) : null,
    status: String(r.status),
    generated_by: r.generated_by ? String(r.generated_by) : null,
    approved_by: r.approved_by ? String(r.approved_by) : null,
    created_at: String(r.created_at),
  }));
}
