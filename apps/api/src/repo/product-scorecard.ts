// F6 Product Performance Scorecard — kinerja per kategori → lini → brand → item.
//
// Pembaca: HoD Business IVD & Medical + Direktur (menu sendiri, izin 'product-scorecard').
// Melengkapi tab Per-Produk Sales Analytics (yang cuma per item) dengan:
//   - revenue NETTO teralokasi per baris (pola analyticsPerProduk — Σ = netto faktur),
//     dibanding periode sebelumnya (panjang sama) & periode sama tahun lalu;
//   - konsentrasi customer: jumlah customer, porsi customer terbesar, porsi 5 terbesar;
//   - perputaran stok: stok Accurate vs rata kiriman (DO) 3 bulan tutup terakhir, dan
//     jumlah item STOK MATI (stok > 0, tanpa kiriman maupun faktur 90 hari);
//   - tekanan kompetitor (F131): faskes yang menyebut vendor pesaing di kategori yang
//     dipetakan ke lini itu (product_line_kompetitor, migrasi 223), 365 hari;
//   - MARGIN hanya bila pemanggil boleh melihat HPP (BFF mengirim margin=1). HPP per
//     item diringkas dulu dan hanya dipakai bila TIDAK ambigu (satu nilai) — pola sama
//     dengan insentif.ts; satu kode bisa memetakan HPP Rp 665 rb s/d Rp 11,9 jt.
//
// Klasifikasi item = product_code lewat accurate_item_id, cadangan kode_2025 = item no.
// Kunci lini = (kategori_id, line_id) — id lini tak unik sendirian. Item tak terpetakan
// dikelompokkan "Belum terklasifikasi" (prod 15 Okt: ±24% revenue 2026).

import { db } from "../db.js";
import { scopeAccurateClause, FULL_SCOPE, type DataScope } from "./access-scope.js";
import { joinAmFromSalesman } from "./salesman-am.js";
import { salesRange } from "./sales.js";
import { periodeHppDefault } from "./insentif.js";

export type Level = "kategori" | "lini" | "brand" | "item";
export const LEVELS: Level[] = ["kategori", "lini", "brand", "item"];
export const TANPA_KLAS = "__tanpa__";
export const MATI_HARI = 90;
export const KOMPETITOR_HARI = 365;

// ── Murni ────────────────────────────────────────────────────────────────

const hariAntara = (a: string, b: string): number =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
const geser = (iso: string, hari: number): string =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + hari * 86_400_000).toISOString().slice(0, 10);
const tahunLalu = (iso: string): string => {
  const [y, m, d] = iso.split("-").map(Number);
  const t = new Date(Date.UTC(y - 1, m - 1, d));
  if (t.getUTCMonth() !== m - 1) t.setUTCDate(0); // 29 Feb → 28 Feb
  return t.toISOString().slice(0, 10);
};

/** Periode pembanding: sebelum (panjang sama, tepat sebelum `from`) & tahun lalu. */
export function periodeBanding(from: string, to: string) {
  const panjang = hariAntara(from, to) + 1;
  return {
    sebelum: { from: geser(from, -panjang), to: geser(from, -1) },
    tahun_lalu: { from: tahunLalu(from), to: tahunLalu(to) },
    hari: panjang,
  };
}

/** Pertumbuhan relatif; null bila pembanding 0/tak ada. */
export const tumbuh = (kini: number, dulu: number): number | null => (dulu > 0 ? (kini - dulu) / dulu : null);

/** Rentang aman: maksimal 366 hari supaya jendela "tahun lalu" tak menimpa jendela kini. */
export function rentang(from0?: string, to0?: string): { from: string; to: string; dipotong: boolean } {
  const { from, to } = salesRange(from0, to0);
  if (hariAntara(from, to) > 365) return { from: geser(to, -365), to, dipotong: true };
  return { from, to, dipotong: false };
}

// ── Kueri ────────────────────────────────────────────────────────────────

type Sql = ReturnType<typeof db>;

export interface BarisScorecard {
  key: string;
  label: string;
  sub: string | null;           // konteks: kategori untuk lini, lini untuk brand/item
  revenue: number;
  revenue_sebelum: number;
  revenue_tahun_lalu: number;
  tumbuh_sebelum: number | null;
  tumbuh_tahun_lalu: number | null;
  porsi: number;                // dari total revenue periode (sesudah filter induk)
  qty: number;
  customer: number;
  top1_nama: string | null;
  top1_porsi: number | null;
  top5_porsi: number | null;
  item: number;                 // item terjual di periode
  stok_bulan: number | null;    // median bulan stok item terjual (stok / kiriman per bln)
  stok_mati: number;            // item stok > 0 tanpa kiriman & faktur 90 hari
  kompetitor_faskes: number | null;
  kompetitor_vendor: string[] | null;
  // margin — hanya bila diminta & berhak
  gp?: number | null;
  gp_pct?: number | null;
  hpp_cakupan?: number | null;  // porsi revenue yang punya HPP tak ambigu
}

export interface OpsiScorecard {
  from?: string;
  to?: string;
  level?: string;
  kategori?: string;  // kategori_id
  lini?: string;      // "KK.LL"
  brand?: string;
  margin?: boolean;
  scope?: DataScope;
}

export async function productScorecard(o: OpsiScorecard = {}) {
  const sql = db();
  const level: Level = (LEVELS as string[]).includes(o.level ?? "") ? (o.level as Level) : "kategori";
  const sc = o.scope ?? FULL_SCOPE;
  const { from, to, dipotong } = rentang(o.from, o.to);
  const b = periodeBanding(from, to);
  const awal = b.tahun_lalu.from < b.sebelum.from ? b.tahun_lalu.from : b.sebelum.from;
  const [katF, lineF] = o.lini && /^\d{2}\.\d{2}$/.test(o.lini) ? o.lini.split(".") : [null, null];
  const kat = o.kategori && /^\d{2}$|^__tanpa__$/.test(o.kategori) ? o.kategori : katF;
  const brand = o.brand?.trim() || null;
  const periodeHpp = periodeHppDefault();

  const keySql = level === "kategori" ? sql`COALESCE(k.kategori_id, ${TANPA_KLAS})`
    : level === "lini" ? sql`COALESCE(k.kategori_id || '.' || k.line_id, ${TANPA_KLAS})`
    : level === "brand" ? sql`COALESCE(NULLIF(btrim(k.brand), ''), '(tanpa brand)')`
    : sql`l.item_id::text`;

  const rows = await sql`
    WITH inv AS (
      SELECT ai.id, ai.customer_id, ai.tanggal, (ai.total - COALESCE(ai.tax_amount, 0))::float8 AS inv_net,
             CASE WHEN ai.tanggal BETWEEN ${from} AND ${to} THEN 'kini'
                  WHEN ai.tanggal BETWEEN ${b.sebelum.from} AND ${b.sebelum.to} THEN 'sebelum'
                  WHEN ai.tanggal BETWEEN ${b.tahun_lalu.from} AND ${b.tahun_lalu.to} THEN 'tahun_lalu' END AS win
      FROM accurate_invoice ai
      LEFT JOIN accurate_salesman acs ON acs.id = ai.salesman_id
      ${joinAmFromSalesman(sql)}
      WHERE ai.tanggal BETWEEN ${awal} AND ${to} ${scopeAccurateClause(sql, sc)}
    ),
    baris AS (
      SELECT aii.item_id, aii.qty, inv.customer_id, inv.win,
             CASE WHEN sum(GREATEST(aii.total, 0)) OVER (PARTITION BY aii.invoice_id) > 0
                  THEN inv.inv_net * GREATEST(aii.total, 0) / sum(GREATEST(aii.total, 0)) OVER (PARTITION BY aii.invoice_id)
                  ELSE inv.inv_net / count(*) OVER (PARTITION BY aii.invoice_id) END AS net
      FROM accurate_invoice_item aii JOIN inv ON inv.id = aii.invoice_id
      WHERE inv.win IS NOT NULL
    ),
    klas AS (  -- satu klasifikasi per item Accurate
      SELECT DISTINCT ON (it.id) it.id AS item_id, pc.kategori_id, pc.line_id, pc.brand
      FROM accurate_item it
      JOIN product_code pc ON pc.accurate_item_id = it.id OR (pc.kode_2025 IS NOT NULL AND pc.kode_2025 = it.no)
      ORDER BY it.id, (pc.accurate_item_id = it.id) DESC, pc.kode
    ),
    l AS (
      SELECT b.*, k.kategori_id, k.line_id, k.brand FROM baris b LEFT JOIN klas k ON k.item_id = b.item_id
      WHERE true
        ${kat === TANPA_KLAS ? sql`AND k.kategori_id IS NULL` : kat ? sql`AND k.kategori_id = ${kat}` : sql``}
        ${lineF ? sql`AND k.line_id = ${lineF}` : sql``}
        ${brand ? sql`AND COALESCE(NULLIF(btrim(k.brand), ''), '(tanpa brand)') = ${brand}` : sql``}
    ),
    g AS (
      SELECT ${keySql} AS key, l.*, l.kategori_id AS kategori_id_, l.line_id AS line_id_
      FROM l LEFT JOIN klas k ON k.item_id = l.item_id
    ),
    cust AS (
      SELECT key, customer_id, sum(net) AS rev,
             row_number() OVER (PARTITION BY key ORDER BY sum(net) DESC) AS rn
      FROM g WHERE win = 'kini' GROUP BY key, customer_id
    ),
    konsen AS (
      SELECT c.key,
             max(COALESCE(NULLIF(ac.name, ''), 'Customer #' || c.customer_id::text)) FILTER (WHERE c.rn = 1) AS top1_nama,
             sum(c.rev) FILTER (WHERE c.rn = 1) AS top1, sum(c.rev) FILTER (WHERE c.rn <= 5) AS top5
      FROM cust c LEFT JOIN accurate_customer ac ON ac.id = c.customer_id
      GROUP BY c.key
    ),
    agg AS (
      SELECT key,
             COALESCE(sum(net) FILTER (WHERE win = 'kini'), 0)::float8 AS rev,
             COALESCE(sum(net) FILTER (WHERE win = 'sebelum'), 0)::float8 AS rev_sebelum,
             COALESCE(sum(net) FILTER (WHERE win = 'tahun_lalu'), 0)::float8 AS rev_ly,
             COALESCE(sum(qty) FILTER (WHERE win = 'kini'), 0)::float8 AS qty,
             count(DISTINCT customer_id) FILTER (WHERE win = 'kini')::int AS customer,
             count(DISTINCT item_id) FILTER (WHERE win = 'kini')::int AS item,
             min(kategori_id_) AS kategori_id, min(line_id_) AS line_id
      FROM g GROUP BY key
    )
    SELECT a.*, kn.top1_nama, kn.top1::float8, kn.top5::float8
    FROM agg a LEFT JOIN konsen kn ON kn.key = a.key
    WHERE a.rev > 0 OR a.rev_sebelum > 0 OR a.rev_ly > 0`;

  const keys = rows.map((r) => String(r.key));
  const [label, stok, mati, kompetitor, margin] = await Promise.all([
    labelKunci(sql, level, keys),
    stokPerKunci(sql, level, kat, lineF, brand, rows.filter((r) => Number(r.item) > 0).map((r) => String(r.key))),
    stokMati(sql, level, kat, lineF, brand),
    level === "kategori" || level === "lini" ? kompetitorPerKunci(sql, level, keys) : Promise.resolve(null),
    o.margin ? marginPerKunci(sql, level, kat, lineF, brand, from, to, sc, periodeHpp) : Promise.resolve(null),
  ]);

  const total = rows.reduce((s, r) => s + Number(r.rev), 0);
  const hasil: BarisScorecard[] = rows.map((r) => {
    const key = String(r.key);
    const rev = Number(r.rev);
    const lb = label.get(key);
    const kom = kompetitor?.get(key);
    const m = margin?.get(key);
    const base: BarisScorecard = {
      key, label: lb?.label ?? key, sub: lb?.sub ?? null,
      revenue: rev, revenue_sebelum: Number(r.rev_sebelum), revenue_tahun_lalu: Number(r.rev_ly),
      tumbuh_sebelum: tumbuh(rev, Number(r.rev_sebelum)), tumbuh_tahun_lalu: tumbuh(rev, Number(r.rev_ly)),
      porsi: total > 0 ? rev / total : 0, qty: Number(r.qty), customer: Number(r.customer),
      top1_nama: r.top1_nama ? String(r.top1_nama) : null,
      top1_porsi: rev > 0 && r.top1 != null ? Number(r.top1) / rev : null,
      top5_porsi: rev > 0 && r.top5 != null ? Number(r.top5) / rev : null,
      item: Number(r.item), stok_bulan: stok.get(key) ?? null, stok_mati: mati.get(key) ?? 0,
      kompetitor_faskes: kom ? kom.faskes : kompetitor ? 0 : null,
      kompetitor_vendor: kom ? kom.vendor : kompetitor ? [] : null,
    };
    if (o.margin) {
      base.gp = m && m.rev_hpp > 0 ? m.gp : null;
      base.gp_pct = m && m.rev_hpp > 0 ? m.gp / m.rev_hpp : null;
      base.hpp_cakupan = rev > 0 && m ? m.rev_hpp / rev : null;
    }
    return base;
  }).sort((a, b) => b.revenue - a.revenue);

  return {
    level, range: { from, to, dipotong }, banding: b, filter: { kategori: kat, lini: o.lini ?? null, brand },
    margin: Boolean(o.margin), periode_hpp: o.margin ? periodeHpp : null,
    ringkas: {
      revenue: total,
      revenue_sebelum: rows.reduce((s, r) => s + Number(r.rev_sebelum), 0),
      revenue_tahun_lalu: rows.reduce((s, r) => s + Number(r.rev_ly), 0),
      terklasifikasi: total > 0 ? hasil.filter((h) => h.key !== TANPA_KLAS).reduce((s, h) => s + h.revenue, 0) / total : null,
    },
    rows: hasil,
  };
}

async function labelKunci(sql: Sql, level: Level, keys: string[]): Promise<Map<string, { label: string; sub: string | null }>> {
  const m = new Map<string, { label: string; sub: string | null }>();
  m.set(TANPA_KLAS, { label: "Belum terklasifikasi", sub: "item tanpa kode di Klasifikasi Produk" });
  if (level === "kategori") {
    for (const r of await sql`SELECT id, nama FROM product_kategori`) m.set(String(r.id), { label: String(r.nama), sub: null });
  } else if (level === "lini") {
    for (const r of await sql`SELECT l.kategori_id || '.' || l.id AS key, l.nama, k.nama AS kat FROM product_line l JOIN product_kategori k ON k.id = l.kategori_id`) {
      m.set(String(r.key), { label: String(r.nama), sub: String(r.kat) });
    }
  } else if (level === "item") {
    const ids = keys.filter((k) => /^\d+$/.test(k));
    if (ids.length) {
      for (const r of await sql`SELECT it.id::text AS key, COALESCE(NULLIF(it.name, ''), it.no) AS nama, it.no FROM accurate_item it WHERE it.id = ANY(${ids}::bigint[])`) {
        m.set(String(r.key), { label: String(r.nama), sub: r.no ? String(r.no) : null });
      }
    }
  }
  return m;
}

// Klasifikasi item yang SAMA dengan kueri utama, dipakai ulang untuk stok/HPP.
const klasSql = (sql: Sql) => sql`
  SELECT DISTINCT ON (it.id) it.id AS item_id, it.no, it.quantity, pc.kategori_id, pc.line_id, pc.brand
  FROM accurate_item it
  LEFT JOIN product_code pc ON pc.accurate_item_id = it.id OR (pc.kode_2025 IS NOT NULL AND pc.kode_2025 = it.no)
  ORDER BY it.id, (pc.accurate_item_id = it.id) DESC NULLS LAST, pc.kode`;

const kunciKlas = (sql: Sql, level: Level) =>
  level === "kategori" ? sql`COALESCE(k.kategori_id, ${TANPA_KLAS})`
    : level === "lini" ? sql`COALESCE(k.kategori_id || '.' || k.line_id, ${TANPA_KLAS})`
    : level === "brand" ? sql`COALESCE(NULLIF(btrim(k.brand), ''), '(tanpa brand)')`
    : sql`k.item_id::text`;

const saringKlas = (sql: Sql, kat: string | null, lineF: string | null, brand: string | null) => sql`
  ${kat === TANPA_KLAS ? sql`AND k.kategori_id IS NULL` : kat ? sql`AND k.kategori_id = ${kat}` : sql``}
  ${lineF ? sql`AND k.line_id = ${lineF}` : sql``}
  ${brand ? sql`AND COALESCE(NULLIF(btrim(k.brand), ''), '(tanpa brand)') = ${brand}` : sql``}`;

/** Median bulan stok per kunci, dari item yang punya kiriman 3 bulan tutup terakhir. */
async function stokPerKunci(sql: Sql, level: Level, kat: string | null, lineF: string | null, brand: string | null, keys: string[]) {
  const m = new Map<string, number>();
  if (!keys.length) return m;
  const rows = await sql`
    WITH k AS (${klasSql(sql)}),
    dl AS (
      SELECT i.item_no, sum(i.qty)::float8 / 3 AS per_bln
      FROM accurate_delivery_order o JOIN accurate_delivery_order_item i ON i.delivery_id = o.id
      WHERE o.trans_date >= date_trunc('month', current_date) - interval '3 months'
        AND o.trans_date < date_trunc('month', current_date)
      GROUP BY 1 HAVING sum(i.qty) > 0
    )
    SELECT ${kunciKlas(sql, level)} AS key,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY GREATEST(COALESCE(k.quantity, 0), 0) / dl.per_bln)::float8 AS bulan
    FROM k JOIN dl ON dl.item_no = k.no
    WHERE true ${saringKlas(sql, kat, lineF, brand)}
    GROUP BY 1`;
  const ada = new Set(keys);
  for (const r of rows) if (ada.has(String(r.key))) m.set(String(r.key), Number(r.bulan));
  return m;
}

/** Jumlah item stok mati per kunci: stok > 0, tanpa kiriman DO & tanpa faktur 90 hari. */
async function stokMati(sql: Sql, level: Level, kat: string | null, lineF: string | null, brand: string | null) {
  const rows = await sql`
    WITH k AS (${klasSql(sql)})
    SELECT ${kunciKlas(sql, level)} AS key, count(*)::int AS n
    FROM k
    WHERE k.quantity > 0 ${saringKlas(sql, kat, lineF, brand)}
      AND NOT EXISTS (SELECT 1 FROM accurate_delivery_order_item i JOIN accurate_delivery_order o ON o.id = i.delivery_id
                      WHERE i.item_no = k.no AND o.trans_date >= current_date - ${MATI_HARI}::int)
      AND NOT EXISTS (SELECT 1 FROM accurate_invoice_item ii JOIN accurate_invoice ai ON ai.id = ii.invoice_id
                      WHERE ii.item_id = k.item_id AND ai.tanggal >= current_date - ${MATI_HARI}::int)
    GROUP BY 1`;
  return new Map(rows.map((r) => [String(r.key), Number(r.n)]));
}

/** Faskes yang menyebut vendor pesaing di kategori kompetitor yang dipetakan ke kunci. */
async function kompetitorPerKunci(sql: Sql, level: Level, keys: string[]) {
  const kunci = level === "kategori" ? sql`m.kategori_id` : sql`m.kategori_id || '.' || m.line_id`;
  const rows = await sql`
    WITH ci AS (
      SELECT DISTINCT ci.account_id, norm_vendor(ci.vendor) AS vendor,
             btrim(split_part(COALESCE(ci.produk_kategori, ''), '|', 1)) AS kat
      FROM competitor_intel ci
      WHERE ci.tanggal > current_date - ${KOMPETITOR_HARI}::int AND ci.account_id IS NOT NULL
        AND norm_vendor(ci.vendor) IS NOT NULL
        AND norm_vendor(ci.vendor) NOT IN (SELECT brand FROM brand_sendiri)
    ),
    j AS (
      SELECT ${kunci} AS key, ci.account_id, ci.vendor
      FROM product_line_kompetitor m JOIN ci ON ci.kat = m.kategori_kompetitor
    ),
    v AS (SELECT key, vendor, count(DISTINCT account_id) AS n,
                 row_number() OVER (PARTITION BY key ORDER BY count(DISTINCT account_id) DESC, vendor) AS rn
          FROM j GROUP BY key, vendor)
    SELECT j.key, count(DISTINCT j.account_id)::int AS faskes,
           (SELECT array_agg(v.vendor || ' (' || v.n || ')' ORDER BY v.rn) FROM v WHERE v.key = j.key AND v.rn <= 3) AS vendor
    FROM j GROUP BY j.key`;
  const ada = new Set(keys);
  const m = new Map<string, { faskes: number; vendor: string[] }>();
  for (const r of rows) if (ada.has(String(r.key))) m.set(String(r.key), { faskes: Number(r.faskes), vendor: (r.vendor as string[]) ?? [] });
  return m;
}

/** GP per kunci dari baris yang item-nya punya HPP TIDAK ambigu (n_hpp = 1). */
async function marginPerKunci(sql: Sql, level: Level, kat: string | null, lineF: string | null, brand: string | null,
  from: string, to: string, sc: DataScope, periodeHpp: string) {
  const rows = await sql`
    WITH hpp_item AS (
      SELECT pc.accurate_item_id AS item_id, min(pps.hpp) AS hpp, count(DISTINCT pps.hpp) AS n_hpp
      FROM product_code pc
      JOIN product_pricelist_setup pps ON pps.product_kode = pc.kode AND pps.periode = ${periodeHpp}
      WHERE pc.accurate_item_id IS NOT NULL AND pps.hpp IS NOT NULL
      GROUP BY pc.accurate_item_id
    ),
    inv AS (
      SELECT ai.id, (ai.total - COALESCE(ai.tax_amount, 0))::float8 AS inv_net
      FROM accurate_invoice ai
      LEFT JOIN accurate_salesman acs ON acs.id = ai.salesman_id
      ${joinAmFromSalesman(sql)}
      WHERE ai.tanggal BETWEEN ${from} AND ${to} ${scopeAccurateClause(sql, sc)}
    ),
    baris AS (
      SELECT aii.item_id, COALESCE(aii.qty, 0) AS qty,
             CASE WHEN sum(GREATEST(aii.total, 0)) OVER (PARTITION BY aii.invoice_id) > 0
                  THEN inv.inv_net * GREATEST(aii.total, 0) / sum(GREATEST(aii.total, 0)) OVER (PARTITION BY aii.invoice_id)
                  ELSE inv.inv_net / count(*) OVER (PARTITION BY aii.invoice_id) END AS net
      FROM accurate_invoice_item aii JOIN inv ON inv.id = aii.invoice_id
    ),
    k AS (${klasSql(sql)})
    SELECT ${kunciKlas(sql, level)} AS key,
           COALESCE(sum(b.net) FILTER (WHERE h.n_hpp = 1), 0)::float8 AS rev_hpp,
           COALESCE(sum(b.net - h.hpp * b.qty) FILTER (WHERE h.n_hpp = 1), 0)::float8 AS gp
    FROM baris b JOIN k ON k.item_id = b.item_id
    LEFT JOIN hpp_item h ON h.item_id = b.item_id
    WHERE true ${saringKlas(sql, kat, lineF, brand)}
    GROUP BY 1`;
  return new Map(rows.map((r) => [String(r.key), { rev_hpp: Number(r.rev_hpp), gp: Number(r.gp) }]));
}
