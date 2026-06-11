import { db } from "../db.js";

// D1 — master data CRM (port legacy master_user + master_territory). Roster AM
// di-key am_id (dipakai lintas deal/reminder/todo); territory map AM→HOD→cabang.

export interface MasterUserInput {
  am_id: string;
  nama: string;
  panggilan?: string;
  wa_number?: string;
  role?: string;
  posisi?: string;
  cabang?: string;
  area?: string;
  aktif?: boolean;
  wajib_plan_report?: boolean;
}

export async function upsertUser(u: MasterUserInput): Promise<{ am_id: string }> {
  const sql = db();
  const rows = await sql`
    INSERT INTO master_user
      (am_id, nama, panggilan, wa_number, role, posisi, cabang, area, aktif, wajib_plan_report)
    VALUES
      (${u.am_id}, ${u.nama}, ${u.panggilan ?? null}, ${u.wa_number ?? null},
       ${u.role ?? "AM"}, ${u.posisi ?? null}, ${u.cabang ?? null}, ${u.area ?? null},
       ${u.aktif ?? true}, ${u.wajib_plan_report ?? true})
    ON CONFLICT (am_id) DO UPDATE SET
      nama = EXCLUDED.nama, panggilan = EXCLUDED.panggilan, wa_number = EXCLUDED.wa_number,
      role = EXCLUDED.role, posisi = EXCLUDED.posisi, cabang = EXCLUDED.cabang,
      area = EXCLUDED.area, aktif = EXCLUDED.aktif, wajib_plan_report = EXCLUDED.wajib_plan_report
    RETURNING am_id
  `;
  return { am_id: String(rows[0].am_id) };
}

export interface MasterUserRow {
  am_id: string;
  nama: string;
  panggilan: string | null;
  wa_number: string | null;
  role: string;
  posisi: string | null;
  cabang: string | null;
  area: string | null;
  aktif: boolean;
  wajib_plan_report: boolean;
}

export async function listUsers(opts: { role?: string; aktif?: boolean } = {}): Promise<MasterUserRow[]> {
  const sql = db();
  const rows = await sql`
    SELECT am_id, nama, panggilan, wa_number, role, posisi, cabang, area, aktif, wajib_plan_report
    FROM master_user
    WHERE ${opts.role ? sql`role = ${opts.role}` : sql`true`}
      AND ${opts.aktif === undefined ? sql`true` : sql`aktif = ${opts.aktif}`}
    ORDER BY cabang NULLS LAST, nama
  `;
  return rows.map((r) => ({
    am_id: String(r.am_id),
    nama: String(r.nama),
    panggilan: r.panggilan ? String(r.panggilan) : null,
    wa_number: r.wa_number ? String(r.wa_number) : null,
    role: String(r.role),
    posisi: r.posisi ? String(r.posisi) : null,
    cabang: r.cabang ? String(r.cabang) : null,
    area: r.area ? String(r.area) : null,
    aktif: Boolean(r.aktif),
    wajib_plan_report: Boolean(r.wajib_plan_report),
  }));
}

export interface TerritoryInput {
  am_panggilan: string;
  hod_panggilan: string;
  cabang: string;
  kota: string;
}

export async function upsertTerritory(t: TerritoryInput): Promise<{ id: string }> {
  const sql = db();
  const rows = await sql`
    INSERT INTO master_territory (am_panggilan, hod_panggilan, cabang, kota)
    VALUES (${t.am_panggilan}, ${t.hod_panggilan}, ${t.cabang}, ${t.kota})
    ON CONFLICT (am_panggilan, cabang, kota) DO UPDATE SET
      hod_panggilan = EXCLUDED.hod_panggilan
    RETURNING id
  `;
  return { id: String(rows[0].id) };
}

export async function listTerritories(): Promise<
  { id: string; am_panggilan: string; hod_panggilan: string; cabang: string; kota: string }[]
> {
  const sql = db();
  const rows = await sql`
    SELECT id, am_panggilan, hod_panggilan, cabang, kota
    FROM master_territory ORDER BY cabang, am_panggilan
  `;
  return rows.map((r) => ({
    id: String(r.id),
    am_panggilan: String(r.am_panggilan),
    hod_panggilan: String(r.hod_panggilan),
    cabang: String(r.cabang),
    kota: String(r.kota),
  }));
}
