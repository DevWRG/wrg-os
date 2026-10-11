// F60 — Komite Audit Findings Tracker (migrasi 191). Chain approval penutupan
// finding: GLOBAL config (2-5 tahap enabled, pola sama approval_chain_config
// F11) tapi target tiap tahap adalah GRUP (access_group/app_user_group,
// 044_rbac.sql), bukan individu hod_key — supaya pergeseran jabatan cukup
// diurus lewat menu Akses Grup, tanpa sentuh data finding. Lihat catatan
// lengkap di kepala migrasi 191_audit_finding_tracker.sql.

import { createHash } from "node:crypto";

import { db, isDbEnabled } from "../db.js";
import { sendViaWaGateway } from "../wasend.js";

type Sql = ReturnType<typeof db>;

export interface ActionResult {
  ok: boolean;
  error?: string;
}

const toIsoTs = (x: unknown): string => new Date(x as string | Date).toISOString();
const toIsoTsOrNull = (x: unknown): string | null => (x == null ? null : toIsoTs(x));

// ───────────────────────── Chain config (global, admin) ─────────────────────────

export interface ChainConfigRow {
  urutan: number;
  label: string;
  accessGroupId: number | null;
  accessGroupName: string | null;
  enabled: boolean;
  // Anggota grup bisa membuka menu Audit Findings? (superuser, atau izin view
  // aktif utk fitur audit-findings di Akses Grup). false = approver tahap ini
  // tak bisa melihat tombol Approve/Reject — panel config menampilkan peringatan.
  groupCanView: boolean;
}

export async function listChainConfig(): Promise<ChainConfigRow[]> {
  const sql = db();
  const rows = await sql`
    SELECT c.urutan, c.label, c.access_group_id, c.enabled, g.name AS group_name,
           (g.superuser OR COALESCE(p.active AND p.can_view, false)) AS group_can_view
    FROM audit_finding_approval_chain_config c
    LEFT JOIN access_group g ON g.id = c.access_group_id
    LEFT JOIN access_permission p ON p.group_id = c.access_group_id AND p.feature_key = 'audit-findings'
    ORDER BY c.urutan
  `;
  return rows.map((r) => ({
    urutan: Number(r.urutan),
    label: String(r.label),
    accessGroupId: r.access_group_id != null ? Number(r.access_group_id) : null,
    accessGroupName: r.group_name ? String(r.group_name) : null,
    enabled: Boolean(r.enabled),
    groupCanView: Boolean(r.group_can_view),
  }));
}

export interface ChainConfigPatch {
  accessGroupId?: number | null;
  enabled?: boolean;
}

export async function updateChainConfigStep(urutan: number, patch: ChainConfigPatch): Promise<ActionResult> {
  const sql = db();
  const rows = await sql`SELECT urutan FROM audit_finding_approval_chain_config WHERE urutan = ${urutan}`;
  if (rows.length === 0) return { ok: false, error: `tahap urutan ${urutan} tidak ditemukan` };
  if (patch.accessGroupId != null) {
    const [g] = await sql`SELECT id FROM access_group WHERE id = ${patch.accessGroupId}`;
    if (!g) return { ok: false, error: "access_group tidak ditemukan" };
  }
  await sql`
    UPDATE audit_finding_approval_chain_config SET
      access_group_id = ${patch.accessGroupId === undefined ? sql`access_group_id` : patch.accessGroupId},
      enabled = ${patch.enabled === undefined ? sql`enabled` : patch.enabled},
      updated_at = now()
    WHERE urutan = ${urutan}
  `;
  return { ok: true };
}

async function activeChain(): Promise<ChainConfigRow[]> {
  const all = await listChainConfig();
  return all.filter((c) => c.enabled);
}

// ───────────────────────── Finding ─────────────────────────

export interface AuditFindingRow {
  id: string;
  kode: string;
  title: string;
  description: string | null;
  source: string | null;
  unit_terdampak: string | null;
  control_linkage: string | null;
  due_date: string | null;
  status: string;
  created_by: string | null;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
}

function mapFindingRow(r: Record<string, unknown>): AuditFindingRow {
  return {
    id: String(r.id),
    kode: String(r.kode),
    title: String(r.title),
    description: r.description ? String(r.description) : null,
    source: r.source ? String(r.source) : null,
    unit_terdampak: r.unit_terdampak ? String(r.unit_terdampak) : null,
    control_linkage: r.control_linkage ? String(r.control_linkage) : null,
    due_date: r.due_date ? String(r.due_date) : null,
    status: String(r.status),
    created_by: r.created_by ? String(r.created_by) : null,
    created_by_name: r.created_by_name ? String(r.created_by_name) : null,
    created_at: toIsoTs(r.created_at),
    updated_at: toIsoTs(r.updated_at),
    closed_at: toIsoTsOrNull(r.closed_at),
  };
}

// Dipanggil DI DALAM transaksi yang sudah memegang advisory lock (lihat
// createFinding) — MAX+1 tanpa kunci = dua create paralel dapat kode sama dan
// salah satunya gagal "Data duplikat".
async function generateFindingCode(sql: Sql): Promise<string> {
  const [row] = await sql`
    SELECT 'TEMUAN-' || TO_CHAR(NOW(), 'YYYY') || '-' ||
           LPAD((COALESCE(MAX(SUBSTRING(kode FROM 13)::int), 0) + 1)::text, 5, '0') AS next_kode
    FROM audit_finding
    WHERE kode LIKE 'TEMUAN-' || TO_CHAR(NOW(), 'YYYY') || '-%'
  `;
  return String(row.next_kode);
}

export interface AuditFindingListFilter {
  status?: string;
  overdue?: boolean;
}

export const FINDINGS_LIST_LIMIT = 500;

export interface AuditFindingList {
  findings: AuditFindingRow[];
  total_rows: number;
  limit: number;
}

// total_rows ikut dikirim supaya UI bisa bilang "menampilkan X dari Y" — tanpa
// itu LIMIT memotong daftar diam-diam (pola {count,total_rows,limit}).
export async function listFindings(filter: AuditFindingListFilter = {}): Promise<AuditFindingList> {
  const sql = db();
  const rows = await sql`
    SELECT count(*) OVER () AS total_rows, f.id, f.kode, f.title, f.description, f.source, f.unit_terdampak, f.control_linkage,
           f.due_date::text, f.status, f.created_by, f.created_at, f.updated_at, f.closed_at,
           u.name AS created_by_name
    FROM audit_finding f
    LEFT JOIN app_user u ON u.id = f.created_by
    WHERE ${filter.status ? sql`f.status = ${filter.status}` : sql`true`}
      AND ${filter.overdue ? sql`f.due_date < CURRENT_DATE AND f.status NOT IN ('closed')` : sql`true`}
    ORDER BY f.created_at DESC
    LIMIT ${FINDINGS_LIST_LIMIT}
  `;
  return {
    findings: rows.map(mapFindingRow),
    total_rows: rows.length ? Number(rows[0].total_rows) : 0,
    limit: FINDINGS_LIST_LIMIT,
  };
}

// f.due_date::text WAJIB — kolom `date` polos, kalau tidak di-cast postgres.js
// mengembalikannya sbg objek JS Date; mapFindingRow's String() akan
// menyerialisasinya via Date.prototype.toString() (mis. "Thu Dec 31 2026
// 07:00:00 GMT+0700 (...)"), bukan "2026-12-31". Sama persis jebakan yang
// pernah ketemu di F39 (lihat CLAUDE.md gotcha postgres.js date cast).
export async function getFinding(id: string): Promise<AuditFindingRow | null> {
  const sql = db();
  const rows = await sql`
    SELECT f.id, f.kode, f.title, f.description, f.source, f.unit_terdampak, f.control_linkage,
           f.due_date::text, f.status, f.created_by, f.created_at, f.updated_at, f.closed_at,
           u.name AS created_by_name
    FROM audit_finding f
    LEFT JOIN app_user u ON u.id = f.created_by
    WHERE f.id = ${id}
  `;
  return rows.length ? mapFindingRow(rows[0]) : null;
}

export interface CreateFindingInput {
  title: string;
  description?: string | null;
  source?: string | null;
  unit_terdampak?: string | null;
  control_linkage?: string | null;
  due_date?: string | null;
  created_by?: string | null;
}

export async function createFinding(input: CreateFindingInput): Promise<AuditFindingRow | ActionResult> {
  if (!isDbEnabled()) return { ok: false, error: "DATABASE_URL off" };
  const title = input.title?.trim();
  if (!title) return { ok: false, error: "title wajib" };
  const sql = db();
  const { id, kode } = await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtext('audit_finding.kode'))`;
    const kode = await generateFindingCode(tx as unknown as Sql);
    const [row] = await tx`
      INSERT INTO audit_finding (kode, title, description, source, unit_terdampak, control_linkage, due_date, created_by)
      VALUES (${kode}, ${title}, ${input.description ?? null}, ${input.source ?? null}, ${input.unit_terdampak ?? null},
              ${input.control_linkage ?? null}, ${input.due_date ?? null}, ${input.created_by ?? null})
      RETURNING id
    `;
    return { id: String(row.id), kode };
  });
  const finding = await getFinding(id);
  await logAudit("audit_finding.create", input.created_by, { finding_id: id, kode, title }, "create");
  return finding as AuditFindingRow;
}

export interface UpdateFindingInput {
  title?: string;
  description?: string | null;
  source?: string | null;
  unit_terdampak?: string | null;
  control_linkage?: string | null;
  due_date?: string | null;
}

// Edit field non-status — ditutup begitu finding closed (histori temuan yang
// sudah tuntas tidak boleh diam-diam berubah) DAN selama pending_closure: yang
// disetujui approver harus sama dengan yang diajukan. Perlu ubah? Reject dulu
// (finding kembali in_progress), edit, lalu ajukan ulang.
export async function updateFinding(id: string, input: UpdateFindingInput): Promise<ActionResult> {
  const sql = db();
  const [cur] = await sql`SELECT status FROM audit_finding WHERE id = ${id}`;
  if (!cur) return { ok: false, error: "finding tidak ditemukan" };
  if (cur.status === "closed") return { ok: false, error: "finding sudah closed — tidak bisa diedit" };
  if (cur.status === "pending_closure") {
    return { ok: false, error: "finding sedang menunggu persetujuan penutupan — tidak bisa diedit sampai diputus" };
  }
  await sql`
    UPDATE audit_finding SET
      title = ${input.title === undefined ? sql`title` : input.title},
      description = ${input.description === undefined ? sql`description` : input.description},
      source = ${input.source === undefined ? sql`source` : input.source},
      unit_terdampak = ${input.unit_terdampak === undefined ? sql`unit_terdampak` : input.unit_terdampak},
      control_linkage = ${input.control_linkage === undefined ? sql`control_linkage` : input.control_linkage},
      due_date = ${input.due_date === undefined ? sql`due_date` : input.due_date},
      updated_at = now()
    WHERE id = ${id}
  `;
  return { ok: true };
}

// open -> in_progress saja (manual, dipanggil PIC saat mulai menindaklanjuti).
// pending_closure/closed diurus requestClosure/decideStep (side-effect lebih
// dari sekadar ubah status), bukan lewat fungsi ini.
export async function startFinding(id: string): Promise<ActionResult> {
  const sql = db();
  const [row] = await sql`SELECT status FROM audit_finding WHERE id = ${id}`;
  if (!row) return { ok: false, error: "finding tidak ditemukan" };
  if (row.status !== "open") return { ok: false, error: `finding berstatus "${row.status}", bukan "open"` };
  await sql`UPDATE audit_finding SET status = 'in_progress', updated_at = now() WHERE id = ${id}`;
  return { ok: true };
}

// ───────────────────────── Approval request + step ─────────────────────────

export interface ApprovalStepRow {
  id: number;
  urutan: number;
  label: string;
  accessGroupId: number | null;
  accessGroupName: string | null;
  status: string;
  notifiedAt: string | null;
  decidedBy: string | null;
  decidedByName: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
}

export interface ApprovalRequestDetail {
  id: string;
  findingId: string;
  requestedBy: string | null;
  requestedByName: string | null;
  requestedAt: string;
  status: string;
  currentUrutan: number;
  decidedAt: string | null;
  steps: ApprovalStepRow[];
}

export async function getApprovalRequest(id: string): Promise<ApprovalRequestDetail | null> {
  const sql = db();
  const rows = await sql`
    SELECT r.*, u.name AS requested_by_name
    FROM audit_finding_approval_request r
    LEFT JOIN app_user u ON u.id = r.requested_by
    WHERE r.id = ${id}
  `;
  if (rows.length === 0) return null;
  const r = rows[0];
  const stepRows = await sql`
    SELECT s.*, g.name AS group_name, du.name AS decided_by_name
    FROM audit_finding_approval_step s
    LEFT JOIN access_group g ON g.id = s.access_group_id
    LEFT JOIN app_user du ON du.id = s.decided_by
    WHERE s.request_id = ${id}
    ORDER BY s.urutan
  `;
  return {
    id: String(r.id),
    findingId: String(r.finding_id),
    requestedBy: r.requested_by ? String(r.requested_by) : null,
    requestedByName: r.requested_by_name ? String(r.requested_by_name) : null,
    requestedAt: toIsoTs(r.requested_at),
    status: String(r.status),
    currentUrutan: Number(r.current_urutan),
    decidedAt: toIsoTsOrNull(r.decided_at),
    steps: stepRows.map((s) => ({
      id: Number(s.id),
      urutan: Number(s.urutan),
      label: String(s.label),
      accessGroupId: s.access_group_id != null ? Number(s.access_group_id) : null,
      accessGroupName: s.group_name ? String(s.group_name) : null,
      status: String(s.status),
      notifiedAt: toIsoTsOrNull(s.notified_at),
      decidedBy: s.decided_by ? String(s.decided_by) : null,
      decidedByName: s.decided_by_name ? String(s.decided_by_name) : null,
      decidedAt: toIsoTsOrNull(s.decided_at),
      decisionNote: s.decision_note ? String(s.decision_note) : null,
    })),
  };
}

export async function getActiveApprovalRequest(findingId: string): Promise<ApprovalRequestDetail | null> {
  const sql = db();
  const [row] = await sql`SELECT id FROM audit_finding_approval_request WHERE finding_id = ${findingId} AND status = 'pending'`;
  if (!row) return null;
  return getApprovalRequest(String(row.id));
}

// Anggota grup (utk resolusi target notifikasi/decide) — live, bukan snapshot.
async function groupMembers(accessGroupId: number): Promise<{ id: string; name: string; waNumber: string | null }[]> {
  const sql = db();
  const rows = await sql`
    SELECT u.id, u.name, u.wa_number
    FROM app_user_group m JOIN app_user u ON u.id = m.user_id
    WHERE m.group_id = ${accessGroupId} AND u.active = true
  `;
  return rows.map((r) => ({ id: String(r.id), name: r.name ? String(r.name) : "-", waNumber: r.wa_number ? String(r.wa_number) : null }));
}

export interface NotifyResult {
  ok: boolean;
  error?: string;
  sent?: number;
}

// Kirim notifikasi tahap CURRENT ke semua anggota grup-nya (personal, bukan
// grup WA) — pola sama notifyCurrentStep F11 tapi broadcast ke N anggota
// grup, bukan 1 individu.
export async function notifyCurrentStep(requestId: string): Promise<NotifyResult> {
  const sql = db();
  const [req] = await sql`
    SELECT r.id, r.status, r.current_urutan, r.finding_id, f.kode, f.title
    FROM audit_finding_approval_request r JOIN audit_finding f ON f.id = r.finding_id
    WHERE r.id = ${requestId}
  `;
  if (!req) return { ok: false, error: "request tidak ditemukan" };
  if (req.status !== "pending") return { ok: false, error: `request sudah ${req.status}` };
  const [step] = await sql`
    SELECT id, urutan, label, access_group_id, status FROM audit_finding_approval_step
    WHERE request_id = ${requestId} AND urutan = ${req.current_urutan}
  `;
  if (!step) return { ok: false, error: "tahap current tidak ditemukan" };
  if (step.status !== "pending") return { ok: false, error: `tahap ini sudah ${step.status}` };
  if (!step.access_group_id) return { ok: false, error: `tahap "${step.label}" belum ada grup — atur di panel config` };

  const members = await groupMembers(Number(step.access_group_id));
  const targets = members.filter((m) => m.waNumber).map((m) => m.waNumber as string);
  if (targets.length === 0) {
    // Grup ada tapi tanpa anggota/nomor WA — state SAH (bukan crash), tapi
    // tanpa notifikasi. Deadlock-nya kelihatan di dashboard (step pending
    // tanpa kunjung dinotif), bukan senyap.
    return { ok: false, error: `grup "${step.label}" belum punya anggota dgn nomor WA aktif` };
  }

  const msg =
    `🔍 *Persetujuan Penutupan Temuan Audit* (${step.label})\n\n` +
    `${req.kode} — ${req.title}\n\n` +
    `Buka dashboard Audit Findings untuk approve/reject.`;

  let sent = 0;
  for (const target of new Set(targets)) {
    const gw = await sendViaWaGateway(target, msg);
    if (gw.sent) sent += 1;
  }
  await sql`UPDATE audit_finding_approval_step SET notified_at = now() WHERE id = ${step.id}`;
  await logAudit("audit_finding.notify", null, { request_id: requestId, urutan: step.urutan, sent }, "notify");
  return { ok: true, sent };
}

export interface RequestClosureResult extends ActionResult {
  requestId?: string;
}

export async function requestClosure(findingId: string, requestedBy: string | null): Promise<RequestClosureResult> {
  const sql = db();
  const chain = await activeChain();
  if (chain.length < 2) return { ok: false, error: "chain approval aktif kurang dari 2 tahap — atur minimal 2 di panel config" };
  const missingGroup = chain.find((c) => c.accessGroupId == null);
  if (missingGroup) return { ok: false, error: `tahap "${missingGroup.label}" aktif tapi belum ada grup — atur di panel config` };

  // Satu transaksi + kunci baris finding: request, semua step, dan perubahan
  // status jadi atomik (tak ada request setengah jadi tanpa step) dan dua klik
  // "Ajukan" bersamaan tidak saling balapan.
  const r = await sql.begin(async (tx): Promise<RequestClosureResult> => {
    const [finding] = await tx`SELECT status FROM audit_finding WHERE id = ${findingId} FOR UPDATE`;
    if (!finding) return { ok: false, error: "finding tidak ditemukan" };
    if (finding.status !== "in_progress") {
      return { ok: false, error: `finding berstatus "${finding.status}" — hanya "in_progress" yang bisa diajukan penutupan` };
    }
    const [existing] = await tx`SELECT id FROM audit_finding_approval_request WHERE finding_id = ${findingId} AND status = 'pending'`;
    if (existing) return { ok: false, error: "sudah ada pengajuan penutupan yang masih berjalan" };

    const [reqRow] = await tx`
      INSERT INTO audit_finding_approval_request (finding_id, requested_by, current_urutan)
      VALUES (${findingId}, ${requestedBy}, 1)
      RETURNING id
    `;
    const requestId = String(reqRow.id);
    let urutan = 1;
    for (const c of chain) {
      await tx`
        INSERT INTO audit_finding_approval_step (request_id, urutan, label, access_group_id)
        VALUES (${requestId}, ${urutan}, ${c.label}, ${c.accessGroupId})
      `;
      urutan += 1;
    }
    await tx`UPDATE audit_finding SET status = 'pending_closure', updated_at = now() WHERE id = ${findingId}`;
    return { ok: true, requestId };
  });
  if (!r.ok || !r.requestId) return r;

  await logAudit("audit_finding.request_closure", requestedBy, { finding_id: findingId, request_id: r.requestId, steps: chain.length }, "create");
  await notifyCurrentStep(r.requestId);
  return r;
}

export interface DecideStepInput {
  requestId: string;
  action: "approve" | "reject";
  deciderUserId: string;
  note?: string | null;
}

export interface DecideResult extends ActionResult {
  status?: string;
}

export interface DecideGuardInput {
  deciderUserId: string;
  requestedBy: string | null;
  currentUrutan: number;
  steps: { urutan: number; decidedBy: string | null }[];
}

// Pemisahan tugas (konteks post-fraud): pengaju tidak boleh ikut memutus
// pengajuannya sendiri, dan satu orang hanya boleh memutus SATU tahap per
// pengajuan. Tanpa ini, orang yang kebetulan anggota dua grup approver bisa
// menutup temuan sendirian. Fungsi murni — dipakai repo & diuji unit.
export function decideBlockReason(input: DecideGuardInput): string | null {
  if (input.requestedBy && input.requestedBy === input.deciderUserId) {
    return "pengaju penutupan tidak boleh ikut memutus pengajuannya sendiri";
  }
  const sudah = input.steps.find((s) => s.urutan !== input.currentUrutan && s.decidedBy === input.deciderUserId);
  if (sudah) return `sudah memutus tahap ${sudah.urutan} di pengajuan ini — satu orang hanya boleh memutus satu tahap`;
  return null;
}

// Decider DIVALIDASI harus anggota AKTIF grup tahap current SAAT INI (live —
// pola sama decideCurrentStep F11) — cegah orang di luar grup, atau bekas
// anggota yang sudah dikeluarkan, menyelonong approve.
//
// Seluruh keputusan berjalan dalam SATU transaksi yang mengunci baris request
// (FOR UPDATE). Tanpa kunci, dua anggota grup yang menekan Approve bersamaan
// sama-sama lolos cek "pending", lalu current_urutan naik dua kali → tahap
// berikutnya terlewat dan temuan bisa closed dengan tahap tengah masih pending
// (terbukti 6/6 di uji dev 11 Okt 2026). Notifikasi WA dikirim SESUDAH commit.
export async function decideStep(input: DecideStepInput): Promise<DecideResult> {
  const sql = db();
  const out = await sql.begin(async (tx): Promise<DecideResult & { notify?: boolean; findingId?: string; urutan?: number }> => {
    const [req] = await tx`
      SELECT id, finding_id, status, current_urutan, requested_by
      FROM audit_finding_approval_request WHERE id = ${input.requestId} FOR UPDATE
    `;
    if (!req) return { ok: false, error: "request tidak ditemukan" };
    if (req.status !== "pending") return { ok: false, error: `request sudah ${req.status}` };

    const steps = await tx`
      SELECT id, urutan, access_group_id, status, label, decided_by
      FROM audit_finding_approval_step WHERE request_id = ${input.requestId} ORDER BY urutan
    `;
    const step = steps.find((s) => Number(s.urutan) === Number(req.current_urutan));
    if (!step || step.status !== "pending") return { ok: false, error: "tahap current tidak valid" };
    if (!step.access_group_id) return { ok: false, error: `tahap "${step.label}" belum ada grup — atur di panel config` };

    const [membership] = await tx`
      SELECT 1 FROM app_user_group m JOIN app_user u ON u.id = m.user_id
      WHERE m.group_id = ${step.access_group_id} AND m.user_id = ${input.deciderUserId} AND u.active = true
    `;
    if (!membership) return { ok: false, error: "bukan anggota grup yang berwenang untuk tahap ini" };

    const blocked = decideBlockReason({
      deciderUserId: input.deciderUserId,
      requestedBy: req.requested_by ? String(req.requested_by) : null,
      currentUrutan: Number(req.current_urutan),
      steps: steps.map((s) => ({ urutan: Number(s.urutan), decidedBy: s.decided_by ? String(s.decided_by) : null })),
    });
    if (blocked) return { ok: false, error: blocked };

    if (input.action === "reject") {
      await tx`
        UPDATE audit_finding_approval_step SET status = 'rejected', decided_by = ${input.deciderUserId}, decided_at = now(), decision_note = ${input.note ?? null}
        WHERE id = ${step.id}
      `;
      await tx`UPDATE audit_finding_approval_request SET status = 'rejected', decided_at = now() WHERE id = ${req.id}`;
      await tx`UPDATE audit_finding SET status = 'in_progress', updated_at = now() WHERE id = ${req.finding_id}`;
      return { ok: true, status: "rejected", urutan: Number(step.urutan) };
    }

    await tx`
      UPDATE audit_finding_approval_step SET status = 'approved', decided_by = ${input.deciderUserId}, decided_at = now(), decision_note = ${input.note ?? null}
      WHERE id = ${step.id}
    `;
    const maxUrutan = Math.max(...steps.map((s) => Number(s.urutan)));
    if (Number(step.urutan) >= maxUrutan) {
      await tx`UPDATE audit_finding_approval_request SET status = 'approved', decided_at = now() WHERE id = ${req.id}`;
      await tx`UPDATE audit_finding SET status = 'closed', closed_at = now(), updated_at = now() WHERE id = ${req.finding_id}`;
      return { ok: true, status: "approved", findingId: String(req.finding_id), urutan: Number(step.urutan) };
    }
    await tx`UPDATE audit_finding_approval_request SET current_urutan = ${Number(step.urutan) + 1} WHERE id = ${req.id}`;
    return { ok: true, status: "pending", notify: true, urutan: Number(step.urutan) };
  });
  if (!out.ok) return { ok: false, error: out.error };

  if (out.status === "rejected") {
    await logAudit("audit_finding.reject_step", input.deciderUserId, { request_id: input.requestId, urutan: out.urutan, note: input.note }, "reject");
  } else {
    await logAudit("audit_finding.approve_step", input.deciderUserId, { request_id: input.requestId, urutan: out.urutan }, "approve");
  }
  if (out.status === "approved") {
    await logAudit("audit_finding.closed", input.deciderUserId, { finding_id: out.findingId, request_id: input.requestId }, "close");
  }
  if (out.notify) await notifyCurrentStep(input.requestId);
  return { ok: true, status: out.status };
}

// ───────────────────────── Reminder overdue (cron) ─────────────────────────

// Reminder harian utk tahap pending yang sudah menunggu > threshold hari
// (pola sama MISS_ESCALATION_*/runGaHelpdeskOverdueAlert) — dedup via
// reminded_at (hanya sekali per hari kalender, cron bisa jalan >1x tanpa
// dobel spam).
export async function runAuditFindingApprovalReminder(thresholdDays: number): Promise<{ reminded: number }> {
  const sql = db();
  const rows = await sql`
    SELECT s.id, s.label, s.access_group_id, s.notified_at, r.id AS request_id, f.kode, f.title
    FROM audit_finding_approval_step s
    JOIN audit_finding_approval_request r ON r.id = s.request_id AND r.status = 'pending' AND r.current_urutan = s.urutan
    JOIN audit_finding f ON f.id = r.finding_id
    WHERE s.status = 'pending'
      AND s.access_group_id IS NOT NULL
      AND s.notified_at IS NOT NULL
      AND s.notified_at < now() - (${thresholdDays} || ' days')::interval
      AND (s.reminded_at IS NULL OR s.reminded_at::date < CURRENT_DATE)
  `;
  let reminded = 0;
  for (const r of rows) {
    const members = await groupMembers(Number(r.access_group_id));
    const targets = members.filter((m) => m.waNumber).map((m) => m.waNumber as string);
    if (targets.length === 0) continue; // grup kosong — dilewati, bukan crash (lihat notifyCurrentStep)
    const msg =
      `⏰ *Pengingat: Persetujuan Penutupan Temuan Audit Telat* (${r.label})\n\n` +
      `${r.kode} — ${r.title}\n\n` +
      `Sudah menunggu keputusan lebih dari ${thresholdDays} hari. Buka dashboard Audit Findings.`;
    let anySent = false;
    for (const target of new Set(targets)) {
      const gw = await sendViaWaGateway(target, msg);
      if (gw.sent) anySent = true;
    }
    if (anySent) {
      await sql`UPDATE audit_finding_approval_step SET reminded_at = now() WHERE id = ${r.id}`;
      reminded += 1;
    }
  }
  return { reminded };
}

// ───────────────────────── Audit trail ─────────────────────────

// Tulis ke audit_log (D6 governance, 002_governance.sql) — F60 secara tematik
// adalah fitur audit, jadi jejak keputusannya SEHARUSNYA ikut log ini (dipakai
// 11 file repo lain). agent_id 'A3' dipinjam sama seperti F11 (approval.ts):
// F60 bukan agen LLM, tapi FK agent_registry wajib diisi — bikin baris
// agent_registry baru cuma utk 1 FK ini overengineering selama belum
// dibutuhkan identitas terpisah.
async function logAudit(eventType: string, actor: string | null | undefined, payload: Record<string, unknown>, decision: string): Promise<void> {
  const sql = db();
  const hash = createHash("sha256").update(JSON.stringify({ eventType, payload })).digest("hex");
  await sql`
    INSERT INTO audit_log (use_case_id, correlation_id, agent_id, layer, event_type, r_tier, input_hash, output_hash, payload, human_actor, decision)
    VALUES ('D1', ${`f60-${hash.slice(0, 8)}`}, 'A3', 5, ${eventType}, 'R2', ${hash}, ${hash}, ${sql.json(payload as unknown as Parameters<typeof sql.json>[0])}, ${actor ?? null}, ${decision})
  `;
}
