import { db } from "../db.js";

// D1 — competitor intelligence (port legacy competitor_intel). Catatan harga/
// produk pesaing dari lapangan + ringkasan per-vendor.
//
// F131 (13 Okt 2026): vendor dinormalkan (norm_vendor: "PT Saba" = "Saba", alias
// brand kanonik) dan sebutan BRAND WAHANA SENDIRI (brand_sendiri — brand yang
// muncul di faktur 24 bln) disembunyikan secara bawaan — di prod 33% sebutan
// lama ternyata Zybio/Wondfo/Vivachek. `termasukSendiri` untuk melihat semuanya.

export interface CompetitorInput {
  am_id?: string;
  customer_name?: string;
  tanggal: string;
  vendor: string;
  produk?: string;
  produk_kategori?: string;
  harga_text?: string;
  harga_numeric?: number;
  konteks?: string;
  source?: string;
  activity_id?: number | null; // laporan #REPORT asal (ekstraksi)
  account_id?: number | null;  // accurate_customer.id faskes
}

export async function recordCompetitor(c: CompetitorInput): Promise<{ id: string }> {
  const sql = db();
  const rows = await sql`
    INSERT INTO competitor_intel
      (am_id, customer_name, tanggal, vendor, produk, produk_kategori, harga_text, harga_numeric, konteks, source,
       activity_id, account_id)
    VALUES
      (${c.am_id ?? null}, ${c.customer_name ?? null}, ${c.tanggal}, ${c.vendor},
       ${c.produk ?? null}, ${c.produk_kategori ?? null}, ${c.harga_text ?? null},
       ${c.harga_numeric ?? null}, ${c.konteks ?? null}, ${c.source ?? "manual"},
       ${c.activity_id ?? null}, ${c.account_id ?? null})
    RETURNING id
  `;
  return { id: String(rows[0].id) };
}

const sendiriSql = (sql: ReturnType<typeof db>) =>
  sql`(norm_vendor(vendor) IN (SELECT brand FROM brand_sendiri))`;

export async function listCompetitor(vendor?: string, limit = 1000, opts: { termasukSendiri?: boolean } = {}) {
  const sql = db();
  const rows = await sql`
    SELECT id, am_id, customer_name, tanggal::text, COALESCE(norm_vendor(vendor), vendor) AS vendor, produk, produk_kategori,
           harga_text, harga_numeric, konteks, ${sendiriSql(sql)} AS brand_sendiri
    FROM competitor_intel
    WHERE ${vendor ? sql`(vendor ILIKE ${"%" + vendor + "%"} OR norm_vendor(vendor) ILIKE ${"%" + vendor + "%"})` : sql`true`}
      ${opts.termasukSendiri ? sql`` : sql`AND NOT COALESCE(${sendiriSql(sql)}, false)`}
    ORDER BY tanggal DESC, created_at DESC
    LIMIT ${limit}
  `;
  return rows.map((r) => ({
    id: String(r.id),
    am_id: r.am_id ? String(r.am_id) : null,
    customer_name: r.customer_name ? String(r.customer_name) : null,
    tanggal: String(r.tanggal),
    vendor: String(r.vendor),
    produk: r.produk ? String(r.produk) : null,
    produk_kategori: r.produk_kategori ? String(r.produk_kategori) : null,
    harga_text: r.harga_text ? String(r.harga_text) : null,
    harga_numeric: r.harga_numeric === null ? null : Number(r.harga_numeric),
    konteks: r.konteks ? String(r.konteks) : null,
    brand_sendiri: Boolean(r.brand_sendiri),
  }));
}

export async function competitorSummary(opts: { termasukSendiri?: boolean } = {}) {
  const sql = db();
  const rows = await sql`
    SELECT COALESCE(norm_vendor(vendor), vendor) AS vendor, count(*)::int AS sebutan,
           round(avg(harga_numeric))::numeric AS harga_rata,
           max(tanggal)::text AS terakhir
    FROM competitor_intel
    WHERE ${opts.termasukSendiri ? sql`true` : sql`NOT COALESCE(${sendiriSql(sql)}, false)`}
    GROUP BY 1 ORDER BY sebutan DESC
  `;
  return rows.map((r) => ({
    vendor: String(r.vendor),
    sebutan: Number(r.sebutan),
    harga_rata: r.harga_rata === null ? null : Number(r.harga_rata),
    terakhir: String(r.terakhir),
  }));
}
