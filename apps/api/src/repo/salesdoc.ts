import { createHash } from "node:crypto";

import { db } from "../db.js";
import { sendViaWaGateway, type WaSendResult } from "../wasend.js";
import { cekFinalSph, finalisasiSph, unconfirmedVariantItems, type PelakuSesi, type PilihanTtd } from "./sph.js";
import { PESAN_TUJUAN_DITOLAK, accountIdDariCustomer, nomorTujuan, tujuanDiizinkan } from "../lib/sales-doc-gate.js";

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
    -- Stage 'Offering' dilebur ke 'Quotation' (migrasi 069) → doc_type
    -- 'offering_letter' tak lagi punya pemicu otomatis (tetap valid utk draft manual).
    WHERE d.stage IN ('Quotation', 'Presentation', 'Closing-Won')
      AND NOT EXISTS (
        SELECT 1 FROM sales_doc sd
        WHERE sd.deal_id = d.deal_id
          AND sd.doc_type = CASE d.stage
            WHEN 'Quotation' THEN 'sph'
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
  forbidden?: boolean; // ditolak krn izin/identitas → route balas 403
}

// approverId = nama pelaku dari SESI (BFF menimpa body). `pelaku` wajib utk SPH:
// tahap 2 tak boleh dilakukan pembuat SPH-nya sendiri. `ttd` = pilihan penanda
// tangan SPH (kosong → approver sendiri), lihat finalisasiSph.
export async function approveSalesDoc(
  id: string,
  approverId?: string,
  pelaku?: PelakuSesi | null,
  ttd?: PilihanTtd | null,
): Promise<DocActionResult & { nomor?: string }> {
  const sql = db();
  const rows = await sql`SELECT id, status, doc_type, customer_id FROM sales_doc WHERE id = ${id}`;
  if (rows.length === 0) return { ok: false, error: "dokumen tidak ditemukan" };
  // F15: SPH wajib lewat review HOD Business dulu (hodReviewSph, repo/sph.ts)
  // sebelum finalisasi Admin Penawaran di sini — 2 tahap, 2 approver beda
  // (arahan Direktur 2026-08-12). Doc type lain (offering/presentation/mou)
  // tetap 1 tahap dari 'draft' spt semula.
  const requiredStatus = rows[0].doc_type === "sph" ? "hod_review" : "draft";
  if (rows[0].status !== requiredStatus) {
    return { ok: false, error: `dokumen sudah ${rows[0].status} (butuh status "${requiredStatus}")` };
  }
  // HANDOVER §6 — baris nama-kembar yg belum dikonfirmasi Admin Penawaran
  // menahan finalize (POST /sph/:id/confirm-variant dulu).
  if (rows[0].doc_type === "sph") {
    if (!pelaku) return { ok: false, error: "identitas pengguna (sesi) wajib utk finalisasi SPH", forbidden: true };
    const tolak = await cekFinalSph(id, pelaku);
    if (tolak) return { ok: false, error: tolak, forbidden: true };
    const pending = await unconfirmedVariantItems(id);
    if (pending.length > 0) {
      return {
        ok: false,
        // Sertakan id baris (bukan cuma nama) — 2 baris nama-kembar bisa punya
        // nama snapshot yang PERSIS sama, jadi nama saja tak cukup buat Admin
        // Penawaran tahu baris mana yg perlu di-confirm (ditemukan QA 2026-09-07).
        error: `${pending.length} item nama-varian-kembar belum dikonfirmasi: ${pending.map((p) => `#${p.id} ${p.nama}`).join(", ")}`,
      };
    }
    // Nomor surat + kunci syarat + penanda tangan + status, satu transaksi.
    const f = await finalisasiSph(id, pelaku, ttd);
    if (!f.ok) return { ok: false, error: f.error };
    await logHumanAction(
      "sales.doc.approve",
      pelaku.nama,
      { doc_id: id, doc_type: rows[0].doc_type, customer_id: rows[0].customer_id, nomor: f.nomor },
      "approve",
    );
    return { ok: true, status: "approved", nomor: f.nomor };
  }
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
  // Tujuan hanya kontak WA customer di Accounts (lib/sales-doc-gate.ts) —
  // tanpa ini endpoint ini bisa dipakai mengirim pesan ke nomor sembarang.
  const accountId = accountIdDariCustomer(rows[0].customer_id ? String(rows[0].customer_id) : null);
  const kontak = accountId
    ? (await sql`SELECT hp_wa FROM crm_contact WHERE account_id = ${accountId}::bigint AND hp_wa IS NOT NULL`).map((r) =>
        String(r.hp_wa),
      )
    : [];
  if (!tujuanDiizinkan(to, kontak)) return { ok: false, error: PESAN_TUJUAN_DITOLAK };
  const tujuan = nomorTujuan(to) as string; // lolos tujuanDiizinkan → pasti nomor sah
  const message = `${rows[0].title ? `${rows[0].title}\n\n` : ""}${String(rows[0].draft_text)}`;
  const gateway = await sendViaWaGateway(tujuan, message);
  if (!gateway.sent) {
    return { ok: false, error: `gateway WA gagal: ${gateway.error ?? gateway.status}`, gateway };
  }
  await sql`UPDATE sales_doc SET status = 'sent' WHERE id = ${id}`;
  await logHumanAction(
    "sales.doc.send",
    approverId,
    { doc_id: id, to: tujuan, doc_type: rows[0].doc_type, customer_id: rows[0].customer_id, gateway },
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
  hod_reviewed_by: string | null;
  nomor_dokumen: string | null; // F15 SPH — nomor surat (null = draft/belum bernomor)
  created_at: string;
}

export async function listSalesDocs(status?: string, limit = 50): Promise<SalesDocRow[]> {
  const sql = db();
  const rows = await sql`
    SELECT id, deal_id, customer_name, doc_type, title, draft_text, status, model_used,
           approved_by, hod_reviewed_by, nomor_dokumen, created_at::text
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
    hod_reviewed_by: r.hod_reviewed_by ? String(r.hod_reviewed_by) : null,
    nomor_dokumen: r.nomor_dokumen ? String(r.nomor_dokumen) : null,
    created_at: String(r.created_at),
  }));
}
