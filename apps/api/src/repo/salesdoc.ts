import { db } from "../db.js";

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
    WHERE d.stage IN ('SPH', 'Offering Letter', 'Presentation', 'MOU')
      AND NOT EXISTS (
        SELECT 1 FROM sales_doc sd
        WHERE sd.deal_id = d.deal_id
          AND sd.doc_type = CASE d.stage
            WHEN 'SPH' THEN 'sph'
            WHEN 'Offering Letter' THEN 'offering_letter'
            WHEN 'Presentation' THEN 'presentation'
            WHEN 'MOU' THEN 'mou'
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

export interface SalesDocRow {
  id: string;
  deal_id: string | null;
  customer_name: string | null;
  doc_type: string | null;
  title: string | null;
  status: string;
  model_used: string | null;
  created_at: string;
}

export async function listSalesDocs(status?: string, limit = 50): Promise<SalesDocRow[]> {
  const sql = db();
  const rows = await sql`
    SELECT id, deal_id, customer_name, doc_type, title, status, model_used, created_at::text
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
    status: String(r.status),
    model_used: r.model_used ? String(r.model_used) : null,
    created_at: String(r.created_at),
  }));
}
