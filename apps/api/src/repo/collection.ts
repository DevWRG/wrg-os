import { db } from "../db.js";

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
