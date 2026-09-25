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
  // Price List apa adanya dari sumber (sudah dibulatkan). NULL = hitung dari margin.
  price_list: string | null;
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
  price_list?: number | null;
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
  p.hpp::text, p.margin_pct::text, p.diskon_pct::text, p.price_list::text,
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
  // Bug ditemukan sesi QA jalur tulis 2026-08-27: dulu ON CONFLICT DO UPDATE
  // pakai `EXCLUDED.<kolom>` — kolom yang TIDAK dikirim di payload jatuh ke
  // default VALUES-nya (0/false), jadi partial-PATCH lewat endpoint ini
  // (mis. cuma kirim hpp) diam-diam NGE-RESET semua kolom lain ke 0/false,
  // termasuk pada baris yang sudah `published`. Fix: SET pakai
  // COALESCE(<nilai baru-atau-null>, pricelist.<kolom lama>) — kolom yang
  // tak dikirim (undefined → null) mempertahankan nilai lama, bukan ketimpa
  // default. VALUES tetap default 0/false utk baris BENAR-BENAR baru (belum
  // ada row lama buat di-COALESCE-kan).
  //
  // price_list DIKECUALIKAN dari pola COALESCE di atas (issue #1074, tindak
  // lanjut fix di atas): `??` tak bisa bedakan "field tak dikirim" dari
  // "sengaja dikirim null" — utk kolom LAIN itu gak masalah (NOT NULL,
  // NULL tak pernah valid), tapi price_list justru NULL BERMAKNA ("gak ada
  // angka override, hitung dari margin" — lihat 076_pricelist_price_list.sql).
  // COALESCE bikin `{price_list: null}` gak pernah benar2 ngosongin kolom
  // (ketiban nilai lama lagi). Fix: cek eksplisit apakah field-nya ADA di
  // payload (bukan cuma nilainya), CASE WHEN bukan COALESCE.
  const priceListSent = Object.prototype.hasOwnProperty.call(input, "price_list");
  const rows = await sql<{ product_id: string }[]>`
    INSERT INTO pricelist (
      product_id, hpp, margin_pct, diskon_pct, price_list,
      pct_wrg, pct_promosi, pct_hod_sales,
      total_point, min_incentive_pts, max_incentive_pts, min_redemption, cutoff_days,
      west_area_confirmation, east_area_confirmation, created_by
    ) VALUES (
      ${input.product_id}, ${input.hpp ?? 0}, ${input.margin_pct ?? 0}, ${input.diskon_pct ?? 0},
      ${input.price_list ?? null},
      ${input.pct_wrg ?? 0}, ${input.pct_promosi ?? 0}, ${input.pct_hod_sales ?? 0},
      ${input.total_point ?? 0}, ${input.min_incentive_pts ?? 0}, ${input.max_incentive_pts ?? 0},
      ${input.min_redemption ?? 0}, ${input.cutoff_days ?? 0},
      ${input.west_area_confirmation ?? false}, ${input.east_area_confirmation ?? false},
      ${input.created_by ?? null}
    )
    ON CONFLICT (product_id) DO UPDATE SET
      hpp = COALESCE(${input.hpp ?? null}, pricelist.hpp),
      margin_pct = COALESCE(${input.margin_pct ?? null}, pricelist.margin_pct),
      diskon_pct = COALESCE(${input.diskon_pct ?? null}, pricelist.diskon_pct),
      price_list = CASE WHEN ${priceListSent} THEN ${input.price_list ?? null} ELSE pricelist.price_list END,
      pct_wrg = COALESCE(${input.pct_wrg ?? null}, pricelist.pct_wrg),
      pct_promosi = COALESCE(${input.pct_promosi ?? null}, pricelist.pct_promosi),
      pct_hod_sales = COALESCE(${input.pct_hod_sales ?? null}, pricelist.pct_hod_sales),
      total_point = COALESCE(${input.total_point ?? null}, pricelist.total_point),
      min_incentive_pts = COALESCE(${input.min_incentive_pts ?? null}, pricelist.min_incentive_pts),
      max_incentive_pts = COALESCE(${input.max_incentive_pts ?? null}, pricelist.max_incentive_pts),
      min_redemption = COALESCE(${input.min_redemption ?? null}, pricelist.min_redemption),
      cutoff_days = COALESCE(${input.cutoff_days ?? null}, pricelist.cutoff_days),
      west_area_confirmation = COALESCE(${input.west_area_confirmation ?? null}, pricelist.west_area_confirmation),
      east_area_confirmation = COALESCE(${input.east_area_confirmation ?? null}, pricelist.east_area_confirmation),
      updated_at = now()
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
