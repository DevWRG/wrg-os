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

// Daftar terkurasi: hanya AM yang sudah punya row sales_target_am (ditambah via
// picker). nama/cabang di-join dari master_user; region turunan dari cabang.
export async function listAmTargets(year: number): Promise<AmTargetRow[]> {
  const sql = db();
  const rows = await sql<{ am_id: string; nama: string | null; cabang: string | null; target: number }[]>`
    SELECT sta.am_id, mu.nama, NULLIF(mu.cabang, '') AS cabang, sta.target::float8 AS target
    FROM sales_target_am sta
    LEFT JOIN master_user mu ON mu.am_id = sta.am_id
    WHERE sta.year = ${year}
    ORDER BY mu.nama NULLS LAST, sta.am_id`;
  const regionMap = await cabangRegionMap(sql);
  return rows.map((r) => ({
    am_id: r.am_id,
    nama: r.nama ?? r.am_id,
    cabang: r.cabang,
    region: (r.cabang && regionMap[r.cabang]) || "OFFICE",
    target: Number(r.target ?? 0),
  }));
}

export interface AmCandidate {
  am_id: string;
  nama: string;
  cabang: string | null;
  region: ScopeRegion;
  role: string | null;
}

// Kandidat untuk picker "+ Tambah AM": orang di master_user (aktif) yang BELUM
// ada di daftar target tahun tsb.
export async function listAmCandidates(year: number): Promise<AmCandidate[]> {
  const sql = db();
  const rows = await sql<{ am_id: string; nama: string; cabang: string | null; role: string | null }[]>`
    SELECT am_id, nama, NULLIF(cabang, '') AS cabang, role FROM master_user
    WHERE aktif IS NOT FALSE
      AND am_id NOT IN (SELECT am_id FROM sales_target_am WHERE year = ${year})
    ORDER BY nama`;
  const regionMap = await cabangRegionMap(sql);
  return rows.map((r) => ({
    am_id: r.am_id,
    nama: r.nama,
    cabang: r.cabang,
    region: (r.cabang && regionMap[r.cabang]) || "OFFICE",
    role: r.role,
  }));
}

export async function deleteAmTarget(year: number, am_id: string): Promise<{ deleted: number }> {
  const sql = db();
  const rows = await sql`DELETE FROM sales_target_am WHERE year = ${year} AND am_id = ${am_id} RETURNING am_id`;
  return { deleted: rows.length };
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
