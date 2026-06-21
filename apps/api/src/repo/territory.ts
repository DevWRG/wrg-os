// F76 WatchPoint — CRUD mapping HoD→cabang (tabel hod_territory).
// Dipakai dashboard /watchpoint/territory + dibaca watchpoint.ts (loadTerritory).
import { db } from "../db.js";

export interface TerritoryRow {
  id: string;
  hod_key: string;
  cabang: string;
  source: string;
  updated_at: string;
}

const COLS = (sql: ReturnType<typeof db>) =>
  sql`id::text, hod_key, cabang, source, updated_at::text`;

export async function listTerritory(): Promise<TerritoryRow[]> {
  const sql = db();
  const rows = await sql<TerritoryRow[]>`
    SELECT ${COLS(sql)} FROM hod_territory ORDER BY hod_key, cabang`;
  return rows.map((r) => ({ ...r, id: String(r.id) }));
}

export async function createTerritory(hod_key: string, cabang: string): Promise<TerritoryRow> {
  const sql = db();
  const rows = await sql<TerritoryRow[]>`
    INSERT INTO hod_territory (hod_key, cabang, source)
    VALUES (${hod_key}, ${cabang}, 'manual')
    ON CONFLICT (hod_key, cabang) DO UPDATE SET updated_at = now()
    RETURNING ${COLS(sql)}`;
  return { ...rows[0], id: String(rows[0].id) };
}

export async function updateTerritory(id: string, hod_key: string, cabang: string): Promise<TerritoryRow | null> {
  const sql = db();
  const rows = await sql<TerritoryRow[]>`
    UPDATE hod_territory SET hod_key = ${hod_key}, cabang = ${cabang}, updated_at = now()
    WHERE id = ${id}
    RETURNING ${COLS(sql)}`;
  return rows.length ? { ...rows[0], id: String(rows[0].id) } : null;
}

export async function deleteTerritory(id: string): Promise<{ deleted: boolean }> {
  const sql = db();
  const rows = await sql`DELETE FROM hod_territory WHERE id = ${id} RETURNING id`;
  return { deleted: rows.length > 0 };
}
