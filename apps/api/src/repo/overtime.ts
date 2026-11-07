// #OVERTIME — pengajuan jam lembur via WA (SEBELUM lembur), migrasi 193.
//
// Satu tahap approval oleh HoD divisi pengaju. Sejak migrasi 251 keputusannya
// lewat mesin approval F11 (alur 'lembur', overtime_request.approval_request_id):
// WA ke HoD, #APPROVE, SLA, larangan memutus pengajuan sendiri. Kode OT-xxxx
// tetap jadi pegangan pengaju & grup; #APPROVE OT-xxxx diteruskan ke approval-nya.
//
// Pengaju yang boleh mengajukan diatur dinamis lewat overtime_rule (dept /
// pola posisi / pengecualian per orang). HoD tak ketemu → pengajuan TETAP
// dicatat (keputusan PM), menunggu admin menetapkan HoD lewat assignHod().

import type { TransactionSql } from "postgres";

import { db } from "../db.js";
import { sendViaWaGateway } from "../wasend.js";
import { formatDurasi } from "../parsers/overtime.js";
import {
  buatRequestDalamTx,
  daftarKonsumen,
  decideCurrentStep,
  decideFromDashboard,
  gantiHodTahapCurrent,
  notifyCurrentStep,
  type ResolvedApprover,
} from "./approval.js";

type Tx = TransactionSql<Record<string, unknown>>;
export const JENIS_LEMBUR = "lembur";
const REF_TABEL = "overtime_request";

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
  // Approval di mesin F11 (null = diputus sebelum 251, atau HoD belum ditetapkan).
  approval_request_id: string | null;
  approval_kode: string | null;
}

const SELECT_COLS = `id, kode, am_id, nama, dept, tanggal_lembur::text AS tanggal_lembur, estimasi_menit, uraian, status,
  hod_key, approver_nama, notify_status, decided_by, decided_at::text AS decided_at, decision_note, created_at::text AS created_at,
  approval_request_id,
  (SELECT r.kode FROM approval_request r WHERE r.id = overtime_request.approval_request_id) AS approval_kode`;

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
    approval_request_id: s(r.approval_request_id),
    approval_kode: s(r.approval_kode),
  };
}

// Buka approval untuk satu pengajuan yang HoD-nya sudah diketahui — di
// transaksi pemanggil; WA ke HoD dikirim sesudah commit (notifyCurrentStep).
async function bukaApproval(tx: Tx, id: number): Promise<string> {
  const [o] = await tx`
    SELECT id, kode, am_id, nama, tanggal_lembur::text AS tanggal_lembur, estimasi_menit, uraian, hod_key
    FROM overtime_request WHERE id = ${id} FOR UPDATE
  `;
  if (!o || !o.hod_key) throw new Error("pengajuan tanpa HoD tak bisa dibuka approval-nya");
  const [u] = await tx`SELECT id FROM app_user WHERE am_id = ${o.am_id} AND active ORDER BY created_at LIMIT 1`;
  const apr = await buatRequestDalamTx(tx, {
    jenis: JENIS_LEMBUR,
    title: `Lembur ${o.kode}: ${o.nama}`.slice(0, 200),
    description: `Tanggal: ${o.tanggal_lembur}\nEstimasi: ${formatDurasi(Number(o.estimasi_menit))}\nPekerjaan: ${o.uraian}`,
    requestedBy: String(o.nama),
    requestedByUserId: u ? String(u.id) : null,
    hodPengaju: String(o.hod_key),
    refTabel: REF_TABEL,
    refId: String(o.id),
  });
  if (!apr.ok) throw new Error(`gagal membuka approval lembur: ${apr.error}`);
  await tx`UPDATE overtime_request SET approval_request_id = ${apr.id} WHERE id = ${id}`;
  return apr.id;
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
  // Pengajuan + approval-nya lahir dalam satu transaksi (bila HoD diketahui).
  const id = await sql.begin(async (txRaw) => {
    const tx = txRaw as unknown as Tx;
    const [ins] = await tx`
      INSERT INTO overtime_request (kode, am_id, nama, dept, tanggal_lembur, estimasi_menit, uraian, hod_key, group_jid, wa_message_id)
      VALUES (${kode}, ${p.am_id}, ${p.nama}, ${p.dept}, ${wibDate()}, ${input.menit}, ${input.uraian}, ${p.hod_key}, ${input.group_jid}, ${input.wa_message_id})
      RETURNING id
    `;
    const newId = Number(ins.id);
    if (p.hod_key) await bukaApproval(tx, newId);
    return newId;
  });
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

// total = jumlah baris yang cocok filter (bukan cuma yang dimuat) — supaya UI
// bisa bilang "menampilkan X dari Y" alih-alih memotong rekap HR diam-diam.
export async function listOvertime(filter: {
  status?: string;
  from?: string;
  to?: string;
  hod_key?: string;
  limit?: number;
  offset?: number;
}): Promise<{ rows: OvertimeRow[]; total: number; limit: number; offset: number }> {
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
  const offset = Math.max(Math.floor(Number(filter.offset) || 0), 0);
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  const rows = await sql.unsafe(
    `SELECT ${SELECT_COLS} FROM overtime_request ${where} ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`,
    params as never[],
  );
  const [{ n }] = await sql.unsafe(`SELECT count(*)::int AS n FROM overtime_request ${where}`, params as never[]);
  return { rows: rows.map((r) => mapRow(r)), total: Number(n), limit, offset };
}

// Kirim / kirim-ulang notifikasi ke HoD. Hasilnya dicatat ke notify_status
// supaya admin bisa melihat kenapa pengajuan "menggantung" tanpa membuka log.
// Pengirimannya lewat engine (pesan berisi kode APR + kode OT bisa dipakai).
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
  let aprId = row.approval_request_id;
  if (!aprId) {
    aprId = await sql.begin((tx) => bukaApproval(tx as unknown as Tx, id));
  }
  const target = await resolveHodTarget(row.hod_key);
  const n = await notifyCurrentStep(aprId);
  if (!n.ok) {
    await simpan(`gagal: ${n.error ?? "pengiriman WA ke HoD gagal"}`, null);
    return { ok: false, error: n.error ?? "pengiriman WA ke HoD gagal" };
  }
  await simpan("terkirim", "gagal" in target ? null : target.name);
  return { ok: true };
}

// Admin menetapkan / mengganti HoD sebuah pengajuan lalu memicu notifikasi.
export async function assignHod(id: number, hodKey: string): Promise<{ ok: boolean; error?: string; notify?: { ok: boolean; error?: string } }> {
  const sql = db();
  const key = hodKey.trim();
  if (!key) return { ok: false, error: "hod_key kosong" };
  // Daftar HoD kanonik = master_hod (migrasi 198); key salah ketik → pengajuan
  // menggantung tanpa pernah bisa diputus HoD mana pun.
  const [hod] = await sql`SELECT 1 FROM master_hod WHERE hod_key = ${key} AND aktif`;
  if (!hod) return { ok: false, error: `hod_key "${key}" tidak ada di daftar HoD aktif` };
  const rows = await sql`
    UPDATE overtime_request SET hod_key = ${key} WHERE id = ${id} AND status = 'pending' RETURNING approval_request_id
  `;
  if (!rows.length) return { ok: false, error: "pengajuan tidak ditemukan atau sudah diputus" };
  // Sudah punya approval → ganti pemegang tahapnya di engine (jejak audit +
  // WA ke HoD baru). Belum → notifyApprover membukanya.
  if (rows[0].approval_request_id) {
    const g = await gantiHodTahapCurrent(String(rows[0].approval_request_id), key, "admin lembur");
    if (!g.ok) return { ok: false, error: g.error };
    const notify = g.notify ?? { ok: false, error: "notifikasi tak dicoba" };
    await sql`UPDATE overtime_request SET notify_status = ${notify.ok ? "terkirim" : `gagal: ${notify.error}`} WHERE id = ${id}`;
    return { ok: true, notify: { ok: notify.ok, error: notify.error } };
  }
  return { ok: true, notify: await notifyApprover(id) };
}

// ── Keputusan ────────────────────────────────────────────────────────────────

export interface OvertimeActor {
  name: string;
  hodKey: string | null;
  // admin / superuser / direktur boleh memutus pengajuan divisi mana pun —
  // HANYA untuk pengajuan tanpa approval engine (HoD belum ditetapkan /
  // data lama). Pengajuan di engine mengikuti cekWewenang.
  privileged: boolean;
  // Identitas untuk engine: akun sesi (dashboard) atau approver WA.
  userId?: string | null;
  approver?: ResolvedApprover | null;
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

  // Pengajuan di mesin F11: keputusan + pengumuman grup lewat engine &
  // penangan konsumen di bawah, aturan wewenang sama dengan approval lain.
  if (cur.approval_request_id) {
    const r = actor.approver
      ? await decideCurrentStep(cur.approval_kode ?? "", action, actor.approver, note ?? null)
      : actor.userId
        ? await decideFromDashboard(cur.approval_request_id, action, actor.userId, note ?? null)
        : { ok: false as const, error: "identitas pemutus tak dikenal" };
    if (!r.ok) return { ok: false, error: r.error ?? "gagal memutus" };
    return { ok: true, row: (await getOvertime(cur.id)) ?? cur };
  }

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

// Penangan konsumen engine — status pengajuan ikut keputusan approval (di
// transaksi keputusan); pengumuman ke grup asal sesudah commit.
daftarKonsumen(
  REF_TABEL,
  async (tx, h) => {
    if (h.status === "canceled") return;
    await tx`
      UPDATE overtime_request SET
        status = ${h.status}, decided_by = ${h.oleh}, decided_at = now(), decision_note = ${h.catatan}
      WHERE id = ${Number(h.refId)} AND status = 'pending' AND approval_request_id = ${h.requestId}
    `;
  },
  {
    sesudah: async (h) => {
      if (h.status === "canceled") return;
      const sql = db();
      const [o] = await sql`SELECT kode, nama, estimasi_menit, group_jid FROM overtime_request WHERE id = ${Number(h.refId)}`;
      if (!o?.group_jid) return;
      const teks =
        h.status === "approved"
          ? `✅ Lembur ${o.kode} (${o.nama}, ${formatDurasi(Number(o.estimasi_menit))}) DISETUJUI oleh ${h.oleh}.`
          : `❌ Lembur ${o.kode} (${o.nama}) DITOLAK oleh ${h.oleh}${h.catatan ? `: ${h.catatan}` : ""}.`;
      await sendViaWaGateway(String(o.group_jid), teks);
    },
  },
);
