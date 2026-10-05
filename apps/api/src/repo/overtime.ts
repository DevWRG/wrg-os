// #OVERTIME — pengajuan jam lembur via WA (SEBELUM lembur), migrasi 193.
//
// Satu tahap approval oleh HoD divisi pengaju. SENGAJA bukan engine F11
// (approval.ts): chain itu global 5 tahap dan masih tersangkut #1071. Pola
// yang ditiru leave_pending — tabel & status sendiri.
//
// Pengaju yang boleh mengajukan diatur dinamis lewat overtime_rule (dept /
// pola posisi / pengecualian per orang). HoD tak ketemu → pengajuan TETAP
// dicatat (keputusan PM), menunggu admin menetapkan HoD lewat assignHod().

import { db } from "../db.js";
import { sendViaWaGateway } from "../wasend.js";
import { formatDurasi } from "../parsers/overtime.js";

const wibDate = (): string => new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);

// ── Aturan siapa boleh mengajukan ────────────────────────────────────────────

export interface OvertimeRule {
  id: number;
  dept: string | null;
  posisi_pattern: string | null;
  am_id: string | null;
  catatan: string | null;
  aktif: boolean;
  created_by: string | null;
  created_at: string;
}

export async function listRules(): Promise<OvertimeRule[]> {
  const sql = db();
  const rows = await sql`
    SELECT id, dept, posisi_pattern, am_id, catatan, aktif, created_by, created_at::text AS created_at
    FROM overtime_rule ORDER BY aktif DESC, id
  `;
  return rows.map((r) => ({
    id: Number(r.id),
    dept: r.dept ? String(r.dept) : null,
    posisi_pattern: r.posisi_pattern ? String(r.posisi_pattern) : null,
    am_id: r.am_id ? String(r.am_id) : null,
    catatan: r.catatan ? String(r.catatan) : null,
    aktif: Boolean(r.aktif),
    created_by: r.created_by ? String(r.created_by) : null,
    created_at: String(r.created_at),
  }));
}

const clean = (v: unknown): string | null => {
  const s = typeof v === "string" ? v.trim() : "";
  return s ? s : null;
};

export async function createRule(input: {
  dept?: string | null;
  posisi_pattern?: string | null;
  am_id?: string | null;
  catatan?: string | null;
  created_by?: string | null;
}): Promise<{ ok: true; id: number } | { ok: false; error: string }> {
  const dept = clean(input.dept);
  const posisi = clean(input.posisi_pattern);
  const amId = clean(input.am_id);
  if (!dept && !posisi && !amId) return { ok: false, error: "isi minimal satu: divisi, pola posisi, atau orang" };
  const sql = db();
  const [r] = await sql`
    INSERT INTO overtime_rule (dept, posisi_pattern, am_id, catatan, created_by)
    VALUES (${dept}, ${posisi}, ${amId}, ${clean(input.catatan)}, ${clean(input.created_by)})
    RETURNING id
  `;
  return { ok: true, id: Number(r.id) };
}

export async function setRuleAktif(id: number, aktif: boolean): Promise<{ ok: boolean; error?: string }> {
  const sql = db();
  const rows = await sql`UPDATE overtime_rule SET aktif = ${aktif} WHERE id = ${id} RETURNING id`;
  return rows.length ? { ok: true } : { ok: false, error: "aturan tidak ditemukan" };
}

export async function deleteRule(id: number): Promise<{ ok: boolean; error?: string }> {
  const sql = db();
  const rows = await sql`DELETE FROM overtime_rule WHERE id = ${id} RETURNING id`;
  return rows.length ? { ok: true } : { ok: false, error: "aturan tidak ditemukan" };
}

// Pilihan untuk form aturan: divisi (department) + orang aktif di master_user.
export async function listRuleOptions(): Promise<{
  departments: { key: string; label: string }[];
  people: { am_id: string; nama: string; posisi: string | null }[];
}> {
  const sql = db();
  const deps = await sql`SELECT key, label FROM department ORDER BY label`;
  const people = await sql`SELECT am_id, nama, posisi FROM master_user WHERE aktif = true ORDER BY nama`;
  return {
    departments: deps.map((d) => ({ key: String(d.key), label: String(d.label) })),
    people: people.map((p) => ({ am_id: String(p.am_id), nama: String(p.nama), posisi: p.posisi ? String(p.posisi) : null })),
  };
}

export interface PengajuProfile {
  am_id: string;
  nama: string;
  dept: string | null;
  posisi: string | null;
  hod_key: string | null;
}

// Profil pengaju: master_user (nama, posisi) + employee (dept, hod_key) lewat
// am_id. Keduanya bisa kosong — staf yang tak punya baris employee tetap bisa
// lolos lewat pengecualian per orang (rule.am_id).
export async function getPengajuProfile(amId: string, namaFallback: string): Promise<PengajuProfile> {
  const sql = db();
  const [mu] = await sql`SELECT nama, posisi FROM master_user WHERE am_id = ${amId} LIMIT 1`;
  const [emp] = await sql`SELECT dept, role, hod_key FROM employee WHERE am_id = ${amId} ORDER BY created_at LIMIT 1`;
  const posisiParts = [mu?.posisi, emp?.role].map((x) => (x ? String(x).trim() : "")).filter(Boolean);
  return {
    am_id: amId,
    nama: mu?.nama ? String(mu.nama) : namaFallback,
    dept: emp?.dept ? String(emp.dept) : null,
    posisi: posisiParts.length ? posisiParts.join(" | ") : null,
    hod_key: emp?.hod_key ? String(emp.hod_key) : null,
  };
}

// Cocok kalau ADA aturan aktif yang lolos. position() dipakai (bukan ILIKE)
// supaya karakter % / _ di pola admin tak jadi wildcard.
export async function isEligible(p: PengajuProfile): Promise<boolean> {
  const sql = db();
  const rows = await sql`
    SELECT 1 FROM overtime_rule r
    WHERE r.aktif AND (
      r.am_id = ${p.am_id}
      OR (
        r.am_id IS NULL
        AND (r.dept IS NULL OR r.dept = ${p.dept})
        AND (r.posisi_pattern IS NULL
             OR position(lower(r.posisi_pattern) in lower(COALESCE(${p.posisi}, ''))) > 0)
      )
    )
    LIMIT 1
  `;
  return rows.length > 0;
}

// ── Approver ─────────────────────────────────────────────────────────────────

interface Target { waNumber: string; name: string }

// Resolve LIVE tiap kirim (bukan snapshot) — pola sama resolveStepTarget F11.
async function resolveHodTarget(hodKey: string): Promise<Target | { gagal: string }> {
  const sql = db();
  const rows = await sql`
    SELECT name, wa_number FROM app_user
    WHERE hod_key = ${hodKey} AND active = true AND wa_number IS NOT NULL AND wa_number <> ''
    ORDER BY created_at LIMIT 1
  `;
  if (rows.length > 0) return { waNumber: String(rows[0].wa_number), name: rows[0].name ? String(rows[0].name) : hodKey };
  const [tanpaWa] = await sql`SELECT name FROM app_user WHERE hod_key = ${hodKey} AND active = true ORDER BY created_at LIMIT 1`;
  return {
    gagal: tanpaWa
      ? `akun HoD "${hodKey}" belum punya nomor WA (isi di menu Pengguna)`
      : `belum ada akun dashboard dengan hod_key "${hodKey}" (tautkan di menu Pengguna)`,
  };
}

// ── Pengajuan ────────────────────────────────────────────────────────────────

export interface OvertimeRow {
  id: number;
  kode: string;
  am_id: string;
  nama: string;
  dept: string | null;
  tanggal_lembur: string;
  estimasi_menit: number;
  uraian: string;
  status: "pending" | "approved" | "rejected";
  hod_key: string | null;
  approver_nama: string | null;
  notify_status: string | null;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
  created_at: string;
}

const SELECT_COLS = `id, kode, am_id, nama, dept, tanggal_lembur::text AS tanggal_lembur, estimasi_menit, uraian, status,
  hod_key, approver_nama, notify_status, decided_by, decided_at::text AS decided_at, decision_note, created_at::text AS created_at`;

function mapRow(r: Record<string, unknown>): OvertimeRow {
  const s = (v: unknown): string | null => (v == null ? null : String(v));
  return {
    id: Number(r.id),
    kode: String(r.kode),
    am_id: String(r.am_id),
    nama: String(r.nama),
    dept: s(r.dept),
    tanggal_lembur: String(r.tanggal_lembur),
    estimasi_menit: Number(r.estimasi_menit),
    uraian: String(r.uraian),
    status: String(r.status) as OvertimeRow["status"],
    hod_key: s(r.hod_key),
    approver_nama: s(r.approver_nama),
    notify_status: s(r.notify_status),
    decided_by: s(r.decided_by),
    decided_at: s(r.decided_at),
    decision_note: s(r.decision_note),
    created_at: String(r.created_at),
  };
}

export type SubmitResult =
  | { ok: true; row: OvertimeRow; duplicate?: boolean; notify: { ok: boolean; error?: string } }
  | { ok: false; error: "tidak-berhak" | "gagal"; message?: string };

export async function submitOvertime(input: {
  profile: PengajuProfile;
  menit: number;
  uraian: string;
  group_jid: string | null;
  wa_message_id: string | null;
}): Promise<SubmitResult> {
  const sql = db();
  const p = input.profile;
  if (!(await isEligible(p))) return { ok: false, error: "tidak-berhak" };

  // Retry webhook → pesan yang sama tak boleh bikin pengajuan ganda.
  if (input.wa_message_id) {
    const [dup] = await sql.unsafe(`SELECT ${SELECT_COLS} FROM overtime_request WHERE wa_message_id = $1`, [input.wa_message_id]);
    if (dup) return { ok: true, row: mapRow(dup), duplicate: true, notify: { ok: true } };
  }

  const [{ seq }] = await sql`SELECT nextval('overtime_request_kode_seq') AS seq`;
  const kode = `OT-${String(Number(seq)).padStart(4, "0")}`;
  const [ins] = await sql`
    INSERT INTO overtime_request (kode, am_id, nama, dept, tanggal_lembur, estimasi_menit, uraian, hod_key, group_jid, wa_message_id)
    VALUES (${kode}, ${p.am_id}, ${p.nama}, ${p.dept}, ${wibDate()}, ${input.menit}, ${input.uraian}, ${p.hod_key}, ${input.group_jid}, ${input.wa_message_id})
    RETURNING id
  `;
  const id = Number(ins.id);
  const notify = await notifyApprover(id);
  const row = await getOvertime(id);
  if (!row) return { ok: false, error: "gagal", message: "pengajuan tersimpan tapi gagal dibaca ulang" };
  return { ok: true, row, notify };
}

export async function getOvertime(id: number): Promise<OvertimeRow | null> {
  const sql = db();
  const [r] = await sql.unsafe(`SELECT ${SELECT_COLS} FROM overtime_request WHERE id = $1`, [id]);
  return r ? mapRow(r) : null;
}

export async function listOvertime(filter: { status?: string; from?: string; to?: string; hod_key?: string; limit?: number }): Promise<OvertimeRow[]> {
  const sql = db();
  const conds: string[] = [];
  const params: unknown[] = [];
  const add = (cond: string, v: unknown) => {
    params.push(v);
    conds.push(cond.replace("?", `$${params.length}`));
  };
  if (filter.status && ["pending", "approved", "rejected"].includes(filter.status)) add("status = ?", filter.status);
  if (filter.from && /^\d{4}-\d{2}-\d{2}$/.test(filter.from)) add("tanggal_lembur >= ?::date", filter.from);
  if (filter.to && /^\d{4}-\d{2}-\d{2}$/.test(filter.to)) add("tanggal_lembur <= ?::date", filter.to);
  if (filter.hod_key) add("hod_key = ?", filter.hod_key);
  const limit = Math.min(Math.max(Number(filter.limit) || 200, 1), 1000);
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  const rows = await sql.unsafe(
    `SELECT ${SELECT_COLS} FROM overtime_request ${where} ORDER BY created_at DESC LIMIT ${limit}`,
    params as never[],
  );
  return rows.map((r) => mapRow(r));
}

// Kirim / kirim-ulang notifikasi ke HoD. Hasilnya dicatat ke notify_status
// supaya admin bisa melihat kenapa pengajuan "menggantung" tanpa membuka log.
export async function notifyApprover(id: number): Promise<{ ok: boolean; error?: string }> {
  const sql = db();
  const row = await getOvertime(id);
  if (!row) return { ok: false, error: "pengajuan tidak ditemukan" };
  if (row.status !== "pending") return { ok: false, error: `pengajuan sudah ${row.status}` };

  const simpan = async (status: string, nama: string | null) => {
    await sql`UPDATE overtime_request SET notify_status = ${status}, approver_nama = COALESCE(${nama}, approver_nama) WHERE id = ${id}`;
  };

  if (!row.hod_key) {
    const err = "HoD divisi belum ketahuan — menunggu admin menetapkan HoD";
    await simpan(`gagal: ${err}`, null);
    return { ok: false, error: err };
  }
  const target = await resolveHodTarget(row.hod_key);
  if ("gagal" in target) {
    await simpan(`gagal: ${target.gagal}`, null);
    return { ok: false, error: target.gagal };
  }
  const msg =
    `🕒 *Pengajuan Lembur* ${row.kode}\n\n` +
    `${row.nama}${row.dept ? ` (${row.dept})` : ""}\n` +
    `Tanggal: ${row.tanggal_lembur}\n` +
    `Estimasi: ${formatDurasi(row.estimasi_menit)}\n` +
    `Pekerjaan: ${row.uraian}\n\n` +
    `Balas *#APPROVE ${row.kode}* untuk setujui, atau *#REJECT ${row.kode} <alasan>* untuk tolak.`;
  const gw = await sendViaWaGateway(target.waNumber, msg);
  if (!gw.sent) {
    await simpan("gagal: pengiriman WA ke HoD gagal", target.name);
    return { ok: false, error: "pengiriman WA ke HoD gagal" };
  }
  await simpan("terkirim", target.name);
  return { ok: true };
}

// Admin menetapkan / mengganti HoD sebuah pengajuan lalu memicu notifikasi.
export async function assignHod(id: number, hodKey: string): Promise<{ ok: boolean; error?: string; notify?: { ok: boolean; error?: string } }> {
  const sql = db();
  const key = hodKey.trim();
  if (!key) return { ok: false, error: "hod_key kosong" };
  const rows = await sql`UPDATE overtime_request SET hod_key = ${key} WHERE id = ${id} AND status = 'pending' RETURNING id`;
  if (!rows.length) return { ok: false, error: "pengajuan tidak ditemukan atau sudah diputus" };
  return { ok: true, notify: await notifyApprover(id) };
}

// ── Keputusan ────────────────────────────────────────────────────────────────

export interface OvertimeActor {
  name: string;
  hodKey: string | null;
  // admin / superuser / direktur boleh memutus pengajuan divisi mana pun.
  privileged: boolean;
}

export type DecideResult = { ok: true; row: OvertimeRow } | { ok: false; error: string };

// Dipakai dua jalur sekaligus: balasan WA (#APPROVE OT-0001) dan tombol
// dashboard. Otorisasi di SINI, bukan di pemanggil, supaya kedua jalur tak bisa
// menyimpang.
export async function decideOvertime(
  ref: { kode: string } | { id: number },
  action: "approve" | "reject",
  actor: OvertimeActor,
  note?: string | null,
): Promise<DecideResult> {
  const sql = db();
  const [found] =
    "kode" in ref
      ? await sql.unsafe(`SELECT ${SELECT_COLS}, group_jid FROM overtime_request WHERE kode = $1`, [ref.kode.toUpperCase()])
      : await sql.unsafe(`SELECT ${SELECT_COLS}, group_jid FROM overtime_request WHERE id = $1`, [ref.id]);
  if (!found) return { ok: false, error: "pengajuan tidak ditemukan" };
  const cur = mapRow(found);
  if (cur.status !== "pending") return { ok: false, error: `pengajuan ini sudah ${cur.status}` };

  const berwenang = actor.privileged || (cur.hod_key !== null && cur.hod_key === actor.hodKey);
  if (!berwenang) return { ok: false, error: "bukan HoD divisi pengaju — tidak berwenang memutus pengajuan ini" };

  const status = action === "approve" ? "approved" : "rejected";
  // WHERE status='pending' menjaga race dua HoD/klik ganda: yang kalah dapat 0 baris.
  const upd = await sql`
    UPDATE overtime_request SET status = ${status}, decided_by = ${actor.name}, decided_at = now(), decision_note = ${note ?? null}
    WHERE id = ${cur.id} AND status = 'pending' RETURNING id
  `;
  if (!upd.length) return { ok: false, error: "pengajuan sudah diputus orang lain" };

  const row = (await getOvertime(cur.id)) ?? { ...cur, status };
  if (found.group_jid) {
    const teks =
      action === "approve"
        ? `✅ Lembur ${row.kode} (${row.nama}, ${formatDurasi(row.estimasi_menit)}) DISETUJUI oleh ${actor.name}.`
        : `❌ Lembur ${row.kode} (${row.nama}) DITOLAK oleh ${actor.name}${note ? `: ${note}` : ""}.`;
    await sendViaWaGateway(String(found.group_jid), teks);
  }
  return { ok: true, row };
}
