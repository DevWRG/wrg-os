// Pricelist — harga jual per produk (tabel pricelist, FK ke accurate_item).
// Basis harga = Harga Principal (hpp) yang diinput manual; accurate_item dipakai
// untuk identitas + harga average (referensi). Harga turunan dihitung di web.
import { db } from "../db.js";

export interface PricelistRow {
  id: string;
  product_id: string;
  // identitas produk (JOIN accurate_item)
  product_no: string | null;
  product_name: string | null;
  product_category: string | null;
  product_avg_price: string | null; // accurate_item.unit_price (average, referensi)
  // input harga
  hpp: string;
  margin_pct: string;
  diskon_pct: string;
  // insentif
  pct_wrg: string;
  pct_promosi: string;
  pct_hod_sales: string;
  // loyalty
  total_point: number;
  min_incentive_pts: number;
  max_incentive_pts: number;
  min_redemption: number;
  cutoff_days: number;
  // konfirmasi
  west_area_confirmation: boolean;
  east_area_confirmation: boolean;
  // status
  status: string;
  published_at: string | null;
  published_by: string | null;
  updated_at: string;
}

export interface PricelistInput {
  product_id: string | number;
  hpp?: number;
  margin_pct?: number;
  diskon_pct?: number;
  pct_wrg?: number;
  pct_promosi?: number;
  pct_hod_sales?: number;
  total_point?: number;
  min_incentive_pts?: number;
  max_incentive_pts?: number;
  min_redemption?: number;
  cutoff_days?: number;
  west_area_confirmation?: boolean;
  east_area_confirmation?: boolean;
  created_by?: string | null;
}

const COLS = (sql: ReturnType<typeof db>) => sql`
  p.id::text, p.product_id::text,
  i.no AS product_no, i.name AS product_name, i.category AS product_category,
  i.unit_price::text AS product_avg_price,
  p.hpp::text, p.margin_pct::text, p.diskon_pct::text,
  p.pct_wrg::text, p.pct_promosi::text, p.pct_hod_sales::text,
  p.total_point, p.min_incentive_pts, p.max_incentive_pts, p.min_redemption, p.cutoff_days,
  p.west_area_confirmation, p.east_area_confirmation,
  p.status, p.published_at::text, p.published_by, p.updated_at::text`;

export async function listPricelist(status?: string): Promise<PricelistRow[]> {
  const sql = db();
  return sql<PricelistRow[]>`
    SELECT ${COLS(sql)}
    FROM pricelist p
    JOIN accurate_item i ON i.id = p.product_id
    ${status ? sql`WHERE p.status = ${status}` : sql``}
    ORDER BY i.name`;
}

export async function getPricelistByProduct(productId: string | number): Promise<PricelistRow | null> {
  const sql = db();
  const rows = await sql<PricelistRow[]>`
    SELECT ${COLS(sql)}
    FROM pricelist p
    JOIN accurate_item i ON i.id = p.product_id
    WHERE p.product_id = ${productId}`;
  return rows[0] ?? null;
}

export async function upsertPricelist(input: PricelistInput): Promise<PricelistRow | null> {
  const sql = db();
  const rows = await sql<{ product_id: string }[]>`
    INSERT INTO pricelist (
      product_id, hpp, margin_pct, diskon_pct,
      pct_wrg, pct_promosi, pct_hod_sales,
      total_point, min_incentive_pts, max_incentive_pts, min_redemption, cutoff_days,
      west_area_confirmation, east_area_confirmation, created_by
    ) VALUES (
      ${input.product_id}, ${input.hpp ?? 0}, ${input.margin_pct ?? 0}, ${input.diskon_pct ?? 0},
      ${input.pct_wrg ?? 0}, ${input.pct_promosi ?? 0}, ${input.pct_hod_sales ?? 0},
      ${input.total_point ?? 0}, ${input.min_incentive_pts ?? 0}, ${input.max_incentive_pts ?? 0},
      ${input.min_redemption ?? 0}, ${input.cutoff_days ?? 0},
      ${input.west_area_confirmation ?? false}, ${input.east_area_confirmation ?? false},
      ${input.created_by ?? null}
    )
    ON CONFLICT (product_id) DO UPDATE SET
      hpp = EXCLUDED.hpp, margin_pct = EXCLUDED.margin_pct, diskon_pct = EXCLUDED.diskon_pct,
      pct_wrg = EXCLUDED.pct_wrg, pct_promosi = EXCLUDED.pct_promosi, pct_hod_sales = EXCLUDED.pct_hod_sales,
      total_point = EXCLUDED.total_point, min_incentive_pts = EXCLUDED.min_incentive_pts,
      max_incentive_pts = EXCLUDED.max_incentive_pts, min_redemption = EXCLUDED.min_redemption,
      cutoff_days = EXCLUDED.cutoff_days, west_area_confirmation = EXCLUDED.west_area_confirmation,
      east_area_confirmation = EXCLUDED.east_area_confirmation, updated_at = now()
    RETURNING product_id::text`;
  const pid = rows[0]?.product_id;
  return pid == null ? null : getPricelistByProduct(pid);
}

// Publikasikan baris draft. ids kosong/undefined → publish SEMUA draft.
export async function publishPricelist(
  ids: string[] | undefined,
  by: string | null,
): Promise<{ published: number }> {
  const sql = db();
  const rows =
    ids && ids.length
      ? await sql`
          UPDATE pricelist SET status = 'published', published_at = now(), published_by = ${by}, updated_at = now()
          WHERE id = ANY(${ids}::uuid[]) AND status = 'draft' RETURNING id`
      : await sql`
          UPDATE pricelist SET status = 'published', published_at = now(), published_by = ${by}, updated_at = now()
          WHERE status = 'draft' RETURNING id`;
  return { published: rows.length };
}

// Tarik kembali baris published → draft. ids kosong/undefined → semua published.
export async function unpublishPricelist(
  ids: string[] | undefined,
): Promise<{ unpublished: number }> {
  const sql = db();
  const rows =
    ids && ids.length
      ? await sql`
          UPDATE pricelist SET status = 'draft', published_at = NULL, published_by = NULL, updated_at = now()
          WHERE id = ANY(${ids}::uuid[]) AND status = 'published' RETURNING id`
      : await sql`
          UPDATE pricelist SET status = 'draft', published_at = NULL, published_by = NULL, updated_at = now()
          WHERE status = 'published' RETURNING id`;
  return { unpublished: rows.length };
}

export async function deletePricelist(id: string): Promise<{ deleted: boolean }> {
  const sql = db();
  const rows = await sql`DELETE FROM pricelist WHERE id = ${id} RETURNING id`;
  return { deleted: rows.length > 0 };
}
