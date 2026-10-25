import type { TransactionSql } from "postgres";

import { db } from "../db.js";
import {
  batalkanRequestDalamTx,
  buatRequestDalamTx,
  daftarKonsumen,
  decideFromDashboard,
  getApprovalRequest,
  notifyCurrentStep,
  type NotifyResult,
} from "./approval.js";

// F138 Operational Fund Request (General Affairs). Modul standalone — TIDAK
// terhubung ke dana_ops (F51) dengan cara apa pun (lihat 141_fund_request.sql).
// Semua Karyawan boleh mengajukan; approval 2 tahap: HOD (dipilih manual oleh
// pengaju saat submit) lalu Direktur (final).
//
// Sejak migrasi 248 approval-nya lewat mesin F11 (alur 'dana-ops',
// fund_request.approval_request_id) — WA per tahap, #APPROVE, SLA, larangan
// memutus pengajuan sendiri. fund_request_approval tinggal jejak pengajuan
// lama yang sudah final. approval_status DIHITUNG (dari approval_step atau,
// untuk pengajuan lama, fund_request_approval), bukan kolom tersimpan.
// date/timestamptz eksplisit ::text di SELECT/RETURNING (gotcha postgres.js
// yang sama di semua repo lain).

export const JENIS_DANA_OPS = "dana-ops";
const REF_TABEL = "fund_request";
// Tahap engine ↔ peran lama yang dipakai UI: urutan 1 = HoD, 2 = Direktur.
const URUTAN_ROLE: Record<number, "hod" | "direktur"> = { 1: "hod", 2: "direktur" };

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
  // Null = pengajuan lama (sebelum migrasi 248) yang sudah final.
  approval_request_id: string | null;
  approval_kode: string | null;
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
    approval_request_id: r.approval_request_id != null ? String(r.approval_request_id) : null,
    approval_kode: r.approval_kode != null ? String(r.approval_kode) : null,
  };
}

function frCols(sql: ReturnType<typeof db>) {
  return sql`
    fr.id, fr.requester_name, fr.requester_email, fr.purpose, fr.amount_requested,
    fr.cabang, fr.request_date::text, fr.hod_approver_key, fr.notes,
    fr.created_at::text, fr.updated_at::text, fr.approval_request_id,
    appr.hod_status AS approval_hod_status,
    appr.direktur_status AS approval_direktur_status,
    appr.approval_kode
  `;
}

// Status per peran: dari approval_step (pengajuan di engine) atau
// fund_request_approval (pengajuan lama). Langkah 'skipped' (request
// dibatalkan) dibaca sebagai pending — pengajuannya sendiri ikut terhapus.
const FR_APPROVAL_AGG_JOIN = (sql: ReturnType<typeof db>) => sql`
  LEFT JOIN LATERAL (
    SELECT
      CASE WHEN fr.approval_request_id IS NOT NULL THEN
        (SELECT CASE s.status WHEN 'skipped' THEN 'pending' ELSE s.status END
           FROM approval_step s WHERE s.request_id = fr.approval_request_id AND s.urutan = 1)
      ELSE
        (SELECT a.status FROM fund_request_approval a WHERE a.fund_request_id = fr.id AND a.approver_role = 'hod')
      END AS hod_status,
      CASE WHEN fr.approval_request_id IS NOT NULL THEN
        (SELECT CASE s.status WHEN 'skipped' THEN 'pending' ELSE s.status END
           FROM approval_step s WHERE s.request_id = fr.approval_request_id AND s.urutan = 2)
      ELSE
        (SELECT a.status FROM fund_request_approval a WHERE a.fund_request_id = fr.id AND a.approver_role = 'direktur')
      END AS direktur_status,
      (SELECT r.kode FROM approval_request r WHERE r.id = fr.approval_request_id) AS approval_kode
  ) appr ON true
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
  // Akun pengaju (sesi web) — dasar larangan memutus pengajuan sendiri &
  // nomor WA untuk kabar hasil akhir.
  requester_user_id?: string | null;
}

export interface FundRequestDetail extends FundRequestRow {
  approvals: FundRequestApprovalRow[];
  // Diisi saat dibaca untuk pengguna tertentu (viewerUserId).
  approval?: {
    id: string;
    kode: string;
    current_role: ApproverRole | null;
    wewenang: { boleh: boolean; alasan: string | null } | null;
  };
  notify?: NotifyResult;
}

// Judul request di engine — juga tampil di WA approver.
function judulApproval(purpose: string): string {
  return `Dana operasional: ${purpose}`.slice(0, 200);
}

export async function createFundRequest(t: FundRequestInput): Promise<FundRequestDetail> {
  if (!(t.amount_requested > 0)) throw new FundRequestError(400, "amount_requested harus > 0");
  if (!t.purpose.trim()) throw new FundRequestError(400, "purpose wajib diisi");
  if (!t.hod_approver_key.trim()) throw new FundRequestError(400, "hod_approver_key wajib diisi");
  const sql = db();
  const hod = await sql`SELECT 1 FROM app_user WHERE hod_key = ${t.hod_approver_key} AND active`;
  if (!hod.length) throw new FundRequestError(400, "HOD terpilih tidak ditemukan / tidak aktif");

  // Baris induk + approval lahir dalam satu transaksi; WA dikirim sesudah commit.
  const made = await sql.begin(async (txRaw) => {
    const tx = txRaw as unknown as TransactionSql<Record<string, unknown>>;
    const rows = await tx`
      INSERT INTO fund_request (requester_name, requester_email, purpose, amount_requested, cabang, request_date, hod_approver_key, notes)
      VALUES (${t.requester_name}, ${t.requester_email}, ${t.purpose}, ${t.amount_requested}, ${t.cabang ?? null},
              ${t.request_date ?? tx`CURRENT_DATE`}, ${t.hod_approver_key}, ${t.notes ?? null})
      RETURNING id
    `;
    const frId = String(rows[0].id);
    const apr = await buatRequestDalamTx(tx, {
      jenis: JENIS_DANA_OPS,
      title: judulApproval(t.purpose),
      description: [t.cabang ? `Cabang: ${t.cabang}` : null, t.notes].filter(Boolean).join("\n") || null,
      nominal: t.amount_requested,
      requestedBy: t.requester_name,
      requestedByUserId: t.requester_user_id ?? null,
      hodPengaju: t.hod_approver_key,
      refTabel: REF_TABEL,
      refId: frId,
    });
    if (!apr.ok) throw new FundRequestError(400, apr.error);
    await tx`UPDATE fund_request SET approval_request_id = ${apr.id} WHERE id = ${frId}`;
    return { frId, aprId: apr.id };
  });
  const notify = await notifyCurrentStep(made.aprId);
  const detail = await getFundRequest(made.frId);
  if (!detail) throw new Error("gagal membaca fund request setelah dibuat");
  return { ...detail, notify };
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

export async function getFundRequest(id: string, opts: { viewerUserId?: string | null } = {}): Promise<FundRequestDetail | null> {
  const sql = db();
  const rows = await sql`SELECT ${frCols(sql)} FROM fund_request fr ${FR_APPROVAL_AGG_JOIN(sql)} WHERE fr.id = ${id}`;
  if (!rows.length) return null;
  const row = mapRow(rows[0]);
  if (!row.approval_request_id) {
    const approvals = await sql`
      SELECT ${approvalCols(sql)} FROM fund_request_approval WHERE fund_request_id = ${id} ORDER BY created_at ASC
    `;
    return { ...row, approvals: approvals.map(mapApproval) };
  }
  // Pengajuan di engine: bentuk baris per peran disusun dari approval_step
  // supaya UI lama (tabel per peran) tetap jalan tanpa tahu engine.
  const apr = await getApprovalRequest(row.approval_request_id, { viewerUserId: opts.viewerUserId ?? null });
  const approvals: FundRequestApprovalRow[] = (apr?.steps ?? [])
    .filter((st) => URUTAN_ROLE[st.urutan])
    .map((st) => ({
      id: `${row.approval_request_id}:${st.urutan}`,
      fund_request_id: row.id,
      approver_role: URUTAN_ROLE[st.urutan],
      required_hod_key: st.hodKey,
      status: st.status === "approved" || st.status === "rejected" ? st.status : "pending",
      decided_by: st.decidedBy,
      decided_at: st.decidedAt,
      note: st.decisionNote,
    }));
  return {
    ...row,
    approvals,
    approval: apr
      ? {
          id: apr.id,
          kode: apr.kode,
          current_role: apr.status === "pending" && apr.currentUrutan != null ? (URUTAN_ROLE[apr.currentUrutan] ?? null) : null,
          wewenang: apr.wewenang ?? null,
        }
      : undefined,
  };
}

// Hanya bisa dibatalkan selama BELUM ada keputusan apa pun (approval_status
// masih pending_hod & belum pernah decided) — sekali ada keputusan, baris
// jadi audit trail (tidak boleh hilang).
export async function deleteFundRequest(id: string, oleh: string | null = null): Promise<{ deleted: number }> {
  const sql = db();
  const [head] = await sql`SELECT approval_request_id FROM fund_request WHERE id = ${id}`;
  if (!head) return { deleted: 0 };
  if (head.approval_request_id) {
    return sql.begin(async (txRaw) => {
      const tx = txRaw as unknown as TransactionSql<Record<string, unknown>>;
      const [r] = await tx`SELECT id FROM approval_request WHERE id = ${head.approval_request_id} FOR UPDATE`;
      const decided = r
        ? await tx`SELECT 1 FROM approval_step WHERE request_id = ${r.id} AND status IN ('approved', 'rejected') LIMIT 1`
        : [];
      if (decided.length) throw new FundRequestError(409, "sudah ada keputusan approval — tidak bisa dibatalkan");
      // Approval ditutup 'canceled' (tetap tercatat), baru induknya dihapus.
      if (r) await batalkanRequestDalamTx(tx, { refTabel: REF_TABEL, refId: id }, oleh ?? "pengaju", "pengajuan dibatalkan");
      const del = await tx`DELETE FROM fund_request WHERE id = ${id} RETURNING id`;
      return { deleted: del.length };
    });
  }
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

// Keputusan untuk pengajuan di engine (migrasi 248). userId dari sesi; siapa
// yang boleh memutus ditentukan engine (cekWewenang), bukan peran di URL.
// `role` dari UI dicocokkan ke tahap current supaya klik dari layar basi
// (tahap sudah maju) tak memutus tahap lain diam-diam.
export async function decideFundRequestViaEngine(
  fundRequestId: string,
  role: ApproverRole,
  decision: "approve" | "reject",
  userId: string,
  note?: string | null,
): Promise<{ approvals: FundRequestApprovalRow[]; approval_status: FundRequestStatus; nextNotify?: NotifyResult }> {
  const fr = await getFundRequest(fundRequestId);
  if (!fr) throw new FundRequestError(404, "fund request tidak ditemukan");
  if (!fr.approval_request_id || !fr.approval) throw new FundRequestError(409, "pengajuan ini tidak memakai mesin approval");
  if (fr.approval.current_role !== role) {
    throw new FundRequestError(409, fr.approval.current_role ? `tahap sekarang: ${fr.approval.current_role}` : "approval sudah selesai");
  }
  const r = await decideFromDashboard(fr.approval_request_id, decision, userId, note ?? null);
  if (!r.ok) {
    const e = r.error ?? "gagal memutus";
    throw new FundRequestError(/tidak ditemukan/.test(e) ? 404 : /wajib/.test(e) ? 400 : /sudah/.test(e) ? 409 : 403, e);
  }
  const after = await getFundRequest(fundRequestId);
  return { approvals: after?.approvals ?? [], approval_status: after?.approval_status ?? fr.approval_status, nextNotify: r.nextNotify };
}

// Penangan konsumen engine: dana ops tak punya kolom status sendiri (status
// dihitung dari approval_step), jadi cukup menandai baris induk berubah.
daftarKonsumen(REF_TABEL, async (tx, h) => {
  await tx`UPDATE fund_request SET updated_at = now() WHERE id = ${h.refId}`;
});

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
