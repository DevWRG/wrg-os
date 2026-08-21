// F11 — Approval Engine #APPROVE/#REJECT bot (base/generic, migrasi 106).
// Chain SEKUENSIAL (HoD Sales → HoD Bisnis → HoD After Sales → HoD Supply
// Chain → Direktur), notifikasi WA PRIVAT (bukan grup) per tahap — tahap
// berikut baru dikirim setelah tahap sekarang approve. Target kontak
// diresolve LIVE dari app_user (hod_key/role) tiap kirim, bukan disnapshot,
// supaya begitu Direktur kasih kontak & config diisi, langsung kepakai
// tanpa migrasi/redeploy baru.

import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { homedir } from "node:os";

import { db, isDbEnabled } from "../db.js";
import { sendViaWaGateway } from "../wasend.js";
import { normalizeWa } from "./master.js";

// Lampiran PDF/PNG (arahan user, susulan setelah base engine) — disk lokal,
// pola sama filosofi MEDIA_ROOT di index.ts (WA bridge media) tapi
// direktori TERPISAH krn sumbernya beda (upload browser, bukan WA).
const APPROVAL_UPLOAD_ROOT = resolve(process.env.APPROVAL_UPLOAD_ROOT ?? `${homedir()}/.wrg-os/approval-uploads`);
const ALLOWED_MIME = new Set(["application/pdf", "image/png"]);
const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024; // 8MB/file — cukup utk PDF/PNG dokumen, cegah abuse

export interface ChainConfigRow {
  urutan: number;
  label: string;
  targetType: "hod" | "direktur";
  hodKey: string | null;
  waNumberOverride: string | null;
  catatan: string | null;
}

export async function listChainConfig(): Promise<ChainConfigRow[]> {
  const sql = db();
  const rows = await sql`SELECT urutan, label, target_type, hod_key, wa_number_override, catatan FROM approval_chain_config ORDER BY urutan`;
  return rows.map((r) => ({
    urutan: Number(r.urutan),
    label: String(r.label),
    targetType: r.target_type as "hod" | "direktur",
    hodKey: r.hod_key ? String(r.hod_key) : null,
    waNumberOverride: r.wa_number_override ? String(r.wa_number_override) : null,
    catatan: r.catatan ? String(r.catatan) : null,
  }));
}

export interface ChainConfigPatch {
  hodKey?: string | null;
  waNumberOverride?: string | null;
}

export async function updateChainConfig(urutan: number, patch: ChainConfigPatch): Promise<{ ok: boolean; error?: string }> {
  const sql = db();
  const rows = await sql`SELECT urutan FROM approval_chain_config WHERE urutan = ${urutan}`;
  if (rows.length === 0) return { ok: false, error: `tahap urutan ${urutan} tidak ditemukan` };
  await sql`
    UPDATE approval_chain_config SET
      hod_key = ${patch.hodKey === undefined ? sql`hod_key` : patch.hodKey},
      wa_number_override = ${patch.waNumberOverride === undefined ? sql`wa_number_override` : patch.waNumberOverride},
      updated_at = now()
    WHERE urutan = ${urutan}
  `;
  return { ok: true };
}

interface ResolvedTarget {
  waNumber: string;
  name: string;
}

// Resolusi target notifikasi 1 tahap. NULL = belum bisa dikirim (kontak
// belum dikonfigurasi ATAU app_user-nya belum py wa_number) — ini state SAH,
// bukan exception, jadi dikembalikan sbg null, bukan throw.
async function resolveStepTarget(step: { id: number; urutan: number; target_type: string; hod_key: string | null }): Promise<ResolvedTarget | null> {
  const sql = db();
  // Config LIVE selalu dicek (bukan cuma saat snapshot kosong) — wa_number_override
  // butuh ini juga, dan hod_key di-snapshot NULL berarti "belum dikonfigurasi
  // SAAT request dibuat", BUKAN keputusan permanen yg wajib dijaga historis
  // (beda dari hod_key yg SUDAH terisi, itu tetap dipertahankan apa adanya
  // walau config global berubah nanti). Backfill snapshot kalau config live
  // sudah diisi belakangan — inilah yg bikin endpoint retry-notify
  // (POST /approval-requests/:id/notify) beneran berguna, bukan percuma.
  const [cfg] = await sql`SELECT hod_key, wa_number_override FROM approval_chain_config WHERE urutan = ${step.urutan}`;
  const override = cfg?.wa_number_override ? String(cfg.wa_number_override) : null;
  if (override) return { waNumber: override, name: `(override tahap ${step.urutan})` };

  if (step.target_type === "direktur") {
    const rows = await sql`SELECT name, wa_number FROM app_user WHERE role = 'direktur' AND wa_number IS NOT NULL AND wa_number <> '' ORDER BY created_at LIMIT 1`;
    if (rows.length === 0) return null;
    return { waNumber: String(rows[0].wa_number), name: rows[0].name ? String(rows[0].name) : "Direktur" };
  }

  let hodKey = step.hod_key;
  if (!hodKey && cfg?.hod_key) {
    hodKey = String(cfg.hod_key);
    await sql`UPDATE approval_step SET hod_key = ${hodKey} WHERE id = ${step.id}`;
  }
  if (!hodKey) return null;
  const rows = await sql`SELECT name, wa_number FROM app_user WHERE hod_key = ${hodKey} AND wa_number IS NOT NULL AND wa_number <> '' ORDER BY created_at LIMIT 1`;
  if (rows.length === 0) return null;
  return { waNumber: String(rows[0].wa_number), name: rows[0].name ? String(rows[0].name) : hodKey };
}

function generateKode(seq: number): string {
  return `APR-${String(seq).padStart(4, "0")}`;
}

async function logAudit(eventType: string, actor: string | null | undefined, payload: Record<string, unknown>, decision: string): Promise<void> {
  const sql = db();
  const hash = createHash("sha256").update(JSON.stringify({ eventType, payload })).digest("hex");
  // agent_id FK ke agent_registry (cuma A1-A12) — F11 bukan agen LLM, tapi
  // audit trail approval tetap berharga dicatat. Dipilih 'A3' (Sari
  // Collection, R2/human-decision paling mirip) drpd nambah agent_registry
  // baru cuma buat satu FK ini; kalau nanti butuh identitas sendiri, bikin
  // baris agent_registry 'F11' + migrasi kecil.
  await sql`
    INSERT INTO audit_log (use_case_id, correlation_id, agent_id, layer, event_type, r_tier, input_hash, output_hash, payload, human_actor, decision)
    VALUES ('D1', ${`apr-${hash.slice(0, 8)}`}, 'A3', 5, ${eventType}, 'R2', ${hash}, ${hash}, ${sql.json(payload as unknown as Parameters<typeof sql.json>[0])}, ${actor ?? null}, ${decision})
  `;
}

export interface NotifyResult {
  ok: boolean;
  error?: string;
  waNumber?: string;
}

// Kirim/kirim-ulang notifikasi tahap CURRENT punya 1 request. Dipanggil saat
// request dibuat & saat tahap sebelumnya approve (advance ke tahap
// berikutnya) — DAN bisa dipanggil manual (retry) via API kalau kontak baru
// diisi setelah sempat gagal.
export async function notifyCurrentStep(requestId: string): Promise<NotifyResult> {
  const sql = db();
  const [req] = await sql`SELECT id, kode, title, description, nominal, status, current_urutan FROM approval_request WHERE id = ${requestId}`;
  if (!req) return { ok: false, error: "request tidak ditemukan" };
  if (req.status !== "pending") return { ok: false, error: `request sudah ${req.status}` };
  const [step] = await sql`SELECT id, urutan, label, target_type, hod_key, status FROM approval_step WHERE request_id = ${requestId} AND urutan = ${req.current_urutan}`;
  if (!step) return { ok: false, error: "tahap current tidak ditemukan" };
  if (step.status !== "pending") return { ok: false, error: `tahap ini sudah ${step.status}` };

  const target = await resolveStepTarget({
    id: Number(step.id),
    urutan: Number(step.urutan),
    target_type: String(step.target_type),
    hod_key: step.hod_key ? String(step.hod_key) : null,
  });
  if (!target) {
    return { ok: false, error: `kontak "${step.label}" belum dikonfigurasi — isi dulu di halaman config` };
  }

  const nominalLine = req.nominal != null ? `\nNominal: Rp${Number(req.nominal).toLocaleString("id-ID")}` : "";
  // Lampiran dikirim sbg LINK web (bukan file media WA) — gateway openclaw
  // yg dipakai sekarang cuma terima {to, message} teks (lihat wasend.ts),
  // tak ada kontrak kirim media. Link tetap ke halaman dashboard (bukan API
  // langsung) supaya lewat gerbang sesi (middleware.ts) yg sudah ada.
  const [{ count: attachCount }] = await sql`SELECT count(*)::int AS count FROM approval_attachment WHERE request_id = ${requestId}`;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const attachLine = Number(attachCount) > 0 ? `\n📎 ${attachCount} lampiran — lihat di ${appUrl}/approval-requests/${requestId}\n` : "";
  const msg =
    `🔔 *Permintaan Approval* (${step.label})\n\n` +
    `${req.title}${nominalLine}\n${req.description ? `${req.description}\n` : ""}${attachLine}` +
    `Diajukan oleh: ${req.requested_by ?? "-"}\n\n` +
    `Kode: *${req.kode}*\n` +
    `Balas *#APPROVE ${req.kode}* untuk setujui, atau *#REJECT ${req.kode} <alasan>* untuk tolak.`;

  const gw = await sendViaWaGateway(target.waNumber, msg);
  await sql`UPDATE approval_step SET notified_at = now() WHERE id = ${step.id}`;
  await logAudit("approval.notify", null, { request_id: requestId, kode: req.kode, urutan: step.urutan, target: target.waNumber, gateway: gw }, "notify");
  return { ok: true, waNumber: target.waNumber };
}

export interface AttachmentInput {
  filename: string;
  mimeType: string;
  dataBase64: string;
}

export interface CreateApprovalInput {
  title: string;
  description?: string | null;
  nominal?: number | null;
  requestedBy: string;
  requestedByWa?: string | null;
  attachments?: AttachmentInput[];
}

export interface CreateApprovalResult {
  ok: boolean;
  error?: string;
  id?: string;
  kode?: string;
  notify?: NotifyResult;
}

// Validasi SEMUA lampiran DULU (mime, ukuran, base64 valid) sebelum baris
// apa pun disimpan ke DB — cegah state setengah-jadi (request kebentuk tapi
// lampirannya cuma sebagian krn salah 1 file di tengah gagal).
function validateAttachments(attachments: AttachmentInput[]): { ok: true; buffers: Buffer[] } | { ok: false; error: string } {
  const buffers: Buffer[] = [];
  for (const a of attachments) {
    if (!ALLOWED_MIME.has(a.mimeType)) {
      return { ok: false, error: `"${a.filename}": tipe file "${a.mimeType}" tidak didukung — cuma PDF atau PNG` };
    }
    let buf: Buffer;
    try {
      buf = Buffer.from(a.dataBase64, "base64");
    } catch {
      return { ok: false, error: `"${a.filename}": data base64 tidak valid` };
    }
    if (buf.length === 0) return { ok: false, error: `"${a.filename}": file kosong` };
    if (buf.length > MAX_ATTACHMENT_BYTES) {
      return { ok: false, error: `"${a.filename}": ukuran ${(buf.length / 1024 / 1024).toFixed(1)}MB melebihi batas 8MB` };
    }
    buffers.push(buf);
  }
  return { ok: true, buffers };
}

async function saveAttachment(requestId: string, input: AttachmentInput, buf: Buffer): Promise<void> {
  const sql = db();
  const ext = input.mimeType === "application/pdf" ? "pdf" : "png";
  const relPath = join(requestId, `${randomUUID()}.${ext}`);
  const absPath = join(APPROVAL_UPLOAD_ROOT, relPath);
  await mkdir(join(APPROVAL_UPLOAD_ROOT, requestId), { recursive: true });
  await writeFile(absPath, buf);
  await sql`
    INSERT INTO approval_attachment (request_id, filename, mime_type, file_path, file_size)
    VALUES (${requestId}, ${input.filename}, ${input.mimeType}, ${relPath}, ${buf.length})
  `;
}

export async function createApprovalRequest(input: CreateApprovalInput): Promise<CreateApprovalResult> {
  if (!isDbEnabled()) return { ok: false, error: "DATABASE_URL off" };
  if (!input.title?.trim()) return { ok: false, error: "title wajib" };
  if (!input.requestedBy?.trim()) return { ok: false, error: "requestedBy wajib" };
  const sql = db();

  const attachments = input.attachments ?? [];
  const validated = validateAttachments(attachments);
  if (!validated.ok) return { ok: false, error: validated.error };

  const chain = await listChainConfig();
  if (chain.length === 0) return { ok: false, error: "approval_chain_config kosong — seed migrasi 106 belum jalan?" };

  const [{ nextval }] = await sql`SELECT nextval('approval_request_kode_seq') AS nextval`;
  const kode = generateKode(Number(nextval));

  const [reqRow] = await sql`
    INSERT INTO approval_request (kode, title, description, nominal, requested_by, requested_by_wa, current_urutan)
    VALUES (${kode}, ${input.title}, ${input.description ?? null}, ${input.nominal ?? null}, ${input.requestedBy}, ${input.requestedByWa ?? null}, ${chain[0].urutan})
    RETURNING id
  `;
  const requestId = String(reqRow.id);

  for (const c of chain) {
    await sql`
      INSERT INTO approval_step (request_id, urutan, label, target_type, hod_key)
      VALUES (${requestId}, ${c.urutan}, ${c.label}, ${c.targetType}, ${c.hodKey})
    `;
  }

  for (let i = 0; i < attachments.length; i++) {
    await saveAttachment(requestId, attachments[i], validated.buffers[i]);
  }

  await logAudit("approval.request.create", input.requestedBy, { request_id: requestId, kode, title: input.title, attachments: attachments.length }, "create");
  const notify = await notifyCurrentStep(requestId);
  return { ok: true, id: requestId, kode, notify };
}

export interface ApprovalStepRow {
  urutan: number;
  label: string;
  status: string;
  notifiedAt: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
}

export interface ApprovalAttachmentRow {
  id: number;
  filename: string;
  mimeType: string;
  fileSize: number;
  uploadedAt: string;
}

export interface ApprovalRequestDetail {
  id: string;
  kode: string;
  title: string;
  description: string | null;
  nominal: number | null;
  requestedBy: string;
  status: string;
  currentUrutan: number | null;
  createdAt: string;
  decidedAt: string | null;
  steps: ApprovalStepRow[];
  attachments: ApprovalAttachmentRow[];
}

export async function getApprovalRequest(id: string): Promise<ApprovalRequestDetail | null> {
  const sql = db();
  const rows = await sql`
    SELECT id, kode, title, description, nominal, requested_by, status, current_urutan, created_at::text, decided_at::text
    FROM approval_request WHERE id = ${id}
  `;
  if (rows.length === 0) return null;
  const r = rows[0];
  const stepRows = await sql`
    SELECT urutan, label, status, notified_at::text, decided_by, decided_at::text, decision_note
    FROM approval_step WHERE request_id = ${id} ORDER BY urutan
  `;
  const attachmentRows = await sql`
    SELECT id, filename, mime_type, file_size, uploaded_at::text
    FROM approval_attachment WHERE request_id = ${id} ORDER BY id
  `;
  return {
    id: String(r.id),
    kode: String(r.kode),
    title: String(r.title),
    description: r.description ? String(r.description) : null,
    nominal: r.nominal != null ? Number(r.nominal) : null,
    requestedBy: String(r.requested_by),
    status: String(r.status),
    currentUrutan: r.current_urutan != null ? Number(r.current_urutan) : null,
    createdAt: String(r.created_at),
    decidedAt: r.decided_at ? String(r.decided_at) : null,
    steps: stepRows.map((s) => ({
      urutan: Number(s.urutan),
      label: String(s.label),
      status: String(s.status),
      notifiedAt: s.notified_at ? String(s.notified_at) : null,
      decidedBy: s.decided_by ? String(s.decided_by) : null,
      decidedAt: s.decided_at ? String(s.decided_at) : null,
      decisionNote: s.decision_note ? String(s.decision_note) : null,
    })),
    attachments: attachmentRows.map((a) => ({
      id: Number(a.id),
      filename: String(a.filename),
      mimeType: String(a.mime_type),
      fileSize: Number(a.file_size),
      uploadedAt: String(a.uploaded_at),
    })),
  };
}

// Baca 1 lampiran dari disk (path-safe — file_path DB relatif, join di
// dalam APPROVAL_UPLOAD_ROOT, tak ada input user yg jadi path mentah).
export async function getAttachmentFile(
  requestId: string,
  attachmentId: number,
): Promise<{ buf: Buffer; mimeType: string; filename: string } | null> {
  const sql = db();
  const rows = await sql`
    SELECT filename, mime_type, file_path FROM approval_attachment
    WHERE id = ${attachmentId} AND request_id = ${requestId}
  `;
  if (rows.length === 0) return null;
  const r = rows[0];
  const absPath = join(APPROVAL_UPLOAD_ROOT, String(r.file_path));
  const resolved = resolve(absPath);
  if (resolved !== APPROVAL_UPLOAD_ROOT && !resolved.startsWith(APPROVAL_UPLOAD_ROOT + "/") && !resolved.startsWith(APPROVAL_UPLOAD_ROOT + "\\")) {
    return null; // jaga-jaga, walau file_path selalu dari randomUUID() sendiri, bukan input luar
  }
  const buf = await readFile(resolved);
  return { buf, mimeType: String(r.mime_type), filename: String(r.filename) };
}

export async function listApprovalRequests(status?: string): Promise<ApprovalRequestDetail[]> {
  const sql = db();
  const rows = await sql`
    SELECT id FROM approval_request
    WHERE ${status ? sql`status = ${status}` : sql`true`}
    ORDER BY created_at DESC LIMIT 100
  `;
  const details = await Promise.all(rows.map((r) => getApprovalRequest(String(r.id))));
  return details.filter((d): d is ApprovalRequestDetail => d !== null);
}

// Identitas approver dari nomor WA pengirim — BEDA dari resolveSender()
// (master.ts, roster AM) krn approver F11 itu HoD/Direktur = akun dashboard
// (app_user), bukan AM. Pola sama (normalize+match), sumber tabel beda.
export interface ResolvedApprover {
  userId: string;
  name: string;
  hodKey: string | null;
  role: string;
}

export async function resolveApprover(senderJid: string | null | undefined): Promise<ResolvedApprover | null> {
  if (!senderJid) return null;
  const num = String(senderJid).split("@")[0].split(":")[0];
  const norm = normalizeWa(num);
  if (!norm) return null;
  const sql = db();
  const rows = await sql`
    SELECT id, name, hod_key, role FROM app_user
    WHERE active = true AND regexp_replace(COALESCE(wa_number, ''), '[^0-9]', '', 'g') = ${norm}
  `;
  if (rows.length === 0) return null;
  const r = rows[0];
  return { userId: String(r.id), name: r.name ? String(r.name) : "-", hodKey: r.hod_key ? String(r.hod_key) : null, role: String(r.role) };
}

export interface DecideResult {
  ok: boolean;
  error?: string;
  status?: string;
  nextNotify?: NotifyResult;
}

// #APPROVE/#REJECT <kode> [alasan] dari WA privat. Approver DIVALIDASI harus
// pemegang tahap CURRENT persis (bukan cuma "app_user hod/direktur mana
// saja") — cegah HoD tahap lain nyelonong approve giliran orang lain.
export async function decideCurrentStep(
  kode: string,
  action: "approve" | "reject",
  approver: ResolvedApprover,
  note?: string | null,
): Promise<DecideResult> {
  const sql = db();
  const [req] = await sql`SELECT id, status, current_urutan, requested_by_wa, title FROM approval_request WHERE kode = ${kode}`;
  if (!req) return { ok: false, error: `kode "${kode}" tidak ditemukan` };
  if (req.status !== "pending") return { ok: false, error: `request ini sudah ${req.status}` };

  const [step] = await sql`SELECT id, urutan, target_type, hod_key, status FROM approval_step WHERE request_id = ${req.id} AND urutan = ${req.current_urutan}`;
  if (!step || step.status !== "pending") return { ok: false, error: "tahap current tidak valid" };

  const matches =
    step.target_type === "direktur" ? approver.role === "direktur" : step.hod_key !== null && step.hod_key === approver.hodKey;
  if (!matches) return { ok: false, error: "bukan giliran kamu approve/reject permintaan ini" };

  if (action === "reject") {
    await sql`UPDATE approval_step SET status = 'rejected', decided_by = ${approver.name}, decided_at = now(), decision_note = ${note ?? null} WHERE id = ${step.id}`;
    await sql`UPDATE approval_request SET status = 'rejected', decided_at = now() WHERE id = ${req.id}`;
    await logAudit("approval.reject", approver.name, { request_id: req.id, kode, urutan: step.urutan, note }, "reject");
    if (req.requested_by_wa) {
      await sendViaWaGateway(String(req.requested_by_wa), `❌ Permintaan "${req.title}" (${kode}) DITOLAK oleh ${approver.name}${note ? `: ${note}` : ""}.`);
    }
    return { ok: true, status: "rejected" };
  }

  await sql`UPDATE approval_step SET status = 'approved', decided_by = ${approver.name}, decided_at = now() WHERE id = ${step.id}`;
  await logAudit("approval.approve", approver.name, { request_id: req.id, kode, urutan: step.urutan }, "approve");

  const [{ max_urutan }] = await sql`SELECT max(urutan) AS max_urutan FROM approval_step WHERE request_id = ${req.id}`;
  if (Number(step.urutan) >= Number(max_urutan)) {
    await sql`UPDATE approval_request SET status = 'approved', decided_at = now() WHERE id = ${req.id}`;
    if (req.requested_by_wa) {
      await sendViaWaGateway(String(req.requested_by_wa), `✅ Permintaan "${req.title}" (${kode}) DISETUJUI semua tahap.`);
    }
    return { ok: true, status: "approved" };
  }

  await sql`UPDATE approval_request SET current_urutan = current_urutan + 1 WHERE id = ${req.id}`;
  const nextNotify = await notifyCurrentStep(String(req.id));
  return { ok: true, status: "pending", nextNotify };
}
