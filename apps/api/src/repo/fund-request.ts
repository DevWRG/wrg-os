import { db } from "../db.js";

// F138 Operational Fund Request + Multi-Step Approval Workflow (General
// Affairs). Modul standalone — TIDAK terhubung ke dana_ops (F51) dengan cara
// apa pun (lihat 078_fund_request.sql). Semua Karyawan boleh mengajukan;
// approval 2 tahap FIXED: HOD (dipilih manual oleh pengaju saat submit) lalu
// Direktur (final). approval_status DIHITUNG dari baris fund_request_approval
// (pola computed sama dgn purchase_order_approval F35), bukan kolom
// tersimpan. date/timestamptz eksplisit ::text di SELECT/RETURNING (gotcha
// postgres.js yang sama di semua repo lain).

export class FundRequestError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "FundRequestError";
  }
}

export type ApproverRole = "hod" | "direktur";
export type ApprovalDecisionStatus = "pending" | "approved" | "rejected";
export type FundRequestStatus = "pending_hod" | "pending_direktur" | "approved" | "rejected";

export interface FundRequestApprovalRow {
  id: string;
  fund_request_id: string;
  approver_role: ApproverRole;
  required_hod_key: string | null;
  status: ApprovalDecisionStatus;
  decided_by: string | null;
  decided_at: string | null;
  note: string | null;
}

function mapApproval(r: Record<string, unknown>): FundRequestApprovalRow {
  return {
    id: String(r.id),
    fund_request_id: String(r.fund_request_id),
    approver_role: r.approver_role as ApproverRole,
    required_hod_key: r.required_hod_key != null ? String(r.required_hod_key) : null,
    status: r.status as ApprovalDecisionStatus,
    decided_by: r.decided_by != null ? String(r.decided_by) : null,
    decided_at: r.decided_at != null ? String(r.decided_at) : null,
    note: r.note != null ? String(r.note) : null,
  };
}

function approvalCols(sql: ReturnType<typeof db>) {
  return sql`id, fund_request_id, approver_role, required_hod_key, status, decided_by, decided_at::text, note`;
}

// Satu-satunya tempat state-machine approval diputuskan (dipakai list —dari
// flag agregat SQL— maupun detail/decide —dari baris penuh—) supaya
// logikanya tidak dobel.
function deriveStatus(hodStatus: ApprovalDecisionStatus | undefined, direkturStatus: ApprovalDecisionStatus | undefined): FundRequestStatus {
  if (hodStatus === "rejected" || direkturStatus === "rejected") return "rejected";
  if (direkturStatus === "approved") return "approved";
  if (hodStatus === "approved") return "pending_direktur";
  return "pending_hod";
}

export function computeFundRequestStatus(rows: FundRequestApprovalRow[]): FundRequestStatus {
  const byRole = (role: ApproverRole) => rows.find((r) => r.approver_role === role)?.status;
  return deriveStatus(byRole("hod"), byRole("direktur"));
}

export interface FundRequestRow {
  id: string;
  requester_name: string;
  requester_email: string;
  purpose: string;
  amount_requested: number;
  cabang: string | null;
  request_date: string;
  hod_approver_key: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
  approval_status: FundRequestStatus;
}

function mapRow(r: Record<string, unknown>): FundRequestRow {
  return {
    id: String(r.id),
    requester_name: String(r.requester_name),
    requester_email: String(r.requester_email),
    purpose: String(r.purpose),
    amount_requested: Number(r.amount_requested),
    cabang: r.cabang != null ? String(r.cabang) : null,
    request_date: String(r.request_date),
    hod_approver_key: String(r.hod_approver_key),
    notes: r.notes != null ? String(r.notes) : null,
    created_at: String(r.created_at),
    updated_at: String(r.updated_at),
    approval_status: deriveStatus(
      r.approval_hod_status as ApprovalDecisionStatus | undefined,
      r.approval_direktur_status as ApprovalDecisionStatus | undefined,
    ),
  };
}

function frCols(sql: ReturnType<typeof db>) {
  return sql`
    fr.id, fr.requester_name, fr.requester_email, fr.purpose, fr.amount_requested,
    fr.cabang, fr.request_date::text, fr.hod_approver_key, fr.notes,
    fr.created_at::text, fr.updated_at::text,
    appr.hod_status AS approval_hod_status,
    appr.direktur_status AS approval_direktur_status
  `;
}

const FR_APPROVAL_AGG_JOIN = (sql: ReturnType<typeof db>) => sql`
  LEFT JOIN (
    SELECT fund_request_id,
      MAX(status) FILTER (WHERE approver_role = 'hod') AS hod_status,
      MAX(status) FILTER (WHERE approver_role = 'direktur') AS direktur_status
    FROM fund_request_approval
    GROUP BY fund_request_id
  ) appr ON appr.fund_request_id = fr.id
`;

export interface FundRequestInput {
  requester_name: string;
  requester_email: string;
  purpose: string;
  amount_requested: number;
  cabang?: string | null;
  request_date?: string;
  hod_approver_key: string;
  notes?: string | null;
}

export interface FundRequestDetail extends FundRequestRow {
  approvals: FundRequestApprovalRow[];
}

export async function createFundRequest(t: FundRequestInput): Promise<FundRequestDetail> {
  if (!(t.amount_requested > 0)) throw new FundRequestError(400, "amount_requested harus > 0");
  if (!t.purpose.trim()) throw new FundRequestError(400, "purpose wajib diisi");
  if (!t.hod_approver_key.trim()) throw new FundRequestError(400, "hod_approver_key wajib diisi");
  const sql = db();
  const hod = await sql`SELECT 1 FROM app_user WHERE hod_key = ${t.hod_approver_key} AND active`;
  if (!hod.length) throw new FundRequestError(400, "HOD terpilih tidak ditemukan / tidak aktif");

  const id = await sql.begin(async (tx) => {
    const rows = await tx`
      INSERT INTO fund_request (requester_name, requester_email, purpose, amount_requested, cabang, request_date, hod_approver_key, notes)
      VALUES (${t.requester_name}, ${t.requester_email}, ${t.purpose}, ${t.amount_requested}, ${t.cabang ?? null},
              ${t.request_date ?? tx`CURRENT_DATE`}, ${t.hod_approver_key}, ${t.notes ?? null})
      RETURNING id
    `;
    const frId = String(rows[0].id);
    // Seed 2 baris approval fixed: HOD (required_hod_key snapshot) lalu Direktur.
    await tx`
      INSERT INTO fund_request_approval (fund_request_id, approver_role, required_hod_key)
      VALUES
        (${frId}, 'hod', ${t.hod_approver_key}),
        (${frId}, 'direktur', ${null})
    `;
    return frId;
  });
  const detail = await getFundRequest(id);
  if (!detail) throw new Error("gagal membaca fund request setelah dibuat");
  return detail;
}

export async function listFundRequests(opts?: {
  status?: FundRequestStatus;
  cabang?: string;
  requesterEmail?: string;
  limit?: number;
}): Promise<FundRequestRow[]> {
  const sql = db();
  const limit = opts?.limit ?? 1000;
  // approval_status dihitung dari 2 kolom join (bukan kolom asli) — filter
  // status DILAKUKAN DI JS SETELAH fetch, jadi LIMIT baris DB dilonggarkan
  // dulu (5000) supaya tidak salah terpotong SEBELUM filter status diterapkan.
  const rows = await sql`
    SELECT ${frCols(sql)}
    FROM fund_request fr
    ${FR_APPROVAL_AGG_JOIN(sql)}
    WHERE ${opts?.cabang ? sql`fr.cabang = ${opts.cabang}` : sql`true`}
      AND ${opts?.requesterEmail ? sql`fr.requester_email = ${opts.requesterEmail}` : sql`true`}
    ORDER BY fr.request_date DESC, fr.created_at DESC
    LIMIT ${opts?.status ? 5000 : limit}
  `;
  const mapped = rows.map(mapRow);
  const filtered = opts?.status ? mapped.filter((r) => r.approval_status === opts.status) : mapped;
  return filtered.slice(0, limit);
}

export async function getFundRequest(id: string): Promise<FundRequestDetail | null> {
  const sql = db();
  const rows = await sql`SELECT ${frCols(sql)} FROM fund_request fr ${FR_APPROVAL_AGG_JOIN(sql)} WHERE fr.id = ${id}`;
  if (!rows.length) return null;
  const approvals = await sql`
    SELECT ${approvalCols(sql)} FROM fund_request_approval WHERE fund_request_id = ${id} ORDER BY created_at ASC
  `;
  return { ...mapRow(rows[0]), approvals: approvals.map(mapApproval) };
}

// Hanya bisa dibatalkan selama BELUM ada keputusan apa pun (approval_status
// masih pending_hod & belum pernah decided) — sekali ada keputusan, baris
// jadi audit trail (tidak boleh hilang).
export async function deleteFundRequest(id: string): Promise<{ deleted: number }> {
  const sql = db();
  const rows = await sql`
    DELETE FROM fund_request fr
    WHERE fr.id = ${id}
      AND NOT EXISTS (
        SELECT 1 FROM fund_request_approval a WHERE a.fund_request_id = fr.id AND a.status <> 'pending'
      )
    RETURNING id
  `;
  if (rows.length) return { deleted: rows.length };
  const exists = await sql`SELECT 1 FROM fund_request WHERE id = ${id}`;
  if (exists.length) throw new FundRequestError(409, "sudah ada keputusan approval — tidak bisa dibatalkan");
  return { deleted: 0 };
}

// Sequencing: direktur menunggu hod approved. Guard idempoten (WHERE
// status='pending' langsung di UPDATE) dibungkus 1 transaksi supaya
// check-then-act tidak race (pola sama decidePurchaseOrderApproval F35).
export async function decideFundRequestApproval(
  fundRequestId: string,
  role: ApproverRole,
  decision: "approve" | "reject",
  decidedBy: string | null,
  note?: string | null,
): Promise<{ approvals: FundRequestApprovalRow[]; approval_status: FundRequestStatus }> {
  const sql = db();
  return sql.begin(async (tx) => {
    const head = await tx`SELECT id FROM fund_request WHERE id = ${fundRequestId}`;
    if (!head.length) throw new FundRequestError(404, "fund request tidak ditemukan");

    // approvalCols() typed utk Sql<{}>, bukan TransactionSql<{}> (gotcha yang
    // sama di beberapa repo lain) — kolom ditulis literal di dalam tx.
    const rows = (await tx`
      SELECT id, fund_request_id, approver_role, required_hod_key, status, decided_by, decided_at::text, note
      FROM fund_request_approval WHERE fund_request_id = ${fundRequestId}
    `).map(mapApproval);
    if (rows.some((r) => r.status === "rejected")) throw new FundRequestError(409, "fund request sudah ditolak");
    if (role === "direktur") {
      const hodDone = rows.find((r) => r.approver_role === "hod")?.status === "approved";
      if (!hodDone) throw new FundRequestError(409, "menunggu approval HOD");
    }

    const newStatus: ApprovalDecisionStatus = decision === "approve" ? "approved" : "rejected";
    const updated = await tx`
      UPDATE fund_request_approval SET
        status = ${newStatus}, decided_by = ${decidedBy}, decided_at = now(), note = ${note ?? null}, updated_at = now()
      WHERE fund_request_id = ${fundRequestId} AND approver_role = ${role} AND status = 'pending'
      RETURNING id
    `;
    if (!updated.length) throw new FundRequestError(409, "baris approval ini sudah diputuskan");

    const finalRows = (await tx`
      SELECT id, fund_request_id, approver_role, required_hod_key, status, decided_by, decided_at::text, note
      FROM fund_request_approval WHERE fund_request_id = ${fundRequestId} ORDER BY created_at ASC
    `).map(mapApproval);
    return { approvals: finalRows, approval_status: computeFundRequestStatus(finalRows) };
  });
}

export interface HodOption {
  id: string;
  name: string | null;
  email: string;
  hod_key: string;
}

// Daftar HOD aktif utk dropdown pilih Tier-1 approver saat submit. hod_key
// generic (app_user apa pun yg hod_key-nya ter-set) — BEDA dari po-approval-access.ts
// yang hardcode 3 key kanonik khusus domain PO (mufid/arman/ika); di sini
// pengaju bisa lapor ke HOD departemen mana pun.
export async function listActiveHods(): Promise<HodOption[]> {
  const sql = db();
  const rows = await sql`
    SELECT id, name, email, hod_key
    FROM app_user
    WHERE hod_key IS NOT NULL AND hod_key <> '' AND active
    ORDER BY name ASC NULLS LAST, email ASC
  `;
  return rows.map((r) => ({
    id: String(r.id),
    name: r.name != null ? String(r.name) : null,
    email: String(r.email),
    hod_key: String(r.hod_key),
  }));
}
