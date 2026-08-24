import { db } from "../db.js";

// postgres.js parse kolom timestamptz jadi objek Date — String(dateObj) hasilnya
// verbose ("Wed Aug 05 2026 …"), bukan ISO. new Date(x).toISOString() aman
// dipanggil baik x sudah Date maupun masih string dari driver.
const toIsoTs = (x: unknown): string => new Date(x as string | Date).toISOString();

// F22 — Instalasi Alat Lifecycle (AFTERSALES). Checklist 5 langkah SEKUENSIAL
// per alat: po_control → sj → teknisi_assign → training → bast. Tabel
// installation_unit SENGAJA self-contained (lihat 130_installation_lifecycle.sql)
// — teknisi_name/customer_name/po_number/sj_number/bast_number semua TEXT bebas,
// tanpa FK ke domain lain (CRM/HR off-limits utk fitur ini).

export interface InstallationInput {
  alat_name: string;
  serial_number?: string | null;
  customer_name: string;
  cabang?: string | null;
  po_number?: string | null;
  created_by?: string | null;
}

export interface InstallationRow {
  id: string;
  alat_name: string;
  serial_number: string | null;
  customer_name: string;
  cabang: string | null;
  po_number: string | null;
  po_control_done: boolean;
  po_control_at: string | null;
  sj_number: string | null;
  sj_done: boolean;
  sj_at: string | null;
  teknisi_name: string | null;
  teknisi_assign_done: boolean;
  teknisi_assign_at: string | null;
  training_notes: string | null;
  training_done: boolean;
  training_at: string | null;
  bast_number: string | null;
  bast_done: boolean;
  bast_at: string | null;
  status: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

function mapRow(r: Record<string, unknown>): InstallationRow {
  return {
    id: String(r.id),
    alat_name: String(r.alat_name),
    serial_number: r.serial_number ? String(r.serial_number) : null,
    customer_name: String(r.customer_name),
    cabang: r.cabang ? String(r.cabang) : null,
    po_number: r.po_number ? String(r.po_number) : null,
    po_control_done: Boolean(r.po_control_done),
    po_control_at: r.po_control_at ? toIsoTs(r.po_control_at) : null,
    sj_number: r.sj_number ? String(r.sj_number) : null,
    sj_done: Boolean(r.sj_done),
    sj_at: r.sj_at ? toIsoTs(r.sj_at) : null,
    teknisi_name: r.teknisi_name ? String(r.teknisi_name) : null,
    teknisi_assign_done: Boolean(r.teknisi_assign_done),
    teknisi_assign_at: r.teknisi_assign_at ? toIsoTs(r.teknisi_assign_at) : null,
    training_notes: r.training_notes ? String(r.training_notes) : null,
    training_done: Boolean(r.training_done),
    training_at: r.training_at ? toIsoTs(r.training_at) : null,
    bast_number: r.bast_number ? String(r.bast_number) : null,
    bast_done: Boolean(r.bast_done),
    bast_at: r.bast_at ? toIsoTs(r.bast_at) : null,
    status: String(r.status),
    created_by: r.created_by ? String(r.created_by) : null,
    created_at: toIsoTs(r.created_at),
    updated_at: toIsoTs(r.updated_at),
  };
}

export async function createInstallation(input: InstallationInput): Promise<InstallationRow> {
  const sql = db();
  const rows = await sql`
    INSERT INTO installation_unit (alat_name, serial_number, customer_name, cabang, po_number, created_by)
    VALUES (${input.alat_name}, ${input.serial_number ?? null}, ${input.customer_name},
            ${input.cabang ?? null}, ${input.po_number ?? null}, ${input.created_by ?? null})
    RETURNING *
  `;
  return mapRow(rows[0]);
}

export async function listInstallations(
  status?: string,
  search?: string,
  limit = 500,
): Promise<InstallationRow[]> {
  const sql = db();
  const rows = await sql`
    SELECT * FROM installation_unit
    WHERE ${status ? sql`status = ${status}` : sql`true`}
      AND ${
        search
          ? sql`(alat_name ILIKE ${`%${search}%`} OR customer_name ILIKE ${`%${search}%`} OR serial_number ILIKE ${`%${search}%`})`
          : sql`true`
      }
    ORDER BY created_at DESC
    LIMIT ${limit}
  `;
  return rows.map(mapRow);
}

export async function getInstallationById(id: string): Promise<InstallationRow | null> {
  const sql = db();
  const rows = await sql`SELECT * FROM installation_unit WHERE id = ${id}`;
  return rows.length ? mapRow(rows[0]) : null;
}

export interface InstallationActionResult {
  ok: boolean;
  error?: string;
  status?: string;
}

// ── Transisi checklist — 5 fungsi eksplisit, urutan divalidasi manual per
// langkah (bukan helper generik) — konsisten dgn gaya salesdoc.ts. ──

export async function markPoControl(id: string, po_number?: string): Promise<InstallationActionResult> {
  const sql = db();
  const rows = await sql`SELECT id, po_number, po_control_done FROM installation_unit WHERE id = ${id}`;
  if (rows.length === 0) return { ok: false, error: "unit instalasi tidak ditemukan" };
  if (rows[0].po_control_done) return { ok: false, error: "langkah PO control sudah selesai" };
  await sql`
    UPDATE installation_unit
    SET po_number = COALESCE(${po_number ?? null}, po_number),
        po_control_done = TRUE, po_control_at = now(),
        status = 'po_control', updated_at = now()
    WHERE id = ${id}
  `;
  return { ok: true, status: "po_control" };
}

export async function markSj(id: string, sj_number: string): Promise<InstallationActionResult> {
  const sql = db();
  const rows = await sql`SELECT id, po_control_done, sj_done FROM installation_unit WHERE id = ${id}`;
  if (rows.length === 0) return { ok: false, error: "unit instalasi tidak ditemukan" };
  if (!rows[0].po_control_done) {
    return { ok: false, error: "PO control belum selesai — selesaikan langkah sebelumnya dulu" };
  }
  if (rows[0].sj_done) return { ok: false, error: "langkah SJ sudah selesai" };
  await sql`
    UPDATE installation_unit
    SET sj_number = ${sj_number}, sj_done = TRUE, sj_at = now(),
        status = 'sj', updated_at = now()
    WHERE id = ${id}
  `;
  return { ok: true, status: "sj" };
}

export async function markTeknisiAssign(id: string, teknisi_name: string): Promise<InstallationActionResult> {
  const sql = db();
  const rows = await sql`SELECT id, sj_done, teknisi_assign_done FROM installation_unit WHERE id = ${id}`;
  if (rows.length === 0) return { ok: false, error: "unit instalasi tidak ditemukan" };
  if (!rows[0].sj_done) {
    return { ok: false, error: "SJ belum selesai — selesaikan langkah sebelumnya dulu" };
  }
  if (rows[0].teknisi_assign_done) return { ok: false, error: "langkah assign teknisi sudah selesai" };
  await sql`
    UPDATE installation_unit
    SET teknisi_name = ${teknisi_name}, teknisi_assign_done = TRUE, teknisi_assign_at = now(),
        status = 'teknisi_assign', updated_at = now()
    WHERE id = ${id}
  `;
  return { ok: true, status: "teknisi_assign" };
}

export async function markTrainingDone(id: string, training_notes?: string): Promise<InstallationActionResult> {
  const sql = db();
  const rows = await sql`SELECT id, teknisi_assign_done, training_done FROM installation_unit WHERE id = ${id}`;
  if (rows.length === 0) return { ok: false, error: "unit instalasi tidak ditemukan" };
  if (!rows[0].teknisi_assign_done) {
    return { ok: false, error: "Assign teknisi belum selesai — selesaikan langkah sebelumnya dulu" };
  }
  if (rows[0].training_done) return { ok: false, error: "langkah training sudah selesai" };
  await sql`
    UPDATE installation_unit
    SET training_notes = ${training_notes ?? null}, training_done = TRUE, training_at = now(),
        status = 'training', updated_at = now()
    WHERE id = ${id}
  `;
  return { ok: true, status: "training" };
}

export async function markBast(id: string, bast_number: string): Promise<InstallationActionResult> {
  const sql = db();
  const rows = await sql`SELECT id, training_done, bast_done FROM installation_unit WHERE id = ${id}`;
  if (rows.length === 0) return { ok: false, error: "unit instalasi tidak ditemukan" };
  if (!rows[0].training_done) {
    return { ok: false, error: "Training belum selesai — selesaikan langkah sebelumnya dulu" };
  }
  if (rows[0].bast_done) return { ok: false, error: "langkah BAST sudah selesai" };
  await sql`
    UPDATE installation_unit
    SET bast_number = ${bast_number}, bast_done = TRUE, bast_at = now(),
        status = 'bast', updated_at = now()
    WHERE id = ${id}
  `;
  return { ok: true, status: "bast" };
}
