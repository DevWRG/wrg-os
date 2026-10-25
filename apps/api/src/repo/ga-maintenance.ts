import type { TransactionSql } from "postgres";

import { db } from "../db.js";
import { sendGaWa } from "../wasend.js";
import { buatRequestDalamTx, daftarKonsumen, decideFromDashboard, notifyCurrentStep, type NotifyResult } from "./approval.js";

type Tx = TransactionSql<Record<string, unknown>>;

// Round-trip lewat toISOString() (bukan cuma cek Number.isNaN) — JS Date
// TOLERAN overflow kalender (mis. "2027-02-30" diam-diam jadi "2027-03-02"),
// pola sama fix isIsoDate() di repo/vehicle.ts.
const isIsoDate = (s: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};

// F137 — GA Maintenance & Recurrence Tracker. DI ATAS F132 (ga_assets,
// migrasi 086). Upgrade sengaja dari gais/006_maintenance.sql+009 — asset_id
// & vendor_id FK sungguhan (source cuma free-text), plus approval Finance
// (TAMBAHAN, tak ada di source) dan auto-feed BSC (lihat runGaMaintenanceBscFeed).

const toIsoDate = (x: unknown): string | null => (x == null ? null : new Date(x as string | Date).toISOString().slice(0, 10));
const toIsoTs = (x: unknown): string => new Date(x as string | Date).toISOString();
const wibToday = (): string => new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);

export interface ActionResult {
  ok: boolean;
  error?: string;
}

// Ambang approval Finance (Rp) — RACI brief F137: "Finance C (>Rp 5jt)".
const FINANCE_THRESHOLD = Number(process.env.GA_MAINTENANCE_FINANCE_THRESHOLD) || 5_000_000;

// Approval Finance lewat mesin F11 (migrasi 249), alur 'ga-maintenance'.
export const JENIS_GA_MAINTENANCE = "ga-maintenance";
const REF_TABEL = "ga_maintenance_schedules";

// Pure — apakah penyelesaian ini butuh approval Finance. Jadwal yang pernah
// DITOLAK Finance selalu butuh approval lagi berapa pun biayanya: tanpa itu,
// menurunkan cost_actual di bawah ambang jadi jalan pintas melewati Finance.
export function perluApprovalFinance(costActual: number, sudahDisetujui: boolean, pernahDitolak: boolean): boolean {
  if (sudahDisetujui) return false;
  return costActual > FINANCE_THRESHOLD || pernahDitolak;
}

// ───────────────────────── Vendor ─────────────────────────

export interface GaVendorRow {
  id: string;
  nama: string;
  category: string | null;
  contact_person: string | null;
  phone: string | null;
  contract_end: string | null;
  notes: string | null;
  status: string;
}

function mapVendorRow(r: Record<string, unknown>): GaVendorRow {
  return {
    id: String(r.id),
    nama: String(r.nama),
    category: r.category ? String(r.category) : null,
    contact_person: r.contact_person ? String(r.contact_person) : null,
    phone: r.phone ? String(r.phone) : null,
    contract_end: toIsoDate(r.contract_end),
    notes: r.notes ? String(r.notes) : null,
    status: String(r.status),
  };
}

export async function listVendors(activeOnly = true): Promise<GaVendorRow[]> {
  const sql = db();
  const rows = await sql`
    SELECT * FROM ga_vendor WHERE ${activeOnly ? sql`status = 'active'` : sql`true`}
    ORDER BY nama ASC
  `;
  return rows.map(mapVendorRow);
}

export interface GaVendorInput {
  nama: string;
  category?: string | null;
  contact_person?: string | null;
  phone?: string | null;
  contract_end?: string | null;
  notes?: string | null;
}

export async function createVendor(input: GaVendorInput): Promise<GaVendorRow | ActionResult> {
  const sql = db();
  const nama = input.nama.trim();
  if (!nama) return { ok: false, error: "nama wajib diisi" };
  const rows = await sql`
    INSERT INTO ga_vendor (nama, category, contact_person, phone, contract_end, notes)
    VALUES (${nama}, ${input.category ?? null}, ${input.contact_person ?? null}, ${input.phone ?? null}, ${input.contract_end ?? null}, ${input.notes ?? null})
    RETURNING *
  `;
  return mapVendorRow(rows[0]);
}

export interface GaVendorUpdateInput {
  nama?: string | null;
  category?: string | null;
  contact_person?: string | null;
  phone?: string | null;
  contract_end?: string | null;
  notes?: string | null;
  status?: string | null;
}

export async function updateVendor(id: string, input: GaVendorUpdateInput): Promise<ActionResult> {
  const sql = db();
  const rows = await sql`SELECT id FROM ga_vendor WHERE id = ${id}`;
  if (rows.length === 0) return { ok: false, error: "vendor tidak ditemukan" };
  // `!== undefined` (bukan COALESCE(x ?? null, kolom)) — field opsional
  // (contact_person/phone/contract_end/notes) harus BISA dikosongkan lewat
  // null eksplisit; COALESCE selalu jatuh balik ke nilai lama kalau input
  // null (pola bug yang sama dgn F53 asset-tag.ts, sapuan 2026-09-07).
  await sql`
    UPDATE ga_vendor SET
      nama = ${input.nama !== undefined ? input.nama : sql`nama`},
      category = ${input.category !== undefined ? input.category : sql`category`},
      contact_person = ${input.contact_person !== undefined ? input.contact_person : sql`contact_person`},
      phone = ${input.phone !== undefined ? input.phone : sql`phone`},
      contract_end = ${input.contract_end !== undefined ? input.contract_end : sql`contract_end`},
      notes = ${input.notes !== undefined ? input.notes : sql`notes`},
      status = ${input.status !== undefined ? input.status : sql`status`},
      updated_at = now()
    WHERE id = ${id}
  `;
  return { ok: true };
}

// ───────────────────────── Maintenance schedules ─────────────────────────

export interface GaMaintenanceRow {
  id: string;
  asset_id: string;
  asset_code: string;
  asset_nama: string;
  maint_type: string;
  due_date: string | null;
  status: string;
  overdue: boolean;
  cost_budget: number;
  cost_actual: number;
  vendor_id: string | null;
  vendor_nama: string | null;
  recur_months: number;
  recur_parent_id: string | null;
  approved_by: string | null;
  approved_at: string | null;
  notes: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  // Approval Finance terakhir di mesin F11 (null = tak pernah butuh / data lama).
  approval_request_id: string | null;
  approval_kode: string | null;
  notify?: NotifyResult;
}

function mapScheduleRow(r: Record<string, unknown>): GaMaintenanceRow {
  const dueDate = toIsoDate(r.due_date);
  const status = String(r.status);
  return {
    id: String(r.id),
    asset_id: String(r.asset_id),
    asset_code: String(r.asset_code),
    asset_nama: String(r.asset_nama),
    maint_type: String(r.maint_type),
    due_date: dueDate,
    status,
    overdue: !!dueDate && dueDate < wibToday() && status !== "done" && status !== "cancelled",
    cost_budget: Number(r.cost_budget ?? 0),
    cost_actual: Number(r.cost_actual ?? 0),
    vendor_id: r.vendor_id ? String(r.vendor_id) : null,
    vendor_nama: r.vendor_nama ? String(r.vendor_nama) : null,
    recur_months: Number(r.recur_months ?? 0),
    recur_parent_id: r.recur_parent_id ? String(r.recur_parent_id) : null,
    approved_by: r.approved_by ? String(r.approved_by) : null,
    approved_at: r.approved_at ? toIsoTs(r.approved_at) : null,
    notes: r.notes ? String(r.notes) : null,
    started_at: r.started_at ? toIsoTs(r.started_at) : null,
    completed_at: r.completed_at ? toIsoTs(r.completed_at) : null,
    created_at: toIsoTs(r.created_at),
    approval_request_id: r.approval_request_id ? String(r.approval_request_id) : null,
    approval_kode: r.approval_kode ? String(r.approval_kode) : null,
  };
}

export interface ListSchedulesFilter {
  assetId?: string;
  status?: string;
  vendorId?: string;
}

export async function listSchedules(filter: ListSchedulesFilter = {}): Promise<GaMaintenanceRow[]> {
  const sql = db();
  const rows = await sql`
    SELECT m.*, a.asset_code, a.nama AS asset_nama, v.nama AS vendor_nama,
           (SELECT r.kode FROM approval_request r WHERE r.id = m.approval_request_id) AS approval_kode
    FROM ga_maintenance_schedules m
    JOIN ga_assets a ON a.id = m.asset_id
    LEFT JOIN ga_vendor v ON v.id = m.vendor_id
    WHERE ${filter.assetId ? sql`m.asset_id = ${filter.assetId}` : sql`true`}
      AND ${filter.status ? sql`m.status = ${filter.status}` : sql`true`}
      AND ${filter.vendorId ? sql`m.vendor_id = ${filter.vendorId}` : sql`true`}
    ORDER BY m.due_date ASC NULLS LAST, m.created_at DESC
  `;
  return rows.map(mapScheduleRow);
}

export async function getSchedule(id: string): Promise<GaMaintenanceRow | null> {
  const sql = db();
  const rows = await sql`
    SELECT m.*, a.asset_code, a.nama AS asset_nama, v.nama AS vendor_nama,
           (SELECT r.kode FROM approval_request r WHERE r.id = m.approval_request_id) AS approval_kode
    FROM ga_maintenance_schedules m
    JOIN ga_assets a ON a.id = m.asset_id
    LEFT JOIN ga_vendor v ON v.id = m.vendor_id
    WHERE m.id = ${id}
  `;
  return rows.length ? mapScheduleRow(rows[0]) : null;
}

export interface GaMaintenanceInput {
  asset_id: string;
  maint_type?: string | null;
  due_date?: string | null;
  cost_budget?: number | null;
  vendor_id?: string | null;
  recur_months?: number | null;
  notes?: string | null;
}

export async function createSchedule(input: GaMaintenanceInput): Promise<GaMaintenanceRow | ActionResult> {
  const sql = db();
  if (input.cost_budget != null && (!Number.isFinite(input.cost_budget) || input.cost_budget < 0)) {
    return { ok: false, error: "cost_budget tidak boleh negatif" };
  }
  if (!input.due_date) return { ok: false, error: "due_date wajib diisi" };
  if (!isIsoDate(input.due_date)) {
    return { ok: false, error: `due_date "${input.due_date}" bukan tanggal valid (format YYYY-MM-DD)` };
  }
  const rows0 = await sql`SELECT category_id FROM ga_assets WHERE id = ${input.asset_id}`;
  if (rows0.length === 0) return { ok: false, error: "aset tidak ditemukan" };

  // recur_months tak diisi → sodorkan default kategori aset ("Kendaraan
  // Bermotor"=6bln, "AC"=3bln, dst — contoh dari brief F137, admin isi
  // sendiri per kategori, TIDAK diseed). Beda dari `?? 0` polos: `input.recur_months`
  // NULL/undefined = "belum diputuskan user", bukan berarti "sekali saja".
  let recurMonths: number = input.recur_months ?? 0;
  if (input.recur_months == null) {
    const [cat] = await sql`SELECT default_recur_months FROM ga_asset_categories WHERE id = ${rows0[0].category_id}`;
    recurMonths = Number(cat?.default_recur_months ?? 0);
  }

  const rows = await sql`
    INSERT INTO ga_maintenance_schedules (asset_id, maint_type, due_date, cost_budget, vendor_id, recur_months, notes)
    VALUES (${input.asset_id}, ${input.maint_type ?? "preventive"}, ${input.due_date ?? null}, ${input.cost_budget ?? 0}, ${input.vendor_id ?? null}, ${recurMonths}, ${input.notes ?? null})
    RETURNING id
  `;
  return (await getSchedule(String(rows[0].id)))!;
}

export interface GaMaintenanceUpdateInput {
  due_date?: string | null;
  cost_budget?: number | null;
  vendor_id?: string | null;
  recur_months?: number | null;
  notes?: string | null;
}

export async function updateSchedule(id: string, input: GaMaintenanceUpdateInput): Promise<ActionResult> {
  const sql = db();
  if (input.cost_budget != null && (!Number.isFinite(input.cost_budget) || input.cost_budget < 0)) {
    return { ok: false, error: "cost_budget tidak boleh negatif" };
  }
  if (input.due_date != null && !isIsoDate(input.due_date)) {
    return { ok: false, error: `due_date "${input.due_date}" bukan tanggal valid (format YYYY-MM-DD)` };
  }
  const rows = await sql`SELECT id FROM ga_maintenance_schedules WHERE id = ${id}`;
  if (rows.length === 0) return { ok: false, error: "jadwal tidak ditemukan" };
  // `!== undefined` (bukan COALESCE(x ?? null, kolom)) — vendor_id/notes
  // opsional harus BISA dikosongkan lewat null eksplisit; COALESCE selalu
  // jatuh balik ke nilai lama kalau input null (pola bug yang sama dgn F53
  // asset-tag.ts, sapuan 2026-09-07).
  await sql`
    UPDATE ga_maintenance_schedules SET
      due_date = ${input.due_date !== undefined ? input.due_date : sql`due_date`},
      cost_budget = ${input.cost_budget !== undefined ? input.cost_budget : sql`cost_budget`},
      vendor_id = ${input.vendor_id !== undefined ? input.vendor_id : sql`vendor_id`},
      recur_months = ${input.recur_months !== undefined ? input.recur_months : sql`recur_months`},
      notes = ${input.notes !== undefined ? input.notes : sql`notes`},
      updated_at = now()
    WHERE id = ${id}
  `;
  return { ok: true };
}

export async function startSchedule(id: string): Promise<ActionResult> {
  const sql = db();
  const rows = await sql`SELECT status FROM ga_maintenance_schedules WHERE id = ${id}`;
  if (rows.length === 0) return { ok: false, error: "jadwal tidak ditemukan" };
  if (rows[0].status !== "pending") return { ok: false, error: `tidak bisa mulai dari status "${rows[0].status}"` };
  await sql`UPDATE ga_maintenance_schedules SET status = 'in_progress', started_at = now(), updated_at = now() WHERE id = ${id}`;
  return { ok: true };
}

export async function cancelSchedule(id: string, notes?: string | null): Promise<ActionResult> {
  const sql = db();
  const rows = await sql`SELECT status FROM ga_maintenance_schedules WHERE id = ${id}`;
  if (rows.length === 0) return { ok: false, error: "jadwal tidak ditemukan" };
  // pending_finance = pekerjaan SUDAH selesai secara fisik (cost_actual + completed_at
  // terisi, di atas ambang approval Finance) — cancel di sini akan menghilangkan
  // pekerjaan riil dari alur approval tanpa approved_by, bukan "membatalkan rencana".
  // Cuma pending/in_progress yang sah dibatalkan (ditemukan QA jalur tulis 2026-09-07).
  if (rows[0].status === "done" || rows[0].status === "cancelled" || rows[0].status === "pending_finance") {
    return { ok: false, error: `tidak bisa dibatalkan — status sudah "${rows[0].status}"` };
  }
  await sql`UPDATE ga_maintenance_schedules SET status = 'cancelled', notes = COALESCE(${notes ?? null}, notes), updated_at = now() WHERE id = ${id}`;
  return { ok: true };
}

// Buat kemunculan berikutnya (recur_months>0) — dipanggil setiap kali jadwal
// BENAR-BENAR completed (langsung atau lewat approval Finance).
async function spawnRecurrence(
  row: { id: string; asset_id: string; maint_type: string; due_date: string | null; cost_budget: number; vendor_id: string | null; recur_months: number; notes: string | null },
  tx?: Tx,
): Promise<void> {
  if (!row.recur_months || row.recur_months <= 0 || !row.due_date) return;
  // Sql & TransactionSql tak bisa dipanggil sebagai union — samakan tipenya.
  const sql = (tx ?? db()) as unknown as Tx;
  const next = new Date(`${row.due_date}T00:00:00Z`);
  next.setUTCMonth(next.getUTCMonth() + row.recur_months);
  await sql`
    INSERT INTO ga_maintenance_schedules (asset_id, maint_type, due_date, cost_budget, vendor_id, recur_months, recur_parent_id, notes)
    VALUES (${row.asset_id}, ${row.maint_type}, ${next.toISOString().slice(0, 10)}, ${row.cost_budget}, ${row.vendor_id}, ${row.recur_months}, ${row.id}, ${row.notes})
  `;
}

export interface CompleteInput {
  cost_actual?: number | null;
  notes?: string | null;
  // Akun yang menyelesaikan (sesi web) — jadi pengaju approval Finance;
  // pengaju tak boleh memutus approval-nya sendiri.
  actor_user_id?: string | null;
  actor_name?: string | null;
}

function recurOf(row: Record<string, unknown>) {
  return {
    id: String(row.id), asset_id: String(row.asset_id), maint_type: String(row.maint_type),
    due_date: toIsoDate(row.due_date), cost_budget: Number(row.cost_budget), vendor_id: row.vendor_id ? String(row.vendor_id) : null,
    recur_months: Number(row.recur_months), notes: row.notes ? String(row.notes) : null,
  };
}

// Selesaikan jadwal. Kalau butuh approval Finance (perluApprovalFinance) →
// status 'pending_finance' + approval_request alur 'ga-maintenance' dalam
// satu transaksi; WA ke Finance sesudah commit. Recurrence baru CUMA dibuat
// begitu status benar-benar 'done' (langsung, atau lewat penangan konsumen).
export async function completeSchedule(id: string, input: CompleteInput): Promise<GaMaintenanceRow | ActionResult> {
  const sql = db();
  if (input.cost_actual != null && (!Number.isFinite(input.cost_actual) || input.cost_actual < 0)) {
    return { ok: false, error: "cost_actual tidak boleh negatif" };
  }
  const out = await sql.begin(async (txRaw): Promise<ActionResult & { aprId?: string }> => {
    const tx = txRaw as unknown as Tx;
    const rows = await tx`
      SELECT s.*, a.asset_code, a.nama AS asset_nama FROM ga_maintenance_schedules s JOIN ga_assets a ON a.id = s.asset_id
      WHERE s.id = ${id} FOR UPDATE OF s
    `;
    if (rows.length === 0) return { ok: false, error: "jadwal tidak ditemukan" };
    const row = rows[0];
    // Harus lewat start() dulu (in_progress) — tanpa guard ini, jadwal "pending"
    // bisa langsung di-complete (skip-start), DAN jadwal "pending_finance" yang
    // menunggu Finance bisa di-complete ULANG dgn biaya lebih rendah utk
    // mem-bypass approval Finance sepenuhnya.
    if (row.status !== "in_progress") {
      return { ok: false, error: `hanya bisa complete dari status "in_progress", saat ini "${row.status}"` };
    }
    const costActual = input.cost_actual ?? Number(row.cost_actual ?? 0);
    const [tolak] = await tx`
      SELECT 1 FROM approval_request WHERE ref_tabel = ${REF_TABEL} AND ref_id = ${id} AND status = 'rejected' LIMIT 1
    `;
    const needsFinance = perluApprovalFinance(costActual, !!row.approved_by, !!tolak);
    const newStatus = needsFinance ? "pending_finance" : "done";
    await tx`
      UPDATE ga_maintenance_schedules SET
        cost_actual = ${costActual}, notes = COALESCE(${input.notes ?? null}, notes),
        status = ${newStatus}, completed_at = now(), updated_at = now()
      WHERE id = ${id}
    `;
    if (!needsFinance) {
      await spawnRecurrence(recurOf(row), tx);
      return { ok: true };
    }
    const apr = await buatRequestDalamTx(tx, {
      jenis: JENIS_GA_MAINTENANCE,
      title: `Maintenance GA: ${row.asset_code} — ${row.asset_nama} (${row.maint_type})`.slice(0, 200),
      description: [tolak ? "Diajukan ulang setelah ditolak Finance." : null, input.notes ?? (row.notes ? String(row.notes) : null)]
        .filter(Boolean).join("\n") || null,
      nominal: costActual,
      requestedBy: input.actor_name?.trim() || "GA",
      requestedByUserId: input.actor_user_id ?? null,
      refTabel: REF_TABEL,
      refId: id,
    });
    if (!apr.ok) throw new Error(`gagal membuat approval Finance: ${apr.error}`);
    await tx`UPDATE ga_maintenance_schedules SET approval_request_id = ${apr.id} WHERE id = ${id}`;
    return { ok: true, aprId: apr.id };
  });
  if (!out.ok) return out;
  const notify = out.aprId ? await notifyCurrentStep(out.aprId) : undefined;
  const row = (await getSchedule(id))!;
  return notify ? { ...row, notify } : row;
}

export interface ApproveInput {
  approved_by: string;
  // Jalur lama (tanpa approval_request_id): BFF sudah memeriksa gerbang
  // "Approve Finance" (canApproveGaFinance). Jalur engine tak memakainya —
  // wewenangnya keanggotaan grup tahap approval.
  legacy_allowed?: boolean;
}

// Approval Finance dari tombol di /ga-aset. Jadwal yang punya approval di
// mesin F11 diputus lewat engine (wewenang = anggota grup tahap itu, bukan
// pengaju); approved_by = id akun sesi. Jalur langsung di bawah hanya untuk
// baris lama tanpa approval_request_id.
export async function approveSchedule(id: string, input: ApproveInput): Promise<GaMaintenanceRow | ActionResult> {
  const sql = db();
  const rows = await sql`SELECT * FROM ga_maintenance_schedules WHERE id = ${id}`;
  if (rows.length === 0) return { ok: false, error: "jadwal tidak ditemukan" };
  const row = rows[0];
  if (row.status !== "pending_finance") return { ok: false, error: `hanya bisa approve dari status "pending_finance", saat ini "${row.status}"` };

  if (row.approval_request_id) {
    const r = await decideFromDashboard(String(row.approval_request_id), "approve", input.approved_by);
    if (!r.ok) return { ok: false, error: r.error };
    return (await getSchedule(id))!;
  }

  if (!input.legacy_allowed) return { ok: false, error: "forbidden (Approve Finance: admin/Finance/Akses Grup ga-finance-approval)" };
  await sql`UPDATE ga_maintenance_schedules SET status = 'done', approved_by = ${input.approved_by}, approved_at = now(), updated_at = now() WHERE id = ${id}`;
  await spawnRecurrence(recurOf(row));
  return (await getSchedule(id))!;
}

// Penangan konsumen engine — jalan di transaksi keputusan approval.
//   approved → done + approved_by + jadwal berikutnya
//   rejected → kembali in_progress (GA memperbaiki lalu menyelesaikan ulang;
//              approval Finance wajib lagi, lihat perluApprovalFinance)
// Hanya bertindak bila approval itu masih yang aktif untuk jadwal ini.
daftarKonsumen(REF_TABEL, async (tx, h) => {
  const [row] = await tx`
    SELECT * FROM ga_maintenance_schedules
    WHERE id = ${h.refId} AND status = 'pending_finance' AND approval_request_id = ${h.requestId}
    FOR UPDATE
  `;
  if (!row) return;
  if (h.status === "approved") {
    await tx`
      UPDATE ga_maintenance_schedules SET status = 'done', approved_by = ${h.olehUserId}, approved_at = now(), updated_at = now()
      WHERE id = ${h.refId}
    `;
    await spawnRecurrence(recurOf(row), tx);
  } else {
    await tx`
      UPDATE ga_maintenance_schedules SET status = 'in_progress', completed_at = NULL, updated_at = now()
      WHERE id = ${h.refId}
    `;
  }
});

// ── Cron: alert due-date mendekati/lewat (pola F24 reminder — naggy by
// design, tanpa penanda anti-spam persisten, cek ulang tiap run). ──
export async function runMaintenanceAlerts(): Promise<{ alerts: number }> {
  const sql = db();
  const target = process.env.GA_MAINTENANCE_WA_TARGET || "";
  if (!target) return { alerts: 0 }; // anti broadcast tak sengaja tanpa tujuan jelas

  const days = Number(process.env.GA_MAINTENANCE_ALERT_DAYS) || 7;
  const rows = await sql`
    SELECT m.due_date::text AS due_date, m.maint_type, a.asset_code, a.nama AS asset_nama
    FROM ga_maintenance_schedules m JOIN ga_assets a ON a.id = m.asset_id
    WHERE m.status IN ('pending','in_progress')
      AND m.due_date IS NOT NULL
      AND m.due_date <= (CURRENT_DATE + ${days}::int)
    ORDER BY m.due_date ASC
  `;
  if (rows.length === 0) return { alerts: 0 };

  const today = wibToday();
  const lines = rows.map((r) => {
    const overdue = String(r.due_date) < today;
    return `${overdue ? "⚠️ LEWAT" : "•"} ${r.asset_code} — ${r.asset_nama} (${r.maint_type}), due ${r.due_date}`;
  });
  const msg = ["🔧 *Maintenance GA — due dalam " + days + " hari*", ...lines].join("\n");
  const gw = await sendGaWa(target, msg);
  // gw.sent juga true di mode stub & dry-run (lihat wasend.ts) — tanpa
  // gerbang ini return value ngaku "N alert terkirim" walau WA-nya gak
  // pernah beneran keluar (cron ini gak punya penanda persisten spt F24/
  // F45/F50, tapi return value-nya tetap dipakai log scheduler.ts).
  return { alerts: gw.sent && !gw.stub && !gw.dryRun ? rows.length : 0 };
}

// ── Cron: auto-feed BSC KPI Dito (preseden pertama auto-feed
// kpi_measurement — sebelumnya semua diisi manual). Formula ASUMSI: %
// maintenance completed on-time bulan berjalan (lihat migrasi 090). ──
export async function runGaMaintenanceBscFeed(): Promise<{ upserted: boolean; achievement_pct: number | null }> {
  const sql = db();
  const period = wibToday().slice(0, 7); // 'YYYY-MM'

  const [kpiRow] = await sql`SELECT id FROM kpi WHERE employee_id = 'dito' AND name = 'Aset utilization/maintenance cost'`;
  if (!kpiRow) return { upserted: false, achievement_pct: null };

  const [stats] = await sql`
    SELECT
      count(*) AS total,
      count(*) FILTER (WHERE status = 'done' AND completed_at::date <= due_date) AS on_time
    FROM ga_maintenance_schedules
    WHERE due_date >= date_trunc('month', (${period} || '-01')::date)
      AND due_date < date_trunc('month', (${period} || '-01')::date) + interval '1 month'
  `;
  const total = Number(stats.total);
  const onTime = Number(stats.on_time);
  const pct = total === 0 ? 100 : Math.min(120, Math.round((onTime / total) * 100));

  await sql`
    INSERT INTO kpi_measurement (kpi_id, period, achievement_pct)
    VALUES (${kpiRow.id}, ${period}, ${pct})
    ON CONFLICT (kpi_id, period) DO UPDATE SET achievement_pct = EXCLUDED.achievement_pct, updated_at = now()
  `;
  return { upserted: true, achievement_pct: pct };
}
