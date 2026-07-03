import { db } from "../db.js";

// Target penjualan per tahun/periode/region (tabel sales_region_target, migration 046).
// Dibaca reportSalesPerformance() untuk kartu Sales Performance, ditulis via menu
// Admin → Sales Targets.

export type TargetPeriod = "year" | "quarter" | "month";
export type TargetRegion = "East" | "West";

export interface TargetRow {
  year: number;
  period: TargetPeriod;
  region: TargetRegion;
  target: number;
}

export async function listTargets(year: number): Promise<TargetRow[]> {
  const sql = db();
  const rows = await sql`
    SELECT year, period, region, target::float8 AS target
    FROM sales_region_target WHERE year = ${year}
  `;
  return rows.map((r) => ({
    year: Number(r.year),
    period: r.period as TargetPeriod,
    region: r.region as TargetRegion,
    target: Number(r.target ?? 0),
  }));
}

// Upsert sekumpulan target untuk satu tahun (idempoten per (year,period,region)).
export async function upsertTargets(
  year: number,
  entries: { period: TargetPeriod; region: TargetRegion; target: number }[],
): Promise<{ saved: number }> {
  const sql = db();
  let saved = 0;
  for (const e of entries) {
    await sql`
      INSERT INTO sales_region_target (year, period, region, target, updated_at)
      VALUES (${year}, ${e.period}, ${e.region}, ${e.target}, now())
      ON CONFLICT (year, period, region)
      DO UPDATE SET target = EXCLUDED.target, updated_at = now()
    `;
    saved++;
  }
  return { saved };
}

// ── Target per Cabang & per AM (tahunan, migration 047). Independen dari target
// region. Region East/West diturunkan dari cabang via hod_territory (rocky=East,
// yogi=West), tidak disimpan.

export type ScopeRegion = "East" | "West" | "OFFICE";

// Map cabang → region dari hod_territory (rocky=East, yogi=West, lainnya OFFICE).
async function cabangRegionMap(sql: ReturnType<typeof db>): Promise<Record<string, ScopeRegion>> {
  const rows = await sql<{ hod_key: string; cabang: string }[]>`SELECT hod_key, cabang FROM hod_territory`;
  const map: Record<string, ScopeRegion> = {};
  for (const r of rows) {
    const region: ScopeRegion | null = r.hod_key === "rocky" ? "East" : r.hod_key === "yogi" ? "West" : null;
    if (region) map[r.cabang] = region; // hanya set utk cabang East/West; sisanya default OFFICE
  }
  return map;
}

export interface CabangTargetRow {
  cabang: string;
  region: ScopeRegion;
  target: number;
}

// Daftar cabang (distinct dari hod_territory) + region turunan + target tahun tsb.
export async function listCabangTargets(year: number): Promise<CabangTargetRow[]> {
  const sql = db();
  const [terr, targets] = await Promise.all([
    sql<{ cabang: string }[]>`SELECT DISTINCT cabang FROM hod_territory ORDER BY cabang`,
    sql<{ cabang: string; target: number }[]>`
      SELECT cabang, target::float8 AS target FROM sales_target_cabang WHERE year = ${year}`,
  ]);
  const regionMap = await cabangRegionMap(sql);
  const tMap = new Map(targets.map((t) => [t.cabang, Number(t.target ?? 0)]));
  return terr.map((r) => ({
    cabang: r.cabang,
    region: regionMap[r.cabang] ?? "OFFICE",
    target: tMap.get(r.cabang) ?? 0,
  }));
}

export async function upsertCabangTargets(
  year: number,
  entries: { cabang: string; target: number }[],
): Promise<{ saved: number }> {
  const sql = db();
  let saved = 0;
  for (const e of entries) {
    await sql`
      INSERT INTO sales_target_cabang (year, cabang, target, updated_at)
      VALUES (${year}, ${e.cabang}, ${e.target}, now())
      ON CONFLICT (year, cabang) DO UPDATE SET target = EXCLUDED.target, updated_at = now()
    `;
    saved++;
  }
  return { saved };
}

export interface AmTargetRow {
  am_id: string;
  nama: string;
  cabang: string | null;
  region: ScopeRegion;
  target: number;
}

// Roster AM (master_user role AM, aktif) + cabang + region turunan + target tahun tsb.
export async function listAmTargets(year: number): Promise<AmTargetRow[]> {
  const sql = db();
  const [ams, targets] = await Promise.all([
    sql<{ am_id: string; nama: string; cabang: string | null }[]>`
      SELECT am_id, nama, NULLIF(cabang, '') AS cabang FROM master_user
      WHERE upper(role) = 'AM' AND aktif IS NOT FALSE ORDER BY nama`,
    sql<{ am_id: string; target: number }[]>`
      SELECT am_id, target::float8 AS target FROM sales_target_am WHERE year = ${year}`,
  ]);
  const regionMap = await cabangRegionMap(sql);
  const tMap = new Map(targets.map((t) => [t.am_id, Number(t.target ?? 0)]));
  return ams.map((a) => ({
    am_id: a.am_id,
    nama: a.nama,
    cabang: a.cabang,
    region: (a.cabang && regionMap[a.cabang]) || "OFFICE",
    target: tMap.get(a.am_id) ?? 0,
  }));
}

export async function upsertAmTargets(
  year: number,
  entries: { am_id: string; target: number }[],
): Promise<{ saved: number }> {
  const sql = db();
  let saved = 0;
  for (const e of entries) {
    await sql`
      INSERT INTO sales_target_am (year, am_id, target, updated_at)
      VALUES (${year}, ${e.am_id}, ${e.target}, now())
      ON CONFLICT (year, am_id) DO UPDATE SET target = EXCLUDED.target, updated_at = now()
    `;
    saved++;
  }
  return { saved };
}
