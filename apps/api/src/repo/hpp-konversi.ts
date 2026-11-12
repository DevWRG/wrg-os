// Konversi satuan HPP (migrasi 309) — Setup Harga › "Konversi satuan HPP".
//
// HPP Setup Harga per KEMASAN price book; qty faktur Accurate per satuan item Accurate.
// Accurate tak membawa rasio satuan (unitRatio faktur selalu 1, unit2 item kosong), jadi
// konversinya diisi manusia di sini. Pemakaiannya (F150 laba kotor area, F67 Margin Reward,
// F6 Product Scorecard) lewat fungsi SQL hpp_item_satuan — repo ini hanya daftar + tulis.
//
// Gate di BFF (apps/web /api/hpp-konversi): Finance + HoD Business/Purchasing + admin.
// Endpoint memuat HPP — jangan dipanggil dari halaman AM.

import { db } from "../db.js";
import { barisHppCte, RASIO_HPP_MAKS, wajarSql } from "./biaya-area.js";
import { periodeHppDefault } from "./insentif.js";

/** Murni: HPP per satuan Accurate. Override menang; isi membagi HPP kemasan; tanpa keduanya = HPP kemasan. */
export function hppPerSatuan(hppKemasan: number | null, isi: number | null, override: number | null): number | null {
  if (override != null) return override;
  if (hppKemasan == null) return null;
  return isi != null && isi > 0 ? hppKemasan / isi : hppKemasan;
}

/** Murni: GP% = (net − hpp × qty) / net; null bila net ≤ 0 atau HPP tak ada. */
export function gpPct(net: number, qty: number, hpp: number | null): number | null {
  if (hpp == null || !(net > 0)) return null;
  return Math.round(((net - hpp * qty) / net) * 1000) / 10;
}

export interface KonversiInput {
  itemId: number;
  isi: number | null;
  hppSatuan: number | null;
  catatan: string | null;
}

const angkaOpsional = (v: unknown): number | null | "salah" => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : "salah";
};

/** Murni: validasi body simpan. Minimal satu dari isi / hpp_per_satuan; isi > 0; hpp ≥ 0. */
export function validasiKonversi(b: Record<string, unknown>): { ok: true; v: KonversiInput } | { ok: false; error: string } {
  const itemId = Number(b.item_id);
  if (!Number.isSafeInteger(itemId) || itemId <= 0) return { ok: false, error: "item_id tidak valid" };
  const isi = angkaOpsional(b.isi_per_kemasan);
  const hppSatuan = angkaOpsional(b.hpp_per_satuan);
  if (isi === "salah" || hppSatuan === "salah") return { ok: false, error: "angka tidak valid" };
  if (isi == null && hppSatuan == null) return { ok: false, error: "isi per kemasan atau HPP per satuan wajib diisi" };
  if (isi != null && !(isi > 0)) return { ok: false, error: "isi per kemasan harus > 0" };
  if (hppSatuan != null && hppSatuan < 0) return { ok: false, error: "HPP per satuan tidak boleh negatif" };
  const catatan = typeof b.catatan === "string" && b.catatan.trim() ? b.catatan.trim().slice(0, 500) : null;
  return { ok: true, v: { itemId, isi, hppSatuan, catatan } };
}

export interface KonversiRow {
  item_id: number;
  item_no: string | null;
  item_name: string;
  /** Satuan item di Accurate (raw.unit1.name). */
  unit_accurate: string | null;
  /** Satuan yang muncul di faktur jendela ini (dipisah "/"). */
  unit_faktur: string | null;
  kode: string | null;
  /** Kemasan/satuan di Setup Harga (kemasan HPP). */
  kemasan: string | null;
  satuan: string | null;
  hpp_kemasan: number | null;
  /** HPP per satuan Accurate yang SEKARANG dipakai (sesudah konversi). */
  hpp: number | null;
  n_hpp: number | null;
  sumber: "kemasan" | "konversi" | "override" | null;
  qty: number;
  net: number;
  /** HPP × qty / net dengan HPP sekarang; null bila net ≤ 0 / tanpa HPP. */
  rasio: number | null;
  baris_curiga: number;
  isi_per_kemasan: number | null;
  hpp_per_satuan: number | null;
  catatan: string | null;
  diubah_oleh: string | null;
  diubah_at: string | null;
}

const angka = (v: unknown): number | null => (v == null ? null : Number(v));

/** Murni: baris DB → KonversiRow. */
export function susunKonversiRow(r: Record<string, unknown>): KonversiRow {
  const qty = Number(r.qty ?? 0);
  const net = Number(r.net ?? 0);
  const hpp = angka(r.hpp);
  const sumber = r.sumber == null ? null : (String(r.sumber) as KonversiRow["sumber"]);
  return {
    item_id: Number(r.item_id),
    item_no: r.item_no == null ? null : String(r.item_no),
    item_name: String(r.item_name ?? ""),
    unit_accurate: r.unit_accurate ? String(r.unit_accurate) : null,
    unit_faktur: r.unit_faktur ? String(r.unit_faktur) : null,
    kode: r.kode == null ? null : String(r.kode),
    kemasan: r.kemasan ? String(r.kemasan) : null,
    satuan: r.satuan ? String(r.satuan) : null,
    hpp_kemasan: angka(r.hpp_kemasan),
    hpp,
    n_hpp: angka(r.n_hpp),
    sumber,
    qty,
    net: Math.round(net),
    rasio: hpp != null && net > 0 ? Math.round(((hpp * qty) / net) * 10) / 10 : null,
    baris_curiga: Number(r.baris_curiga ?? 0),
    isi_per_kemasan: angka(r.isi_per_kemasan),
    hpp_per_satuan: angka(r.hpp_per_satuan),
    catatan: r.catatan == null ? null : String(r.catatan),
    diubah_oleh: r.diubah_oleh == null ? null : String(r.diubah_oleh),
    diubah_at: r.diubah_at ? new Date(String(r.diubah_at)).toISOString() : null,
  };
}

const tglIso = (d: Date): string => d.toISOString().slice(0, 10);

/**
 * Daftar untuk layar Konversi satuan HPP:
 *  - curiga      : item HPP tak ambigu yang punya baris faktur gagal pagar kewajaran F150
 *                  (HPP × qty > RASIO_HPP_MAKS × net, atau net ≤ 0) pada `hari` terakhir,
 *                  lebihan HPP × qty − net terbesar dulu — HPP sekarang (sesudah konversi).
 *  - terkonversi : semua item yang sudah punya baris di hpp_konversi_satuan.
 * qty/net = seluruh baris faktur item itu di jendela (untuk pratinjau GP%).
 */
export async function daftarKonversi(opts: { hari?: number; limit?: number } = {}) {
  const sql = db();
  const hari = Math.min(Math.max(Math.trunc(opts.hari ?? 180), 7), 730);
  const limit = Math.min(Math.max(Math.trunc(opts.limit ?? 50), 1), 200);
  const to = new Date();
  const from = new Date(to.getTime() - hari * 86_400_000);
  const cur = { from: tglIso(from), to: tglIso(to) };
  const periodeHpp = periodeHppDefault();
  const rows = await sql`
    WITH ${barisHppCte(sql, cur)},
    agg AS (
      SELECT b.item_id, sum(b.qty)::float8 AS qty, sum(b.net)::float8 AS net,
             string_agg(DISTINCT b.unit, '/') AS unit_faktur,
             count(*) FILTER (WHERE h.n_hpp = 1 AND NOT ${wajarSql(sql)})::int AS baris_curiga,
             sum(h.hpp * b.qty - b.net) FILTER (WHERE h.n_hpp = 1 AND NOT ${wajarSql(sql)}) AS lebih
      FROM baris b LEFT JOIN hpp_item h ON h.item_id = b.item_id
      WHERE b.item_id IS NOT NULL
      GROUP BY b.item_id
    ),
    pilih AS (
      (SELECT item_id FROM agg WHERE baris_curiga > 0 AND lebih > 0 ORDER BY lebih DESC LIMIT ${limit})
      UNION
      SELECT accurate_item_id FROM hpp_konversi_satuan
    )
    SELECT p.item_id, it.no AS item_no, COALESCE(NULLIF(it.name, ''), 'Item #' || p.item_id::text) AS item_name,
           it.raw->'unit1'->>'name' AS unit_accurate, a.unit_faktur,
           h.kode, ps.kemasan, ps.satuan, h.hpp_kemasan::float8 AS hpp_kemasan, h.hpp::float8 AS hpp,
           h.n_hpp, h.sumber, COALESCE(a.qty, 0) AS qty, COALESCE(a.net, 0) AS net,
           COALESCE(a.baris_curiga, 0) AS baris_curiga, COALESCE(a.lebih, 0)::float8 AS lebih,
           k.isi_per_kemasan::float8 AS isi_per_kemasan, k.hpp_per_satuan::float8 AS hpp_per_satuan,
           k.catatan, k.diubah_oleh, k.diubah_at
    FROM pilih p
    LEFT JOIN agg a ON a.item_id = p.item_id
    LEFT JOIN hpp_item h ON h.item_id = p.item_id
    LEFT JOIN hpp_konversi_satuan k ON k.accurate_item_id = p.item_id
    LEFT JOIN accurate_item it ON it.id = p.item_id
    LEFT JOIN LATERAL (
      SELECT min(pps.kemasan) AS kemasan, min(pps.satuan) AS satuan
      FROM product_pricelist_setup pps
      WHERE h.kode IS NOT NULL AND pps.product_kode = h.kode AND pps.periode = ${periodeHpp}
    ) ps ON true
    ORDER BY (k.accurate_item_id IS NULL), COALESCE(a.lebih, 0) DESC, p.item_id`;
  const semua = rows.map((r) => susunKonversiRow(r));
  return {
    periode_hpp: periodeHpp,
    jendela: { ...cur, hari },
    rasio_maks: RASIO_HPP_MAKS,
    curiga: semua.filter((r) => r.baris_curiga > 0),
    terkonversi: semua.filter((r) => r.isi_per_kemasan != null || r.hpp_per_satuan != null),
  };
}

/** Simpan (upsert) konversi satu item. `oleh` dari sesi (BFF), bukan dari body browser. */
export async function simpanKonversi(v: KonversiInput, oleh: string | null): Promise<{ ok: true } | { ok: false; error: string }> {
  const sql = db();
  const ada = await sql`SELECT 1 FROM accurate_item WHERE id = ${v.itemId}`;
  if (ada.length === 0) return { ok: false, error: "item Accurate tidak ditemukan" };
  await sql`
    INSERT INTO hpp_konversi_satuan (accurate_item_id, isi_per_kemasan, hpp_per_satuan, catatan, diubah_oleh, diubah_at)
    VALUES (${v.itemId}, ${v.isi}, ${v.hppSatuan}, ${v.catatan}, ${oleh}, now())
    ON CONFLICT (accurate_item_id) DO UPDATE SET
      isi_per_kemasan = EXCLUDED.isi_per_kemasan, hpp_per_satuan = EXCLUDED.hpp_per_satuan,
      catatan = EXCLUDED.catatan, diubah_oleh = EXCLUDED.diubah_oleh, diubah_at = now()`;
  return { ok: true };
}

/** Hapus konversi → item kembali memakai HPP kemasan (dan pagar F150). */
export async function hapusKonversi(itemId: number): Promise<boolean> {
  const sql = db();
  const r = await sql`DELETE FROM hpp_konversi_satuan WHERE accurate_item_id = ${itemId} RETURNING 1`;
  return r.length > 0;
}
