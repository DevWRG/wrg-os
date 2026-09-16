import { db } from "../db.js";
import { FULL_SCOPE, scopeOnClause, type DataScope } from "./access-scope.js";

// Read model customers — diturunkan dari deal (schema kanonik tak punya tabel
// customer terpisah). Agregat per customer_id: jumlah deal, nilai, stage, AM.
//
// Scope-nya lewat deal.am_id/deal.cabang (bukan pemilik akun) karena isinya
// memang deal — konsisten dengan Pipeline yang sumbernya tabel sama.

export interface CustomerRow {
  customer_id: string | null;
  customer_name: string;
  deal_count: number;
  total_value: number;
  ams: string[];
  stages: string[];
  last_activity: string;
}

export async function getCustomers(amId?: string, scope: DataScope = FULL_SCOPE): Promise<CustomerRow[]> {
  const sql = db();
  const filter = amId ? sql`WHERE am_id = ${amId}` : sql`WHERE true`;
  const rows = await sql`
    SELECT
      customer_id,
      max(customer_name)                 AS customer_name,
      count(*)                           AS deal_count,
      COALESCE(sum(estimated_value), 0)  AS total_value,
      array_agg(DISTINCT am_id)          AS ams,
      array_agg(DISTINCT stage)          AS stages,
      max(updated_at)                    AS last_activity
    FROM deal ${filter} ${scopeOnClause(sql, scope, sql`am_id`, sql`NULLIF(cabang,'')`)}
    GROUP BY customer_id
    ORDER BY last_activity DESC
  `;
  return rows.map((r) => ({
    // BUKAN String(r.customer_id) — deal.customer_id sering NULL, dan
    // String(null) === "null" (literal teks), bukan JSON null. Konsumen
    // (mis. F15 /sph/new customer picker) sempat kebawa "null" apa adanya.
    customer_id: r.customer_id === null ? null : String(r.customer_id),
    customer_name: String(r.customer_name),
    deal_count: Number(r.deal_count),
    total_value: Number(r.total_value),
    ams: (r.ams as string[]) ?? [],
    stages: (r.stages as string[]) ?? [],
    last_activity: String(r.last_activity),
  }));
}
