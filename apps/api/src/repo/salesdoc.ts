import { createHash } from "node:crypto";

import { db } from "../db.js";
import { sendViaWaGateway, type WaSendResult } from "../wasend.js";

// D1 — sales_doc. Sumber: deal yang berada di stage ber-dokumen. A6 (Sales Doc
// Drafter) menyusun dokumen via services/ai; status awal 'draft' (R2/L2 —
// direview manusia sebelum approved/sent, tidak auto-kirim).

// Stage → doc_type. Hanya stage ini yang memicu draft otomatis (batch).
export const DOC_TYPE_FOR_STAGE: Record<string, string> = {
  SPH: "sph",
  "Offering Letter": "offering_letter",
  Presentation: "presentation",
  MOU: "mou",
};
export const VALID_DOC_TYPES = new Set([
  "sph",
  "offering_letter",
  "presentation",
  "mou",
]);

export interface DealForDoc {
  deal_id: string;
  customer_id: string;
  customer_name: string | null;
  am_id: string;
  stage: string;
  estimated_value: number | null;
  product_ids: string[];
  notes: string | null;
}

function mapDeal(r: Record<string, unknown>): DealForDoc {
  return {
    deal_id: String(r.deal_id),
    customer_id: String(r.customer_id),
    customer_name: r.customer_name ? String(r.customer_name) : null,
    am_id: String(r.am_id),
    stage: String(r.stage),
    estimated_value: r.estimated_value === null ? null : Number(r.estimated_value),
    product_ids: Array.isArray(r.product_ids) ? (r.product_ids as string[]).map(String) : [],
    notes: r.notes ? String(r.notes) : null,
  };
}

// Batch: deal di stage ber-dokumen yang BELUM punya doc untuk doc_type sesuai
// stage-nya (idempoten antar-run).
export async function getDealsNeedingDoc(limit = 5): Promise<DealForDoc[]> {
  const sql = db();
  const rows = await sql`
    SELECT d.deal_id, d.customer_id, d.customer_name, d.am_id, d.stage,
           d.estimated_value, d.product_ids, d.notes
    FROM deal d
    WHERE d.stage IN ('Quotation', 'Offering', 'Presentation', 'Closing-Won')
      AND NOT EXISTS (
        SELECT 1 FROM sales_doc sd
        WHERE sd.deal_id = d.deal_id
          AND sd.doc_type = CASE d.stage
            WHEN 'Quotation' THEN 'sph'
            WHEN 'Offering' THEN 'offering_letter'
            WHEN 'Presentation' THEN 'presentation'
            WHEN 'Closing-Won' THEN 'mou'
          END
      )
    ORDER BY d.updated_at DESC
    LIMIT ${limit}
  `;
  return rows.map(mapDeal);
}

export async function getDealById(dealId: string): Promise<DealForDoc | null> {
  const sql = db();
  const rows = await sql`
    SELECT deal_id, customer_id, customer_name, am_id, stage, estimated_value, product_ids, notes
    FROM deal WHERE deal_id = ${dealId}
  `;
  return rows.length ? mapDeal(rows[0]) : null;
}

export async function insertSalesDoc(opts: {
  deal_id: string;
  customer_id: string;
  customer_name: string | null;
  doc_type: string;
  title: string;
  draft_text: string;
  model_used?: string | null;
}): Promise<string> {
  const sql = db();
  const rows = await sql`
    INSERT INTO sales_doc
      (deal_id, customer_id, customer_name, doc_type, title, draft_text, status, generated_by, model_used)
    VALUES
      (${opts.deal_id}, ${opts.customer_id}, ${opts.customer_name ?? null},
       ${opts.doc_type}, ${opts.title}, ${opts.draft_text}, 'draft', 'A6', ${opts.model_used ?? null})
    RETURNING id
  `;
  return rows[0].id as string;
}

// ── Siklus kirim A6: draft → (approve) → approved → (send) → sent ──
// Tiap aksi manusia dicatat sebagai event audit_log Layer 5 (Human), terkait
// agen A6 — menutup loop tata kelola agen→manusia (pola sama dengan A3).

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
      ('D1', ${`a6-act-${hash.slice(0, 8)}`}, 'A6', 5, ${eventType}, 'R2', ${hash}, ${hash},
       ${sql.json(payload as unknown as Parameters<typeof sql.json>[0])}, ${actor ?? null}, ${decision})
  `;
}

export interface DocActionResult {
  ok: boolean;
  error?: string;
  status?: string;
  gateway?: WaSendResult;
}

export async function approveSalesDoc(id: string, approverId?: string): Promise<DocActionResult> {
  const sql = db();
  const rows = await sql`SELECT id, status, doc_type, customer_id FROM sales_doc WHERE id = ${id}`;
  if (rows.length === 0) return { ok: false, error: "dokumen tidak ditemukan" };
  if (rows[0].status !== "draft") return { ok: false, error: `dokumen sudah ${rows[0].status}` };
  await sql`UPDATE sales_doc SET status = 'approved', approved_by = ${approverId ?? null} WHERE id = ${id}`;
  await logHumanAction(
    "sales.doc.approve",
    approverId,
    { doc_id: id, doc_type: rows[0].doc_type, customer_id: rows[0].customer_id },
    "approve",
  );
  return { ok: true, status: "approved" };
}

export async function sendSalesDoc(
  id: string,
  to: string,
  approverId?: string,
): Promise<DocActionResult> {
  const sql = db();
  if (!to) return { ok: false, error: "tujuan (to) wajib" };
  const rows = await sql`SELECT id, status, title, draft_text, doc_type, customer_id FROM sales_doc WHERE id = ${id}`;
  if (rows.length === 0) return { ok: false, error: "dokumen tidak ditemukan" };
  if (rows[0].status !== "approved") {
    return { ok: false, error: `harus di-approve dulu (status sekarang: ${rows[0].status})` };
  }
  const message = `${rows[0].title ? `${rows[0].title}\n\n` : ""}${String(rows[0].draft_text)}`;
  const gateway = await sendViaWaGateway(to, message);
  if (!gateway.sent) {
    return { ok: false, error: `gateway WA gagal: ${gateway.error ?? gateway.status}`, gateway };
  }
  await sql`UPDATE sales_doc SET status = 'sent' WHERE id = ${id}`;
  await logHumanAction(
    "sales.doc.send",
    approverId,
    { doc_id: id, to, doc_type: rows[0].doc_type, customer_id: rows[0].customer_id, gateway },
    "send",
  );
  return { ok: true, status: "sent", gateway };
}

export async function cancelSalesDoc(id: string, approverId?: string): Promise<DocActionResult> {
  const sql = db();
  const rows = await sql`SELECT id, status, doc_type, customer_id FROM sales_doc WHERE id = ${id}`;
  if (rows.length === 0) return { ok: false, error: "dokumen tidak ditemukan" };
  if (rows[0].status === "sent") return { ok: false, error: "dokumen sudah terkirim, tak bisa dibatalkan" };
  if (rows[0].status === "canceled") return { ok: false, error: "dokumen sudah dibatalkan" };
  await sql`UPDATE sales_doc SET status = 'canceled', approved_by = ${approverId ?? null} WHERE id = ${id}`;
  await logHumanAction(
    "sales.doc.cancel",
    approverId,
    { doc_id: id, doc_type: rows[0].doc_type, customer_id: rows[0].customer_id },
    "reject",
  );
  return { ok: true, status: "canceled" };
}

export interface SalesDocRow {
  id: string;
  deal_id: string | null;
  customer_name: string | null;
  doc_type: string | null;
  title: string | null;
  draft_text: string;
  status: string;
  model_used: string | null;
  approved_by: string | null;
  created_at: string;
}

export async function listSalesDocs(status?: string, limit = 50): Promise<SalesDocRow[]> {
  const sql = db();
  const rows = await sql`
    SELECT id, deal_id, customer_name, doc_type, title, draft_text, status, model_used, approved_by, created_at::text
    FROM sales_doc
    WHERE ${status ? sql`status = ${status}` : sql`true`}
    ORDER BY created_at DESC
    LIMIT ${limit}
  `;
  return rows.map((r) => ({
    id: String(r.id),
    deal_id: r.deal_id ? String(r.deal_id) : null,
    customer_name: r.customer_name ? String(r.customer_name) : null,
    doc_type: r.doc_type ? String(r.doc_type) : null,
    title: r.title ? String(r.title) : null,
    draft_text: String(r.draft_text ?? ""),
    status: String(r.status),
    model_used: r.model_used ? String(r.model_used) : null,
    approved_by: r.approved_by ? String(r.approved_by) : null,
    created_at: String(r.created_at),
  }));
}
