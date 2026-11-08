// F150 (tahap 2) — pembacaan biaya per area (biaya_area_baris) + laba kotor per area untuk
// /revenue-area. Penulisan ada di biaya-area-sync.ts; aturan area di biaya-area-rules.ts.

import { db } from "../db.js";
import { KANTOR_PUSAT } from "./biaya-area-rules.js";
import { BIAYA_AREA_ENTITY } from "./biaya-area-sync.js";
import { cabangEffSql, joinAmFromSalesman } from "./salesman-am.js";
import { periodeHppDefault } from "./insentif.js";

export interface BiayaInput {
  /** area → biaya 6200 periode berjalan (area multi sudah dibagi rata). Bisa kosong (belum ada data biaya). */
  biaya: Map<string, number>;
  /** area → revenue ber-HPP & laba kotornya, periode berjalan. Selalu terisi, ada/tidaknya data biaya. */
  hpp: Map<string, { revHpp: number; gp: number }>;
  pusat: { operasional: number; sdm: number; luarUsaha: number; marketingFeeBelumTerpetakan: number };
  cakupan: { total: number; tertandai: number; pct: number | null; perDasar: { dasar: string; jumlah: number }[] };
  /** Waktu sinkron biaya terakhir (ISO). */
  terakhirSync: string | null;
}

/** "kota di keterangan (BALI)" → "kota di keterangan"; "titik layanan ST X" → "titik layanan ST". */
export const ringkasDasar = (d: string): string => d.replace(/ \(.*\)$/, "").replace(/ ST .*/, " ST");

/** Murni: gabungkan baris agregat dasar → ringkasan per dasar, terbesar dulu. */
export function gabungDasar(rows: { dasar: string; jumlah: number }[]): { dasar: string; jumlah: number }[] {
  const m = new Map<string, number>();
  for (const r of rows) m.set(ringkasDasar(r.dasar), (m.get(ringkasDasar(r.dasar)) ?? 0) + r.jumlah);
  return [...m].map(([dasar, jumlah]) => ({ dasar, jumlah: Math.round(jumlah) })).sort((a, b) => b.jumlah - a.jumlah);
}

/**
 * Null bila tabel belum ada / gagal (migrasi 257 belum diterapkan) — revenue tetap tampil.
 * `cur` = jendela periode berjalan.
 */
export async function muatBiayaInput(cur: { from: string; to: string }): Promise<BiayaInput | null> {
  const sql = db();
  try {
    // HPP/laba kotor tak bergantung data biaya → selalu dihitung (dulu hanya bila ada baris biaya).
    const [perArea, perKelompok, mf, perDasar, sync, hpp] = await Promise.all([
      sql`
        SELECT x.area, sum(x.j)::float8 AS j FROM (
          SELECT unnest(COALESCE(area_bagi, ARRAY[area])) AS area, jumlah / COALESCE(cardinality(area_bagi), 1) AS j
          FROM biaya_area_baris WHERE kelompok = 'OPERASIONAL' AND tanggal BETWEEN ${cur.from} AND ${cur.to}
        ) x GROUP BY x.area`,
      sql`SELECT kelompok, sum(jumlah)::float8 AS j FROM biaya_area_baris WHERE tanggal BETWEEN ${cur.from} AND ${cur.to} GROUP BY kelompok`,
      sql`
        SELECT COALESCE(sum(jumlah), 0)::float8 AS j FROM biaya_area_baris
        WHERE akun LIKE '6200-11%' AND area = ${KANTOR_PUSAT} AND NOT tertandai AND tanggal BETWEEN ${cur.from} AND ${cur.to}`,
      sql`
        SELECT dasar, sum(jumlah)::float8 AS jumlah, sum(jumlah) FILTER (WHERE tertandai)::float8 AS tertandai
        FROM biaya_area_baris WHERE kelompok = 'OPERASIONAL' AND tanggal BETWEEN ${cur.from} AND ${cur.to} GROUP BY dasar`,
      sql`SELECT last_synced_at FROM accurate_sync_state WHERE entity = ${BIAYA_AREA_ENTITY}`,
      hppPerArea(cur),
    ]);
    const biaya = new Map<string, number>();
    for (const r of perArea) if (String(r.area) !== KANTOR_PUSAT && String(r.area) !== "MULTI") biaya.set(String(r.area), Number(r.j));
    const kel = new Map(perKelompok.map((r) => [String(r.kelompok), Number(r.j)]));
    const pusatOps = Number(perArea.find((r) => String(r.area) === KANTOR_PUSAT)?.j ?? 0);
    const total = Number(kel.get("OPERASIONAL") ?? 0);
    const tertandai = perDasar.reduce((s, r) => s + Number(r.tertandai ?? 0), 0);
    return {
      biaya,
      hpp,
      pusat: { operasional: pusatOps, sdm: kel.get("SDM") ?? 0, luarUsaha: kel.get("LUAR USAHA") ?? 0, marketingFeeBelumTerpetakan: Number(mf[0]?.j ?? 0) },
      cakupan: {
        total: Math.round(total),
        tertandai: Math.round(tertandai),
        pct: total > 0 ? Math.round((tertandai / total) * 1000) / 10 : null,
        perDasar: gabungDasar(perDasar.map((r) => ({ dasar: String(r.dasar), jumlah: Number(r.jumlah) }))),
      },
      terakhirSync: sync[0]?.last_synced_at ? new Date(String(sync[0].last_synced_at)).toISOString() : null,
    };
  } catch (e) {
    console.error("[biaya-area] baca biaya gagal (migrasi 257 sudah diterapkan?):", (e as Error)?.message);
    return null;
  }
}

/**
 * Pagar kewajaran HPP. HPP di product_pricelist_setup per KEMASAN (mis. per box), sedangkan
 * qty faktur sering satuan kecil (PCS) → HPP × qty bisa ribuan kali nilai jual dan satu item
 * membuat laba kotor seluruh area minus. Sampai konversi satuan ada, baris yang
 * HPP × qty-nya > RASIO_HPP_MAKS × net (atau net ≤ 0) diperlakukan seperti "tanpa HPP":
 * revenue-nya tetap dihitung, tapi keluar dari rev_hpp/laba kotor (hppCakupanPct ikut turun).
 * Daftarnya: hppMencurigakan().
 */
export const RASIO_HPP_MAKS = 3;

/** Murni: baris faktur ikut laba kotor? Padanan SQL: wajarSql. */
export const hppWajar = (hpp: number, qty: number, net: number): boolean => net > 0 && hpp * qty <= RASIO_HPP_MAKS * net;

type Sql = ReturnType<typeof db>;

const wajarSql = (sql: Sql) => sql`(b.net > 0 AND h.hpp * b.qty <= ${RASIO_HPP_MAKS}::numeric * b.net)`;

/**
 * CTE bersama hppPerArea & hppMencurigakan: hpp_item (HPP per item Accurate, n_hpp = jumlah
 * HPP berbeda — hanya n_hpp = 1 yang dipakai) + baris (baris faktur periode berjalan, net =
 * netto faktur dialokasikan proporsional ke baris). Dipakai sesudah `WITH`.
 */
function barisHppCte(sql: Sql, cur: { from: string; to: string }) {
  const periodeHpp = periodeHppDefault();
  return sql`
    hpp_item AS (
      SELECT pc.accurate_item_id AS item_id, min(pps.hpp) AS hpp, count(DISTINCT pps.hpp) AS n_hpp, min(pc.kode) AS kode
      FROM product_code pc
      JOIN product_pricelist_setup pps ON pps.product_kode = pc.kode AND pps.periode = ${periodeHpp}
      WHERE pc.accurate_item_id IS NOT NULL AND pps.hpp IS NOT NULL
      GROUP BY pc.accurate_item_id
    ),
    inv AS (
      SELECT ai.id, COALESCE(${cabangEffSql(sql)}, 'Tanpa cabang') AS cabang, (ai.total - COALESCE(ai.tax_amount, 0))::float8 AS inv_net
      FROM accurate_invoice ai
      LEFT JOIN accurate_salesman acs ON acs.id = ai.salesman_id
      ${joinAmFromSalesman(sql)}
      WHERE ai.tanggal BETWEEN ${cur.from} AND ${cur.to}
    ),
    baris AS (
      SELECT inv.cabang, aii.item_id, aii.unit, COALESCE(aii.qty, 0) AS qty,
             CASE WHEN sum(GREATEST(aii.total, 0)) OVER (PARTITION BY aii.invoice_id) > 0
                  THEN inv.inv_net * GREATEST(aii.total, 0) / sum(GREATEST(aii.total, 0)) OVER (PARTITION BY aii.invoice_id)
                  ELSE inv.inv_net / count(*) OVER (PARTITION BY aii.invoice_id) END AS net
      FROM accurate_invoice_item aii JOIN inv ON inv.id = aii.invoice_id
    )`;
}

/**
 * Laba kotor per area = revenue netto − HPP, hanya atas item yang HPP-nya TIDAK ambigu
 * (n_hpp = 1) DAN lolos pagar kewajaran (hppWajar) — pola sama dengan marginPerKunci
 * (product-scorecard.ts). HPP ke-5100 di Accurate sengaja tak dipakai (Direktur: HPP dari
 * tabel HPP wrg-os). Angka ini parsial, `hppCakupanPct` memberi tahu seberapa.
 */
async function hppPerArea(cur: { from: string; to: string }): Promise<Map<string, { revHpp: number; gp: number }>> {
  const sql = db();
  const rows = await sql`
    WITH ${barisHppCte(sql, cur)}
    SELECT b.cabang,
           COALESCE(sum(b.net) FILTER (WHERE h.n_hpp = 1 AND ${wajarSql(sql)}), 0)::float8 AS rev_hpp,
           COALESCE(sum(b.net - h.hpp * b.qty) FILTER (WHERE h.n_hpp = 1 AND ${wajarSql(sql)}), 0)::float8 AS gp
    FROM baris b LEFT JOIN hpp_item h ON h.item_id = b.item_id
    GROUP BY b.cabang`;
  return new Map(rows.map((r) => [String(r.cabang), { revHpp: Number(r.rev_hpp), gp: Number(r.gp) }]));
}

export interface HppMencurigakan {
  item_no: string | null;
  item_name: string;
  /** product_kode di Setup Harga. */
  kode: string | null;
  hpp: number;
  qty: number;
  /** Satuan di faktur (bisa lebih dari satu, dipisah "/"). */
  unit: string | null;
  net: number;
  /** net / qty; null bila qty 0. */
  harga_per_qty: number | null;
  /** HPP × qty / net; null bila net ≤ 0. */
  rasio: number | null;
}

/**
 * Item yang barisnya dikeluarkan pagar kewajaran pada periode berjalan (semua area), per item,
 * lebihan HPP × qty − net terbesar dulu. Hanya untuk akses penuh (nama item + HPP).
 */
export async function hppMencurigakan(cur: { from: string; to: string }, limit = 20): Promise<HppMencurigakan[]> {
  const sql = db();
  const rows = await sql`
    WITH ${barisHppCte(sql, cur)}
    SELECT it.no AS item_no, COALESCE(NULLIF(it.name, ''), 'Item #' || b.item_id::text) AS item_name, h.kode,
           h.hpp::float8 AS hpp, sum(b.qty)::float8 AS qty, string_agg(DISTINCT b.unit, '/') AS unit,
           sum(b.net)::float8 AS net, sum(h.hpp * b.qty - b.net)::float8 AS lebih
    FROM baris b
    JOIN hpp_item h ON h.item_id = b.item_id AND h.n_hpp = 1
    LEFT JOIN accurate_item it ON it.id = b.item_id
    WHERE NOT ${wajarSql(sql)}
    GROUP BY b.item_id, it.no, it.name, h.kode, h.hpp
    HAVING sum(h.hpp * b.qty - b.net) > 0
    ORDER BY lebih DESC
    LIMIT ${limit}`;
  return rows.map((r) => susunHppMencurigakan(r));
}

/** Murni: baris agregat → HppMencurigakan (rasio & harga per qty). */
export function susunHppMencurigakan(r: Record<string, unknown>): HppMencurigakan {
  const hpp = Number(r.hpp ?? 0);
  const qty = Number(r.qty ?? 0);
  const net = Number(r.net ?? 0);
  return {
    item_no: r.item_no == null ? null : String(r.item_no),
    item_name: String(r.item_name ?? ""),
    kode: r.kode == null ? null : String(r.kode),
    hpp,
    qty,
    unit: r.unit == null || r.unit === "" ? null : String(r.unit),
    net: Math.round(net),
    harga_per_qty: qty !== 0 ? Math.round((net / qty) * 100) / 100 : null,
    rasio: net > 0 ? Math.round(((hpp * qty) / net) * 10) / 10 : null,
  };
}
