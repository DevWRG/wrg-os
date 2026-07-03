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
