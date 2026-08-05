import { db } from "../db.js";

// F8 — Teknisi Readiness Board (AFTERSALES). Install scheduling + capacity +
// post-install reports. teknisi_capacity SELF-CONTAINED (nama dummy, seed via
// scripts/db/seed-dev-full.sql — TIDAK ada create/edit di F8 ini, sama
// keputusan "pakai seed" dgn F26, beda tabel/lineage branch). install_schedule
// FK ke installation_unit (F22). teknisi_report dipakai jalur manual DAN hook
// WA (#install/#servis/#training/#kalibrasi, lihat inbound.ts).

export interface Teknisi {
  id: string;
  nama: string;
  wa_number: string | null;
  max_concurrent_jobs: number;
  aktif: boolean;
}

function mapTeknisi(r: Record<string, unknown>): Teknisi {
  return {
    id: String(r.id),
    nama: String(r.nama),
    wa_number: r.wa_number ? String(r.wa_number) : null,
    max_concurrent_jobs: Number(r.max_concurrent_jobs),
    aktif: Boolean(r.aktif),
  };
}

export async function listTeknisiCapacity(): Promise<Teknisi[]> {
  const sql = db();
  const rows = await sql`SELECT * FROM teknisi_capacity ORDER BY nama`;
  return rows.map(mapTeknisi);
}

// CRUD roster (ditambah belakangan — awalnya read-only/seed-only). Roster
// asli (galih/martin/nopa/haidar/halim/enggar, tabel employee BSC) TETAP
// tidak diisi otomatis di sini — Admin input manual lewat form ini, seed
// dummy Fajar/Gilang/Hesti dibiarkan apa adanya utk dev/demo.
export interface CreateTeknisiInput {
  nama: string;
  wa_number?: string | null;
  max_concurrent_jobs?: number;
}

export async function createTeknisiCapacity(
  input: CreateTeknisiInput,
): Promise<Teknisi | { ok: false; error: string }> {
  const sql = db();
  const existing = await sql`SELECT id FROM teknisi_capacity WHERE nama = ${input.nama}`;
  if (existing.length) return { ok: false, error: "nama sudah ada di roster" };
  const rows = await sql`
    INSERT INTO teknisi_capacity (nama, wa_number, max_concurrent_jobs)
    VALUES (${input.nama}, ${input.wa_number ?? null}, ${input.max_concurrent_jobs ?? 3})
    RETURNING *
  `;
  return mapTeknisi(rows[0]);
}

export interface UpdateTeknisiInput {
  nama?: string;
  wa_number?: string | null;
  max_concurrent_jobs?: number;
}

export async function updateTeknisiCapacity(
  id: string,
  input: UpdateTeknisiInput,
): Promise<Teknisi | { ok: false; error: string }> {
  const sql = db();
  const current = await sql`SELECT * FROM teknisi_capacity WHERE id = ${id}`;
  if (!current.length) return { ok: false, error: "teknisi tidak ditemukan" };
  const nama = input.nama ?? String(current[0].nama);
  const waNumber = input.wa_number !== undefined ? input.wa_number : (current[0].wa_number as string | null);
  const maxJobs = input.max_concurrent_jobs ?? Number(current[0].max_concurrent_jobs);
  const rows = await sql`
    UPDATE teknisi_capacity SET nama = ${nama}, wa_number = ${waNumber}, max_concurrent_jobs = ${maxJobs}, updated_at = now()
    WHERE id = ${id}
    RETURNING *
  `;
  return mapTeknisi(rows[0]);
}

// Deactivate, bukan DELETE — konsisten pola project (jaga histori install_schedule/teknisi_report yg FK ke sini).
export async function deactivateTeknisiCapacity(id: string): Promise<{ ok: boolean; error?: string }> {
  const sql = db();
  const rows = await sql`UPDATE teknisi_capacity SET aktif = false, updated_at = now() WHERE id = ${id} RETURNING id`;
  if (!rows.length) return { ok: false, error: "teknisi tidak ditemukan" };
  return { ok: true };
}

// Fuzzy match sender_name (pushname WA) ke roster F8 — best-effort, sama
// limitasi F26 (identitas grup WA tak reliable). Dipakai inbound hook.
export async function matchTeknisiByName(senderName: string | null): Promise<Teknisi | null> {
  if (!senderName?.trim()) return null;
  const sql = db();
  const rows = await sql`
    SELECT * FROM teknisi_capacity WHERE aktif = TRUE AND nama ILIKE ${`%${senderName.trim()}%`} LIMIT 1
  `;
  return rows.length ? mapTeknisi(rows[0]) : null;
}

export interface TeknisiReadiness extends Teknisi {
  capacity_used: number;
  capacity_available: number;
}

// Kapasitas terpakai = install_schedule 'scheduled' (F8 sendiri) + maintenance_schedule
// (F24) 'scheduled'/'notified' YANG teknisi_name-nya match nama teknisi ini —
// cross-tabel by name-match (F24.teknisi_name teks bebas, tanpa FK). SENGAJA
// tanpa fallback (beda dari F26's assignTeknisi) — ini metrik DISPLAY, bukan
// aksi assignment, jadi nama tak match = dianggap 0 kontribusi F24, dicatat
// sbg limitasi bukan bug.
export async function getReadinessBoard(): Promise<TeknisiReadiness[]> {
  const sql = db();
  const rows = await sql`
    SELECT tc.*,
      (SELECT COUNT(*) FROM install_schedule ins WHERE ins.teknisi_id = tc.id AND ins.status = 'scheduled') AS install_load,
      (SELECT COUNT(*) FROM maintenance_schedule ms WHERE ms.teknisi_name = tc.nama AND ms.status IN ('scheduled','notified')) AS pm_load
    FROM teknisi_capacity tc
    ORDER BY tc.nama
  `;
  return rows.map((r) => {
    const t = mapTeknisi(r);
    const used = Number(r.install_load) + Number(r.pm_load);
    return { ...t, capacity_used: used, capacity_available: Math.max(0, t.max_concurrent_jobs - used) };
  });
}

export interface InstallScheduleRow {
  id: string;
  installation_unit_id: string;
  alat_name: string;
  customer_name: string;
  teknisi_id: string | null;
  teknisi_nama: string | null;
  scheduled_date: string;
  status: string;
  note: string | null;
  created_at: string;
  updated_at: string;
}

function mapSchedule(r: Record<string, unknown>): InstallScheduleRow {
  return {
    id: String(r.id),
    installation_unit_id: String(r.installation_unit_id),
    alat_name: String(r.alat_name),
    customer_name: String(r.customer_name),
    teknisi_id: r.teknisi_id ? String(r.teknisi_id) : null,
    teknisi_nama: r.teknisi_nama ? String(r.teknisi_nama) : null,
    scheduled_date: String(r.scheduled_date),
    status: String(r.status),
    note: r.note ? String(r.note) : null,
    created_at: String(r.created_at),
    updated_at: String(r.updated_at),
  };
}

export interface CreateScheduleInput {
  installation_unit_id: string;
  teknisi_id?: string | null;
  scheduled_date: string;
  note?: string | null;
}

export async function createInstallSchedule(
  input: CreateScheduleInput,
): Promise<InstallScheduleRow | { ok: false; error: string }> {
  const sql = db();
  const unit = await sql`SELECT id FROM installation_unit WHERE id = ${input.installation_unit_id}`;
  if (unit.length === 0) return { ok: false, error: "alat (installation_unit) tidak ditemukan" };

  const rows = await sql`
    INSERT INTO install_schedule (installation_unit_id, teknisi_id, scheduled_date, note)
    VALUES (${input.installation_unit_id}, ${input.teknisi_id ?? null}, ${input.scheduled_date}, ${input.note ?? null})
    RETURNING id
  `;
  return (await getScheduleById(String(rows[0].id))) as InstallScheduleRow;
}

async function getScheduleById(id: string): Promise<InstallScheduleRow | null> {
  const sql = db();
  const rows = await sql`
    SELECT ins.*, iu.alat_name, iu.customer_name, tc.nama AS teknisi_nama
    FROM install_schedule ins
    JOIN installation_unit iu ON iu.id = ins.installation_unit_id
    LEFT JOIN teknisi_capacity tc ON tc.id = ins.teknisi_id
    WHERE ins.id = ${id}
  `;
  return rows.length ? mapSchedule(rows[0]) : null;
}

export async function listInstallSchedule(status?: string): Promise<InstallScheduleRow[]> {
  const sql = db();
  const rows = await sql`
    SELECT ins.*, iu.alat_name, iu.customer_name, tc.nama AS teknisi_nama
    FROM install_schedule ins
    JOIN installation_unit iu ON iu.id = ins.installation_unit_id
    LEFT JOIN teknisi_capacity tc ON tc.id = ins.teknisi_id
    WHERE ${status ? sql`ins.status = ${status}` : sql`true`}
    ORDER BY ins.scheduled_date ASC
  `;
  return rows.map(mapSchedule);
}

export async function updateScheduleStatus(
  id: string,
  status: "done" | "cancelled",
): Promise<{ ok: boolean; error?: string }> {
  const sql = db();
  const rows = await sql`
    UPDATE install_schedule SET status = ${status}, updated_at = now()
    WHERE id = ${id} AND status = 'scheduled'
    RETURNING id
  `;
  if (rows.length === 0) {
    const exists = await sql`SELECT status FROM install_schedule WHERE id = ${id}`;
    if (exists.length === 0) return { ok: false, error: "schedule tidak ditemukan" };
    return { ok: false, error: `schedule sudah ${exists[0].status}` };
  }
  return { ok: true };
}

export interface TeknisiReportRow {
  id: string;
  teknisi_id: string | null;
  teknisi_nama: string | null;
  report_type: string;
  body: string;
  source: string;
  group_jid: string | null;
  wa_message_id: string | null;
  installation_unit_id: string | null;
  created_at: string;
}

function mapReport(r: Record<string, unknown>): TeknisiReportRow {
  return {
    id: String(r.id),
    teknisi_id: r.teknisi_id ? String(r.teknisi_id) : null,
    teknisi_nama: r.teknisi_nama ? String(r.teknisi_nama) : null,
    report_type: String(r.report_type),
    body: String(r.body),
    source: String(r.source),
    group_jid: r.group_jid ? String(r.group_jid) : null,
    wa_message_id: r.wa_message_id ? String(r.wa_message_id) : null,
    installation_unit_id: r.installation_unit_id ? String(r.installation_unit_id) : null,
    created_at: String(r.created_at),
  };
}

export interface CreateReportInput {
  teknisi_id?: string | null;
  report_type: string;
  body: string;
  source?: "manual" | "wa";
  group_jid?: string | null;
  wa_message_id?: string | null;
  installation_unit_id?: string | null;
}

export async function createTeknisiReport(input: CreateReportInput): Promise<TeknisiReportRow> {
  const sql = db();

  // Idempotensi jalur WA — sama pola F26 (wa_message_id UNIQUE).
  if (input.wa_message_id) {
    const existing = await sql`
      SELECT tr.*, tc.nama AS teknisi_nama FROM teknisi_report tr
      LEFT JOIN teknisi_capacity tc ON tc.id = tr.teknisi_id
      WHERE tr.wa_message_id = ${input.wa_message_id}
    `;
    if (existing.length) return mapReport(existing[0]);
  }

  const rows = await sql`
    INSERT INTO teknisi_report (teknisi_id, report_type, body, source, group_jid, wa_message_id, installation_unit_id)
    VALUES (
      ${input.teknisi_id ?? null}, ${input.report_type}, ${input.body}, ${input.source ?? "manual"},
      ${input.group_jid ?? null}, ${input.wa_message_id ?? null}, ${input.installation_unit_id ?? null}
    )
    RETURNING id
  `;
  const created = await sql`
    SELECT tr.*, tc.nama AS teknisi_nama FROM teknisi_report tr
    LEFT JOIN teknisi_capacity tc ON tc.id = tr.teknisi_id
    WHERE tr.id = ${rows[0].id}
  `;
  return mapReport(created[0]);
}

export async function listTeknisiReports(reportType?: string): Promise<TeknisiReportRow[]> {
  const sql = db();
  const rows = await sql`
    SELECT tr.*, tc.nama AS teknisi_nama FROM teknisi_report tr
    LEFT JOIN teknisi_capacity tc ON tc.id = tr.teknisi_id
    WHERE ${reportType ? sql`tr.report_type = ${reportType}` : sql`true`}
    ORDER BY tr.created_at DESC
  `;
  return rows.map(mapReport);
}
