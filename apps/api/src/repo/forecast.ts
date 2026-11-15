// F19 — Forecast Submission Engine (SALES forecast; QC diabaikan dulu per
// arahan Direktur). Sistem scan gudang (F37 item_stock_branch, F38
// item_stock_batch) → usulan otomatis (draft) → Supply Chain edit/sortir →
// "ajukan" masuk approval berjenjang F11 (repo/approval.ts). Sejak migrasi
// 317 usulan dikumpulkan per DOKUMEN cabang × kategori × bulan, dan
// Purchasing melihat rekap semua cabang.
//
// TIDAK ADA hashtag WA di sini — beda dari blueprint lama, alur hasil
// meeting 100% sistem→Supply Chain→approval (lihat komentar migrasi 107).

import ExcelJS from "exceljs";

import { db, isDbEnabled } from "../db.js";
import { cabangEffSql, joinAmFromSalesman } from "./salesman-am.js";
import { createApprovalRequest, isKategori, isWilayah, KATEGORI, WILAYAH, type NotifyResult } from "./approval.js";

// Ambang ED "dekat kedaluwarsa" — dipakai sbg SATU pemicu sederhana (bukan
// 3-tier 90/60/30/0 spt F38 ed-watch, itu utk ALERT berulang; di sini cukup
// "apakah perlu diusulkan sama sekali", jadi 1 ambang saja).
const ED_NEAR_DAYS = 90;

// PO yang sudah "mati" → usulan boleh ditautkan ulang: dibatalkan / approval
// F35 ditolak (PO manual lama) atau Ditutup di Accurate sebelum diterima penuh.
const PO_MATI_SQL = `(po.cancelled_at IS NOT NULL
  OR EXISTS (SELECT 1 FROM purchase_order_approval pa WHERE pa.purchase_order_id = po.id AND pa.status = 'rejected')
  OR (po.source = 'accurate' AND po.accurate_status = 'Ditutup' AND COALESCE(po.percent_shipped, 0) < 100))`;

// PO tautan usulan sudah diterima penuh — pola sama poStatusExpr di
// purchase-order.ts: baris Accurate dari header percent_shipped, PO manual
// lama dari jumlah penerimaan per baris barang vs qty_ordered.
const PO_DITERIMA_SQL = `(po.id IS NOT NULL AND CASE
  WHEN po.source = 'accurate' THEN COALESCE(po.percent_shipped, 0) >= 100
  ELSE EXISTS (SELECT 1 FROM purchase_order_item i WHERE i.purchase_order_id = po.id)
    AND NOT EXISTS (
      SELECT 1 FROM purchase_order_item i
      WHERE i.purchase_order_id = po.id
        AND COALESCE((SELECT SUM(r.qty_received) FROM purchase_order_receipt r WHERE r.po_item_id = i.id), 0) < i.qty_ordered)
  END)`;

// Usulan lama yang masih "berjalan" untuk item+gudang yang sama → generate
// tidak membuat usulan baru. 'ordered' hanya menahan selama PO-nya masih
// hidup dan barang belum diterima penuh; PO mati / sudah diterima = kebutuhan
// boleh diusulkan lagi. 'dismissed' tak pernah menahan.
export function usulanMasihBerjalan(e: { status: string; poDiterima: boolean; poMati: boolean }): boolean {
  if (e.status === "draft" || e.status === "submitted") return true;
  if (e.status === "ordered") return !e.poDiterima && !e.poMati;
  return false;
}

// postgres.js parse kolom DATE jadi objek Date — dipakai TELANJANG (String()/
// interpolasi template literal) hasilnya verbose ("Tue Nov 10 2026 07:00:00
// GMT+0700 ..."), bukan tanggal terbaca. Dikonfirmasi bocor ke deskripsi
// approval F11 (ikut terkirim sbg pesan WA ke HoD) via curl 09-04.
const toIsoDate = (x: unknown): string => new Date(x as string | Date).toISOString().slice(0, 10);
const toIsoTs = (x: unknown): string => new Date(x as string | Date).toISOString();

// ── Rentang rata-rata penjualan (migrasi 318) ─────────────────────────────
// Keputusan user 15 Nov 2026: rata-rata terjual/bulan dihitung dari rentang
// tanggal pilihan pemakai (3/6/12 bulan terakhir atau bebas), bukan tetap
// 6 bulan. Rata-rata = total qty dalam rentang ÷ jumlah bulan rentang —
// bulan tanpa penjualan ikut dihitung (dulu AVG hanya atas bulan yang ada
// penjualannya, jadi barang yang jarang laku terlihat lebih laris).

export interface Rentang {
  dari: string;
  sampai: string;
}

const RENTANG_MAKS_BULAN = 36;
const ISO_TGL = /^\d{4}-\d{2}-\d{2}$/;
const tglUtc = (iso: string) => new Date(`${iso}T00:00:00Z`);
const isoUtc = (d: Date) => d.toISOString().slice(0, 10);

/** Jumlah bulan rentang: bulan kalender utuh (tgl 1 s/d akhir bulan) dihitung bulat, selain itu hari ÷ 30,4375. */
export function jumlahBulan(r: Rentang): number {
  const a = tglUtc(r.dari);
  const b = tglUtc(r.sampai);
  const besokB = new Date(b.getTime() + 86_400_000);
  if (a.getUTCDate() === 1 && besokB.getUTCDate() === 1) {
    return (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth()) + 1;
  }
  return ((b.getTime() - a.getTime()) / 86_400_000 + 1) / 30.4375;
}

/** Bawaan: N bulan kalender utuh sebelum bulan berjalan (hari ini = YYYY-MM-DD). */
export function rentangBulanTerakhir(hariIni: string, n = 6): Rentang {
  const t = tglUtc(hariIni);
  const awal = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() - n, 1));
  const akhir = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), 0));
  return { dari: isoUtc(awal), sampai: isoUtc(akhir) };
}

/** Validasi rentang masukan; kosong → bawaan 6 bulan terakhir. */
export function validasiRentang(input: { dari?: unknown; sampai?: unknown } | undefined, hariIni: string): Rentang | { error: string } {
  const dari = String(input?.dari ?? "").trim();
  const sampai = String(input?.sampai ?? "").trim();
  if (!dari && !sampai) return rentangBulanTerakhir(hariIni);
  if (!ISO_TGL.test(dari) || !ISO_TGL.test(sampai) || Number.isNaN(tglUtc(dari).getTime()) || Number.isNaN(tglUtc(sampai).getTime())) {
    return { error: "rentang rata-rata harus berisi tanggal Dari & Sampai (YYYY-MM-DD)" };
  }
  if (dari > sampai) return { error: "tanggal Dari harus sebelum Sampai" };
  if (sampai > hariIni) return { error: "tanggal Sampai tidak boleh melewati hari ini" };
  if (jumlahBulan({ dari, sampai }) > RENTANG_MAKS_BULAN) return { error: `rentang maksimal ${RENTANG_MAKS_BULAN} bulan` };
  return { dari, sampai };
}

/** Stok minimum: persen × rata-rata/bulan bila buffer persen, selain itu angka tetap lama. */
export function bufferEfektif(b: { bufferPersen: number | null; bufferQty: number | null }, avgBulanan: number): number | null {
  if (b.bufferPersen != null) return Math.round(((b.bufferPersen / 100) * avgBulanan) * 100) / 100;
  return b.bufferQty;
}

/** Usulan awal: tutup kekurangan ke buffer + estimasi 1 bulan pemakaian. */
export function hitungUsulan(currentQty: number, bufferQty: number | null, avgBulanan: number): number {
  const gap = bufferQty != null ? Math.max(0, bufferQty - currentQty) : 0;
  return Math.round(gap + avgBulanan);
}

async function hariIniJakarta(sql: ReturnType<typeof db>): Promise<string> {
  const [r] = await sql`SELECT (now() AT TIME ZONE 'Asia/Jakarta')::date::text AS d`;
  return String(r.d);
}

// ── Cabang penjualan → gudang (migrasi 319) ──────────────────────────────
// Keputusan user 15 Nov 2026: rata-rata penjualan dihitung PER GUDANG CABANG.
// Faktur hampir semua keluar dari satu gudang, jadi cabang faktur = cabang AM
// pada tanggal faktur (cadangan: area lokasi customer) — definisi yang sama
// dengan revenue Per Cabang (salesman-am.ts). Nama cabang itu dipetakan ke
// gudang: peta manual dulu, lalu nama yang persis sama dengan kode / cabang /
// nama gudang. Tanpa peta → penjualannya tak dihitung ke gudang mana pun.

export interface GudangRef {
  kode: string;
  cabang: string | null;
  nama: string;
}

const normal = (x: string | null | undefined) => String(x ?? "").trim().toUpperCase();

/** Gudang untuk satu nama cabang penjualan; null = belum terpetakan. */
export function gudangUntukCabang(cabang: string | null, manual: Map<string, string>, gudang: GudangRef[]): string | null {
  const c = normal(cabang);
  if (!c) return null;
  const m = manual.get(c);
  if (m) return m;
  const cocok = gudang.find((g) => normal(g.kode) === c || normal(g.cabang) === c || normal(g.nama.replace(/^gudang\s+/i, "")) === c);
  return cocok?.kode ?? null;
}

async function muatPeta(sql: Sql): Promise<{ manual: Map<string, string>; gudang: GudangRef[] }> {
  const [manual, gudang] = await Promise.all([
    sql`SELECT cabang, warehouse_kode FROM forecast_cabang_gudang`,
    sql`SELECT kode, cabang, nama FROM warehouse WHERE jenis = 'cabang'`,
  ]);
  return {
    manual: new Map(manual.map((r) => [normal(String(r.cabang)), String(r.warehouse_kode)])),
    gudang: gudang.map((r) => ({ kode: String(r.kode), cabang: r.cabang ? String(r.cabang) : null, nama: String(r.nama) })),
  };
}

// Jenis penjualan dasar rata-rata (migrasi 321, keputusan user 16 Nov 2026):
// KSO = baris faktur berjenis pengadaan KSO; Regular = semua selain KSO
// (REGULAR, RUTIN, e-katalog, PL, tanpa kategori); semua = keduanya.
export const JENIS_PENJUALAN = ["semua", "kso", "regular"] as const;
export type JenisPenjualan = (typeof JENIS_PENJUALAN)[number];

export function validasiJenis(x: unknown): JenisPenjualan | null {
  const v = String(x ?? "").trim().toLowerCase();
  if (!v) return "semua";
  return (JENIS_PENJUALAN as readonly string[]).includes(v) ? (v as JenisPenjualan) : null;
}

export const LABEL_JENIS: Record<JenisPenjualan, string> = { semua: "KSO & Regular", kso: "KSO", regular: "Regular" };

function syaratJenis(sql: Sql, jenis: JenisPenjualan) {
  if (jenis === "kso") return sql`upper(btrim(COALESCE(ii.kategori_pengadaan, ''))) = 'KSO'`;
  if (jenis === "regular") return sql`upper(btrim(COALESCE(ii.kategori_pengadaan, ''))) <> 'KSO'`;
  return sql`true`;
}

// Penjualan per item × cabang penjualan dalam rentang (itemIds null = semua item).
async function penjualanPerCabang(sql: Sql, itemIds: number[] | null, r: Rentang, jenis: JenisPenjualan = "semua") {
  return sql`
    SELECT ii.item_id, ${cabangEffSql(sql)} AS cabang, count(*)::int AS faktur, COALESCE(SUM(ii.qty), 0) AS qty
    FROM accurate_invoice_item ii
    JOIN accurate_invoice ai ON ai.id = ii.invoice_id
    LEFT JOIN accurate_salesman acs ON acs.id = ai.salesman_id
    ${joinAmFromSalesman(sql)}
    WHERE ${itemIds ? sql`ii.item_id = ANY(${itemIds}::bigint[])` : sql`true`}
      AND ai.tanggal >= ${r.dari}::date AND ai.tanggal <= ${r.sampai}::date
      AND ${syaratJenis(sql, jenis)}
    GROUP BY 1, 2
  `;
}

const kunciAvg = (itemId: number, warehouseKode: string) => `${itemId}:${warehouseKode}`;

// Rata-rata qty terjual/bulan per item × gudang dalam rentang.
async function avgBulanan(
  itemIds: number[],
  r: Rentang,
  jenis: JenisPenjualan = "semua",
): Promise<(itemId: number, warehouseKode: string) => number> {
  const out = new Map<string, number>();
  if (itemIds.length > 0) {
    const sql = db();
    const [rows, peta] = await Promise.all([penjualanPerCabang(sql, itemIds, r, jenis), muatPeta(sql)]);
    const bulan = jumlahBulan(r);
    for (const row of rows) {
      const wh = gudangUntukCabang(row.cabang ? String(row.cabang) : null, peta.manual, peta.gudang);
      if (!wh) continue;
      const k = kunciAvg(Number(row.item_id), wh);
      out.set(k, (out.get(k) ?? 0) + Number(row.qty));
    }
    for (const [k, qty] of out) out.set(k, Math.round((qty / bulan) * 100) / 100);
  }
  return (itemId, warehouseKode) => out.get(kunciAvg(itemId, warehouseKode)) ?? 0;
}

export interface CabangGudangRow {
  cabang: string;
  /** Baris faktur 12 bulan terakhir dari cabang ini. */
  faktur: number;
  warehouseKode: string | null;
  sumber: "manual" | "otomatis" | null;
}

/** Cabang penjualan 12 bulan terakhir + petanya ke gudang (untuk Setup). */
export async function listCabangGudang(): Promise<{ rows: CabangGudangRow[]; persenTanpaGudang: number }> {
  const sql = db();
  const rentang = rentangBulanTerakhir(await hariIniJakarta(sql), 12);
  const [rows, peta] = await Promise.all([penjualanPerCabang(sql, null, rentang), muatPeta(sql)]);
  const per = new Map<string, { faktur: number; qty: number }>();
  for (const r of rows) {
    const c = r.cabang ? String(r.cabang) : "";
    const x = per.get(c) ?? { faktur: 0, qty: 0 };
    x.faktur += Number(r.faktur);
    x.qty += Number(r.qty);
    per.set(c, x);
  }
  let total = 0;
  let tanpa = 0;
  const out: CabangGudangRow[] = [];
  for (const [cabang, x] of per) {
    const wh = gudangUntukCabang(cabang || null, peta.manual, peta.gudang);
    total += x.qty;
    if (!wh) tanpa += x.qty;
    if (!cabang) continue; // faktur tanpa cabang sama sekali — tak bisa dipetakan
    out.push({ cabang, faktur: x.faktur, warehouseKode: wh, sumber: wh ? (peta.manual.has(normal(cabang)) ? "manual" : "otomatis") : null });
  }
  out.sort((a, b) => Number(!!a.warehouseKode) - Number(!!b.warehouseKode) || b.faktur - a.faktur);
  return { rows: out, persenTanpaGudang: total > 0 ? Math.round((tanpa / total) * 1000) / 10 : 0 };
}

export async function setCabangGudang(cabang: string, warehouseKode: unknown, oleh?: string | null): Promise<{ ok: boolean; error?: string }> {
  const c = String(cabang ?? "").trim();
  if (!c) return { ok: false, error: "cabang wajib" };
  const sql = db();
  if (warehouseKode == null || warehouseKode === "") {
    await sql`DELETE FROM forecast_cabang_gudang WHERE upper(cabang) = ${normal(c)}`;
    return { ok: true };
  }
  const [wh] = await sql`SELECT kode FROM warehouse WHERE kode = ${String(warehouseKode)} AND jenis = 'cabang'`;
  if (!wh) return { ok: false, error: `gudang cabang "${String(warehouseKode)}" tidak ditemukan` };
  await sql`DELETE FROM forecast_cabang_gudang WHERE upper(cabang) = ${normal(c)} AND cabang <> ${c}`;
  await sql`
    INSERT INTO forecast_cabang_gudang (cabang, warehouse_kode, updated_by)
    VALUES (${c}, ${String(wh.kode)}, ${oleh ?? null})
    ON CONFLICT (cabang) DO UPDATE SET warehouse_kode = EXCLUDED.warehouse_kode, updated_by = EXCLUDED.updated_by, updated_at = now()
  `;
  return { ok: true };
}

export interface BufferConfigRow {
  itemId: number;
  itemName: string;
  warehouseKode: string;
  warehouseNama: string;
  /** Persen dari rata-rata penjualan/bulan; null = baris lama berangka tetap. */
  bufferPersen: number | null;
  /** Angka tetap lama (sebelum 318). */
  bufferQty: number | null;
  /** Perkiraan stok minimum dengan rata-rata 6 bulan terakhir gudang ini (hanya tampilan). */
  bufferPerkiraan: number | null;
  avg6Bulan: number;
  currentQty: number;
  updatedBy: string | null;
  updatedAt: string;
}

export async function listBufferConfig(): Promise<BufferConfigRow[]> {
  const sql = db();
  const rows = await sql`
    SELECT b.item_id, ai.name AS item_name, b.warehouse_kode, w.nama AS warehouse_nama,
           b.buffer_qty, b.buffer_persen, COALESCE(isb.quantity, 0) AS current_qty, b.updated_by, b.updated_at::text
    FROM item_stock_buffer b
    JOIN accurate_item ai ON ai.id = b.item_id
    JOIN warehouse w ON w.kode = b.warehouse_kode
    LEFT JOIN item_stock_branch isb ON isb.item_id = b.item_id AND isb.warehouse_kode = b.warehouse_kode
    ORDER BY ai.name, w.urutan
  `;
  const avg = await avgBulanan([...new Set(rows.map((r) => Number(r.item_id)))], rentangBulanTerakhir(await hariIniJakarta(sql)));
  return rows.map((r) => {
    const b = { bufferPersen: r.buffer_persen != null ? Number(r.buffer_persen) : null, bufferQty: r.buffer_qty != null ? Number(r.buffer_qty) : null };
    const a = avg(Number(r.item_id), String(r.warehouse_kode));
    return {
      itemId: Number(r.item_id),
      itemName: String(r.item_name),
      warehouseKode: String(r.warehouse_kode),
      warehouseNama: String(r.warehouse_nama),
      ...b,
      bufferPerkiraan: bufferEfektif(b, a),
      avg6Bulan: a,
      currentQty: Number(r.current_qty),
      updatedBy: r.updated_by ? String(r.updated_by) : null,
      updatedAt: String(r.updated_at),
    };
  });
}

export interface UpsertBufferInput {
  itemId: number;
  warehouseKode: string;
  bufferPersen: number;
  updatedBy?: string | null;
}

export async function upsertBufferConfig(input: UpsertBufferInput): Promise<{ ok: boolean; error?: string }> {
  if (!(Number.isFinite(input.bufferPersen) && input.bufferPersen >= 0 && input.bufferPersen <= 1000)) {
    return { ok: false, error: "buffer (%) harus 0–1000" };
  }
  const sql = db();
  const item = await sql`SELECT id, name FROM accurate_item WHERE id = ${input.itemId}`;
  if (item.length === 0) return { ok: false, error: `item #${input.itemId} tidak ditemukan` };
  const wh = await sql`SELECT kode FROM warehouse WHERE kode = ${input.warehouseKode} AND jenis = 'cabang'`;
  if (wh.length === 0) return { ok: false, error: `gudang "${input.warehouseKode}" tidak ditemukan (atau bukan gudang cabang)` };
  // Persen menggantikan angka tetap lama (buffer_qty dikosongkan).
  await sql`
    INSERT INTO item_stock_buffer (item_id, warehouse_kode, buffer_persen, buffer_qty, updated_by)
    VALUES (${input.itemId}, ${input.warehouseKode}, ${input.bufferPersen}, NULL, ${input.updatedBy ?? null})
    ON CONFLICT (item_id, warehouse_kode) DO UPDATE SET
      buffer_persen = EXCLUDED.buffer_persen, buffer_qty = NULL, updated_by = EXCLUDED.updated_by, updated_at = now()
  `;
  return { ok: true };
}

// Item+gudang ber-buffer yang stoknya <= stok minimum. Stok minimum buffer
// persen bergantung rata-rata rentang, jadi dihitung di sini (bukan di SQL).
// Buffer persen dengan rata-rata 0 (tak pernah terjual di rentang itu) =
// stok minimum 0 → tak diusulkan (tak ada yang perlu dipesan).
async function findBufferBreaches(
  avg: (itemId: number, warehouseKode: string) => number,
): Promise<{ itemId: number; warehouseKode: string; currentQty: number; bufferQty: number; bufferPersen: number | null }[]> {
  const sql = db();
  const rows = await sql`
    SELECT b.item_id, b.warehouse_kode, COALESCE(isb.quantity, 0) AS current_qty, b.buffer_qty, b.buffer_persen
    FROM item_stock_buffer b
    LEFT JOIN item_stock_branch isb ON isb.item_id = b.item_id AND isb.warehouse_kode = b.warehouse_kode
  `;
  const out: { itemId: number; warehouseKode: string; currentQty: number; bufferQty: number; bufferPersen: number | null }[] = [];
  for (const r of rows) {
    const bufferPersen = r.buffer_persen != null ? Number(r.buffer_persen) : null;
    const buf = bufferEfektif({ bufferPersen, bufferQty: r.buffer_qty != null ? Number(r.buffer_qty) : null }, avg(Number(r.item_id), String(r.warehouse_kode)));
    if (buf == null || (bufferPersen != null && buf <= 0)) continue;
    const currentQty = Number(r.current_qty);
    if (currentQty <= buf) out.push({ itemId: Number(r.item_id), warehouseKode: String(r.warehouse_kode), currentQty, bufferQty: buf, bufferPersen });
  }
  return out;
}

// Item+gudang dgn batch ber-ED dalam ED_NEAR_DAYS ke depan (ed_date IS NOT
// NULL wajib — batch non-kedaluwarsa tak pernah masuk sini, lihat komentar
// item_stock_batch.ed_date di migrasi F38). Tanpa batas bawah: batch yang
// SUDAH lewat ED ikut terjaring (perlu dirotasi juga) — label UI/approval
// membedakannya dari yang baru mendekati.
async function findEdNear(): Promise<{ itemId: number; warehouseKode: string; nearestEd: string }[]> {
  const sql = db();
  const rows = await sql`
    SELECT item_id, warehouse_kode, min(ed_date)::text AS nearest_ed
    FROM item_stock_batch
    WHERE ed_date IS NOT NULL AND ed_date <= (current_date + ${ED_NEAR_DAYS}::int) AND quantity > 0
    GROUP BY item_id, warehouse_kode
  `;
  return rows.map((r) => ({ itemId: Number(r.item_id), warehouseKode: String(r.warehouse_kode), nearestEd: String(r.nearest_ed) }));
}

// KONTEKS saja (lihat komentar migrasi 107) — jumlah deal HOT aktif,
// GLOBAL, TIDAK dicocokkan ke item manapun (deal.product_ids teks bebas,
// gak ada katalog produk baku — apps/api/src/repo/product.ts).
async function pipelineHotCount(): Promise<number> {
  const sql = db();
  const [{ count }] = await sql`SELECT count(*)::int AS count FROM deal WHERE stage IN ('Closing', 'Closing-Won')`;
  return Number(count);
}

// ── Dokumen cabang (migrasi 317) ───────────────────────────────────────────
// Keputusan user 15 Nov 2026: usulan TIDAK diajukan satu-satu per barang.
// Generate mengumpulkan semua barang satu cabang ke satu dokumen per kategori
// (IVD / Medical — approver tahap 2 ikut kategori) per bulan; satu dokumen =
// satu approval_request. Wilayah tahap 1 ikut pemetaan cabang (warehouse.wilayah).

export const KATEGORI_KODE: Record<string, string> = { IVD: "IVD", Medical: "MED" };

/** Kategori approval dari id kategori Klasifikasi Produk: 01 = IVD, selebihnya (NON IVD/OBAT/Utility) = Medical. */
export function kategoriDariKlasifikasi(kategoriId: string | null | undefined): Kategori | null {
  if (!kategoriId) return null;
  return kategoriId === "01" ? "IVD" : "Medical";
}

/** Kode dokumen: FC-<gudang>-<yyyymm>-<IVD|MED|NA>, ditambah -<n> bila bulan itu sudah ada dokumen serupa. */
export function kodeDokumen(warehouseKode: string, periode: string, kategori: string | null, urut: number): string {
  const base = `FC-${warehouseKode}-${periode.slice(0, 7).replace("-", "")}-${kategori ? (KATEGORI_KODE[kategori] ?? kategori) : "NA"}`;
  return urut > 1 ? `${base}-${urut}` : base;
}

type Kategori = (typeof KATEGORI)[number];
type Sql = ReturnType<typeof db>;

async function kategoriItem(sql: Sql, itemId: number): Promise<Kategori | null> {
  // Pola join sama dengan product-scorecard: tautan langsung, atau kode 2025 = no item Accurate.
  const [r] = await sql`
    SELECT pc.kategori_id
    FROM accurate_item ai
    JOIN product_code pc ON pc.accurate_item_id = ai.id OR (pc.kode_2025 IS NOT NULL AND pc.kode_2025 = ai.no)
    WHERE ai.id = ${itemId}
    ORDER BY (pc.accurate_item_id = ai.id) DESC NULLS LAST
    LIMIT 1
  `;
  return kategoriDariKlasifikasi(r?.kategori_id ? String(r.kategori_id) : null);
}

async function periodeSekarang(sql: Sql): Promise<string> {
  const [r] = await sql`SELECT date_trunc('month', now() AT TIME ZONE 'Asia/Jakarta')::date::text AS p`;
  return String(r.p);
}

// Dokumen draft untuk cabang × kategori × bulan — dibuat bila belum ada.
async function pastikanDokumenDraft(sql: Sql, warehouseKode: string, kategori: Kategori | null, periode: string): Promise<string> {
  const cari = () => sql`
    SELECT id FROM forecast_dokumen
    WHERE warehouse_kode = ${warehouseKode} AND COALESCE(kategori, '-') = ${kategori ?? "-"}
      AND periode = ${periode}::date AND status = 'draft'
  `;
  const [ada] = await cari();
  if (ada) return String(ada.id);
  const [{ n }] = await sql`
    SELECT count(*)::int AS n FROM forecast_dokumen
    WHERE warehouse_kode = ${warehouseKode} AND COALESCE(kategori, '-') = ${kategori ?? "-"} AND periode = ${periode}::date
  `;
  const kode = kodeDokumen(warehouseKode, periode, kategori, Number(n) + 1);
  const [baru] = await sql`
    INSERT INTO forecast_dokumen (kode, warehouse_kode, kategori, periode)
    VALUES (${kode}, ${warehouseKode}, ${kategori}, ${periode}::date)
    ON CONFLICT (warehouse_kode, (COALESCE(kategori, '-')), periode) WHERE status = 'draft' DO NOTHING
    RETURNING id
  `;
  if (baru) return String(baru.id);
  const [lagi] = await cari(); // kalah balapan dengan generate lain — pakai milik dia
  return String(lagi.id);
}

// Dokumen draft yang tak lagi punya baris draft → dihapus bila kosong sama
// sekali, ditutup bila sisanya baris yang diabaikan.
async function rapikanDokumen(sql: Sql, dokumenId: string, oleh?: string | null): Promise<void> {
  const [r] = await sql`
    SELECT count(*) FILTER (WHERE status = 'draft')::int AS draft, count(*)::int AS semua
    FROM forecast_suggestion WHERE dokumen_id = ${dokumenId}
  `;
  if (Number(r.draft) > 0) return;
  if (Number(r.semua) === 0) {
    await sql`DELETE FROM forecast_dokumen WHERE id = ${dokumenId} AND status = 'draft'`;
  } else {
    await sql`UPDATE forecast_dokumen SET status = 'closed', closed_by = ${oleh ?? null}, closed_at = now() WHERE id = ${dokumenId} AND status = 'draft'`;
  }
}

export interface GenerateResult {
  created: number;
  skippedExisting: number;
  /** Jumlah dokumen cabang yang menerima baris baru. */
  dokumen: number;
  /** Rentang rata-rata penjualan yang dipakai. */
  rentang?: Rentang;
  error?: string;
}

// Scan buffer+ED → baris draft baru, dikelompokkan ke dokumen cabang ×
// kategori × bulan berjalan. Skip kalau item+gudang masih punya usulan yang
// berjalan. Dipanggil manual (tombol "Generate Usulan"), bukan cron.
// Rata-rata penjualan dari rentang pilihan pemakai (kosong = 6 bulan terakhir).
export async function generateSuggestions(
  input?: { dari?: unknown; sampai?: unknown; jenis?: unknown; brand?: unknown },
): Promise<GenerateResult> {
  if (!isDbEnabled()) return { created: 0, skippedExisting: 0, dokumen: 0 };
  const sql = db();
  const rentang = validasiRentang(input, await hariIniJakarta(sql));
  if ("error" in rentang) return { created: 0, skippedExisting: 0, dokumen: 0, error: rentang.error };
  const jenis = validasiJenis(input?.jenis);
  if (!jenis) return { created: 0, skippedExisting: 0, dokumen: 0, error: "jenis penjualan harus semua/kso/regular" };
  const brand = String(input?.brand ?? "").trim();
  const periode = await periodeSekarang(sql);
  const dokumenTersentuh = new Set<string>();

  // Usulan draft dari sebelum migrasi 317 belum punya dokumen — adopsi ke
  // dokumen bulan berjalan supaya tetap bisa diajukan.
  const yatim = await sql`SELECT id, item_id, warehouse_kode, kategori FROM forecast_suggestion WHERE status = 'draft' AND dokumen_id IS NULL`;
  for (const y of yatim) {
    const kat = (y.kategori as Kategori | null) ?? (await kategoriItem(sql, Number(y.item_id)));
    const dok = await pastikanDokumenDraft(sql, String(y.warehouse_kode), kat, periode);
    await sql`UPDATE forecast_suggestion SET dokumen_id = ${dok}, kategori = ${kat} WHERE id = ${y.id}`;
    dokumenTersentuh.add(dok);
  }

  const hotCount = await pipelineHotCount();
  const [bufferItems, edNear] = await Promise.all([sql`SELECT DISTINCT item_id FROM item_stock_buffer`, findEdNear()]);
  const avg = await avgBulanan(
    [...new Set([...bufferItems.map((r) => Number(r.item_id)), ...edNear.map((e) => e.itemId)])],
    rentang,
    jenis,
  );
  const breaches = await findBufferBreaches(avg);

  // Gabung per (item,gudang) — 1 baris bisa kena 2 alasan sekaligus.
  const combined = new Map<
    string,
    { itemId: number; warehouseKode: string; currentQty?: number; bufferQty?: number; bufferPersen?: number | null; nearestEd?: string; reasons: string[] }
  >();
  for (const b of breaches) {
    combined.set(`${b.itemId}:${b.warehouseKode}`, {
      itemId: b.itemId, warehouseKode: b.warehouseKode, currentQty: b.currentQty, bufferQty: b.bufferQty,
      bufferPersen: b.bufferPersen, reasons: ["near_buffer"],
    });
  }
  for (const e of edNear) {
    const key = `${e.itemId}:${e.warehouseKode}`;
    const existing = combined.get(key);
    if (existing) {
      existing.nearestEd = e.nearestEd;
      existing.reasons.push("near_ed");
    } else {
      combined.set(key, { itemId: e.itemId, warehouseKode: e.warehouseKode, nearestEd: e.nearestEd, reasons: ["near_ed"] });
    }
  }

  // Filter brand (opsional): hanya barang brand itu yang dibuatkan usulan.
  if (brand) {
    const ids = [...new Set([...combined.values()].map((c) => c.itemId))];
    const cocok = new Set(
      (await sql`SELECT id FROM unnest(${ids}::bigint[]) AS id WHERE upper(item_brand(id)) = upper(${brand})`).map((r) => Number(r.id)),
    );
    for (const [k, c] of combined) if (!cocok.has(c.itemId)) combined.delete(k);
  }

  let created = 0;
  let skippedExisting = 0;
  for (const c of combined.values()) {
    // Usulan yang masih draft, sedang di-approval, atau sudah jadi PO yang
    // barangnya belum datang menahan usulan baru (uji fungsional 12 Nov).
    const existing = await sql`
      SELECT fs.status, ${sql.unsafe(PO_DITERIMA_SQL)} AS po_diterima, ${sql.unsafe(PO_MATI_SQL)} AS po_mati
      FROM forecast_suggestion fs
      LEFT JOIN purchase_order po ON po.id = fs.purchase_order_id
      WHERE fs.item_id = ${c.itemId} AND fs.warehouse_kode = ${c.warehouseKode}
        AND fs.status IN ('draft', 'submitted', 'ordered')
    `;
    const masihBerjalan = existing.some((e) =>
      usulanMasihBerjalan({ status: String(e.status), poDiterima: e.po_diterima === true, poMati: e.po_mati === true }),
    );
    if (masihBerjalan) {
      skippedExisting++;
      continue;
    }
    const currentQty =
      c.currentQty ??
      Number((await sql`SELECT COALESCE(quantity,0) AS q FROM item_stock_branch WHERE item_id=${c.itemId} AND warehouse_kode=${c.warehouseKode}`)[0]?.q ?? 0);
    const avgQty = avg(c.itemId, c.warehouseKode);
    // Heuristik AWAL (Supply Chain WAJIB review): tutup gap ke buffer + 1
    // bulan estimasi pemakaian; kalau cuma dipicu ED, cukup estimasi 1 bulan.
    const suggestedQty = hitungUsulan(currentQty, c.bufferQty ?? null, avgQty);
    const kategori = await kategoriItem(sql, c.itemId);
    const dokumenId = await pastikanDokumenDraft(sql, c.warehouseKode, kategori, periode);

    await sql`
      INSERT INTO forecast_suggestion
        (item_id, warehouse_kode, reasons, current_qty, buffer_qty, buffer_persen, nearest_ed_date, avg_monthly_qty_6m, avg_dari, avg_sampai,
         avg_jenis, pipeline_hot_count, suggested_qty, dokumen_id, kategori)
      VALUES
        (${c.itemId}, ${c.warehouseKode}, ${sql.json(c.reasons as unknown as Parameters<typeof sql.json>[0])}, ${currentQty},
         ${c.bufferQty ?? null}, ${c.bufferPersen ?? null}, ${c.nearestEd ?? null}, ${avgQty}, ${rentang.dari}::date, ${rentang.sampai}::date,
         ${jenis}, ${hotCount}, ${suggestedQty}, ${dokumenId}, ${kategori})
    `;
    dokumenTersentuh.add(dokumenId);
    created++;
  }
  return { created, skippedExisting, dokumen: dokumenTersentuh.size, rentang };
}

export interface ForecastSuggestionRow {
  id: string;
  dokumenId: string | null;
  itemId: number;
  itemNo: string | null;
  itemName: string;
  kategori: string | null;
  warehouseKode: string;
  warehouseNama: string;
  reasons: string[];
  currentQty: number;
  bufferQty: number | null;
  nearestEdDate: string | null;
  /** Rata-rata qty terjual/bulan dalam rentang avgDari..avgSampai. */
  avgMonthlyQty6m: number | null;
  avgDari: string | null;
  avgSampai: string | null;
  /** Jenis penjualan dasar rata-rata (semua/kso/regular); null = baris lama (semua). */
  avgJenis: string | null;
  brand: string | null;
  bufferPersen: number | null;
  pipelineHotCount: number;
  suggestedQty: number;
  finalQty: number | null;
  notes: string | null;
  status: string;
  approvalRequestId: string | null;
  approvalStatus: string | null;
  purchaseOrderId: string | null;
  purchaseOrderNumber: string | null;
  /** PO tautan dibatalkan / ditutup sebelum diterima → boleh ditautkan ulang. */
  purchaseOrderMati: boolean;
  createdAt: string;
}

/** Qty yang diajukan: qty final Supply Chain, atau usulan sistem bila belum diisi. */
export function qtyEfektif(r: { finalQty: number | null; suggestedQty: number }): number {
  return r.finalQty ?? r.suggestedQty;
}

function mapSuggestion(r: Record<string, unknown>): ForecastSuggestionRow {
  return {
    id: String(r.id),
    dokumenId: r.dokumen_id ? String(r.dokumen_id) : null,
    itemId: Number(r.item_id),
    itemNo: r.item_no ? String(r.item_no) : null,
    itemName: String(r.item_name),
    kategori: r.kategori ? String(r.kategori) : null,
    warehouseKode: String(r.warehouse_kode),
    warehouseNama: String(r.warehouse_nama),
    reasons: Array.isArray(r.reasons) ? (r.reasons as string[]) : [],
    currentQty: Number(r.current_qty),
    bufferQty: r.buffer_qty != null ? Number(r.buffer_qty) : null,
    nearestEdDate: r.nearest_ed_date ? toIsoDate(r.nearest_ed_date) : null,
    avgMonthlyQty6m: r.avg_monthly_qty_6m != null ? Number(r.avg_monthly_qty_6m) : null,
    avgDari: r.avg_dari ? toIsoDate(r.avg_dari) : null,
    avgSampai: r.avg_sampai ? toIsoDate(r.avg_sampai) : null,
    avgJenis: r.avg_jenis ? String(r.avg_jenis) : null,
    brand: r.brand ? String(r.brand) : null,
    bufferPersen: r.buffer_persen != null ? Number(r.buffer_persen) : null,
    pipelineHotCount: Number(r.pipeline_hot_count),
    suggestedQty: Number(r.suggested_qty),
    finalQty: r.final_qty != null ? Number(r.final_qty) : null,
    notes: r.notes ? String(r.notes) : null,
    status: String(r.status),
    approvalRequestId: r.approval_request_id ? String(r.approval_request_id) : null,
    approvalStatus: r.approval_status ? String(r.approval_status) : null,
    purchaseOrderId: r.purchase_order_id ? String(r.purchase_order_id) : null,
    purchaseOrderNumber: r.po_number ? String(r.po_number) : null,
    purchaseOrderMati: r.po_mati === true,
    // timestamptz → objek Date; String() di atasnya bukan ISO (QA 2026-09-07).
    createdAt: toIsoTs(r.created_at),
  };
}

const SUGGESTION_SELECT = `
  fs.*, item_brand(fs.item_id) AS brand, ai.no AS item_no, ai.name AS item_name, w.nama AS warehouse_nama, ar.status AS approval_status,
  po.po_number AS po_number, ${PO_MATI_SQL} AS po_mati`;
const SUGGESTION_FROM = `
  FROM forecast_suggestion fs
  JOIN accurate_item ai ON ai.id = fs.item_id
  JOIN warehouse w ON w.kode = fs.warehouse_kode
  LEFT JOIN approval_request ar ON ar.id = fs.approval_request_id
  LEFT JOIN purchase_order po ON po.id = fs.purchase_order_id`;

export async function listSuggestions(status?: string): Promise<ForecastSuggestionRow[]> {
  const sql = db();
  const rows = await sql`
    SELECT ${sql.unsafe(SUGGESTION_SELECT)} ${sql.unsafe(SUGGESTION_FROM)}
    WHERE ${status ? sql`fs.status = ${status}` : sql`true`}
    ORDER BY fs.created_at DESC LIMIT 200
  `;
  return rows.map(mapSuggestion);
}

export interface ForecastDokumenRow {
  id: string;
  kode: string;
  warehouseKode: string;
  warehouseNama: string;
  wilayah: string | null;
  kategori: string | null;
  periode: string;
  status: string;
  approvalRequestId: string | null;
  approvalKode: string | null;
  approvalStatus: string | null;
  submittedBy: string | null;
  submittedAt: string | null;
  createdAt: string;
  /** Baris selain yang diabaikan. */
  jumlahBarang: number;
  totalQty: number;
  lines: ForecastSuggestionRow[];
  tersaring: boolean;
}

/** "2026-11" → "2026-11-01"; null kalau formatnya salah. */
export function periodeDariBulan(bulan: string | null | undefined): string | null {
  const m = /^(\d{4})-(\d{2})$/.exec(String(bulan ?? "").trim());
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) return null;
  return `${m[1]}-${m[2]}-01`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function listDokumen(
  filter: { status?: string; bulan?: string; id?: string; brand?: string } = {},
): Promise<ForecastDokumenRow[]> {
  const brand = String(filter.brand ?? "").trim().toUpperCase();
  const sql = db();
  const periode = periodeDariBulan(filter.bulan);
  if (filter.id && !UUID.test(filter.id)) return [];
  const docs = await sql`
    SELECT d.*, w.nama AS warehouse_nama, w.urutan, ar.kode AS approval_kode, ar.status AS approval_status
    FROM forecast_dokumen d
    JOIN warehouse w ON w.kode = d.warehouse_kode
    LEFT JOIN approval_request ar ON ar.id = d.approval_request_id
    WHERE ${filter.status ? sql`d.status = ${filter.status}` : sql`true`}
      AND ${filter.id ? sql`d.id = ${filter.id}::uuid` : sql`true`}
      AND ${periode ? sql`d.periode = ${periode}::date` : sql`true`}
    ORDER BY d.periode DESC, w.urutan, w.nama, d.kategori NULLS LAST, d.created_at
    LIMIT 200
  `;
  if (docs.length === 0) return [];
  const wil = await wilayahGudang(sql);
  const ids = docs.map((d) => String(d.id));
  const lines = (
    await sql`
      SELECT ${sql.unsafe(SUGGESTION_SELECT)} ${sql.unsafe(SUGGESTION_FROM)}
      WHERE fs.dokumen_id = ANY(${ids}::uuid[])
      ORDER BY ai.name
    `
  ).map(mapSuggestion);
  const hasil = docs.map((d) => {
    const own = lines.filter((l) => l.dokumenId === String(d.id) && (!brand || (l.brand ?? "").toUpperCase() === brand));
    const aktif = own.filter((l) => l.status !== "dismissed");
    return {
      id: String(d.id),
      kode: String(d.kode),
      warehouseKode: String(d.warehouse_kode),
      warehouseNama: String(d.warehouse_nama),
      wilayah: wil.get(String(d.warehouse_kode))?.wilayah ?? null,
      kategori: d.kategori ? String(d.kategori) : null,
      periode: toIsoDate(d.periode).slice(0, 7),
      status: String(d.status),
      approvalRequestId: d.approval_request_id ? String(d.approval_request_id) : null,
      approvalKode: d.approval_kode ? String(d.approval_kode) : null,
      approvalStatus: d.approval_status ? String(d.approval_status) : null,
      submittedBy: d.submitted_by ? String(d.submitted_by) : null,
      submittedAt: d.submitted_at ? toIsoTs(d.submitted_at) : null,
      createdAt: toIsoTs(d.created_at),
      jumlahBarang: aktif.length,
      totalQty: aktif.reduce((a, l) => a + qtyEfektif(l), 0),
      lines: own,
      /** Baris disaring brand — Ajukan/Hitung ulang berlaku ke SELURUH dokumen, jadi UI menahannya. */
      tersaring: !!brand,
    };
  });
  // Dengan filter brand, dokumen tanpa barang brand itu disembunyikan.
  return brand ? hasil.filter((d) => d.lines.length > 0) : hasil;
}

export async function updateSuggestion(
  id: string,
  patch: { finalQty?: number | null; notes?: string | null; kategori?: string | null },
): Promise<{ ok: boolean; error?: string }> {
  const sql = db();
  if (patch.finalQty != null && (!Number.isFinite(patch.finalQty) || patch.finalQty < 0)) {
    return { ok: false, error: "qty final tidak boleh negatif" };
  }
  if (patch.kategori !== undefined && !isKategori(patch.kategori)) {
    return { ok: false, error: `kategori harus ${KATEGORI.join("/")}` };
  }
  const rows = await sql`
    SELECT fs.status, fs.warehouse_kode, fs.kategori, fs.dokumen_id, d.periode::text AS periode
    FROM forecast_suggestion fs LEFT JOIN forecast_dokumen d ON d.id = fs.dokumen_id
    WHERE fs.id = ${id}
  `;
  if (rows.length === 0) return { ok: false, error: "usulan tidak ditemukan" };
  const r = rows[0];
  if (r.status !== "draft") return { ok: false, error: `usulan sudah ${r.status}, tak bisa diedit` };
  await sql`
    UPDATE forecast_suggestion SET
      final_qty = ${patch.finalQty === undefined ? sql`final_qty` : patch.finalQty},
      notes = ${patch.notes === undefined ? sql`notes` : patch.notes}
    WHERE id = ${id}
  `;
  // Ganti kategori = pindah ke dokumen cabang × kategori itu (bulan yang sama).
  if (patch.kategori !== undefined && patch.kategori !== r.kategori) {
    const periode = r.periode ? String(r.periode) : await periodeSekarang(sql);
    const tujuan = await pastikanDokumenDraft(sql, String(r.warehouse_kode), patch.kategori as Kategori, periode);
    await sql`UPDATE forecast_suggestion SET kategori = ${patch.kategori}, dokumen_id = ${tujuan} WHERE id = ${id}`;
    if (r.dokumen_id && String(r.dokumen_id) !== tujuan) await rapikanDokumen(sql, String(r.dokumen_id));
  }
  return { ok: true };
}

// Abaikan satu barang dari dokumen draft. Dokumen yang jadi tak punya baris
// draft ditutup otomatis. Kekurangan stoknya tetap terbaca: Generate
// berikutnya membuat usulan baru.
export async function dismissSuggestion(id: string, reviewedBy?: string): Promise<{ ok: boolean; error?: string }> {
  const sql = db();
  const [r] = await sql`SELECT status, dokumen_id FROM forecast_suggestion WHERE id = ${id}`;
  if (!r) return { ok: false, error: "usulan tidak ditemukan" };
  if (r.status !== "draft") return { ok: false, error: `usulan sudah ${r.status} — tutup dokumennya bila approval ditolak` };
  const done = await sql`
    UPDATE forecast_suggestion SET status = 'dismissed', reviewed_by = ${reviewedBy ?? null}, reviewed_at = now()
    WHERE id = ${id} AND status = 'draft'
    RETURNING id
  `;
  if (!done.length) return { ok: false, error: "usulan berubah sementara — muat ulang halaman" };
  if (r.dokumen_id) await rapikanDokumen(sql, String(r.dokumen_id), reviewedBy);
  return { ok: true };
}

// Hitung ulang rata-rata penjualan (dan stok minimum buffer persen + usulan
// sistem) seluruh baris draft satu dokumen dengan rentang baru. Qty final
// yang sudah diisi Supply Chain TIDAK disentuh; stok & buffer tetap memakai
// snapshot saat Generate.
export async function hitungUlangDokumen(
  id: string,
  input: { dari?: unknown; sampai?: unknown; jenis?: unknown },
): Promise<{ ok: boolean; error?: string; baris?: number; rentang?: Rentang }> {
  const sql = db();
  const rentang = validasiRentang(input, await hariIniJakarta(sql));
  if ("error" in rentang) return { ok: false, error: rentang.error };
  const jenis = validasiJenis(input?.jenis);
  if (!jenis) return { ok: false, error: "jenis penjualan harus semua/kso/regular" };
  const [d] = await sql`SELECT status FROM forecast_dokumen WHERE id = ${id}`;
  if (!d) return { ok: false, error: "dokumen tidak ditemukan" };
  if (d.status !== "draft") return { ok: false, error: `dokumen sudah ${d.status}, tak bisa dihitung ulang` };
  const lines = await sql`
    SELECT id, item_id, warehouse_kode, current_qty, buffer_qty, buffer_persen FROM forecast_suggestion
    WHERE dokumen_id = ${id} AND status = 'draft'
  `;
  const avg = await avgBulanan([...new Set(lines.map((l) => Number(l.item_id)))], rentang, jenis);
  for (const l of lines) {
    const a = avg(Number(l.item_id), String(l.warehouse_kode));
    const persen = l.buffer_persen != null ? Number(l.buffer_persen) : null;
    const buf = persen != null ? bufferEfektif({ bufferPersen: persen, bufferQty: null }, a) : l.buffer_qty != null ? Number(l.buffer_qty) : null;
    await sql`
      UPDATE forecast_suggestion SET
        avg_monthly_qty_6m = ${a}, avg_dari = ${rentang.dari}::date, avg_sampai = ${rentang.sampai}::date, avg_jenis = ${jenis},
        buffer_qty = ${buf}, suggested_qty = ${hitungUsulan(Number(l.current_qty), buf, a)}
      WHERE id = ${l.id} AND status = 'draft'
    `;
  }
  return { ok: true, baris: lines.length, rentang };
}

// Tutup dokumen: draft yang batal diajukan, atau dokumen yang approval-nya
// ditolak/dibatalkan (dulu barisnya tertahan 'submitted' selamanya).
export async function tutupDokumen(id: string, oleh?: string | null): Promise<{ ok: boolean; error?: string }> {
  const sql = db();
  const [d] = await sql`
    SELECT d.status, ar.status AS approval_status
    FROM forecast_dokumen d LEFT JOIN approval_request ar ON ar.id = d.approval_request_id
    WHERE d.id = ${id}
  `;
  if (!d) return { ok: false, error: "dokumen tidak ditemukan" };
  const apprMati = d.approval_status === "rejected" || d.approval_status === "canceled";
  if (!(d.status === "draft" || (d.status === "submitted" && apprMati))) {
    return { ok: false, error: d.status === "submitted" ? "dokumen masih dalam approval / sudah disetujui" : `dokumen sudah ${d.status}` };
  }
  const [claim] = await sql`
    UPDATE forecast_dokumen SET status = 'closed', closed_by = ${oleh ?? null}, closed_at = now()
    WHERE id = ${id} AND status = ${String(d.status)}
    RETURNING id
  `;
  if (!claim) return { ok: false, error: "dokumen berubah sementara — muat ulang halaman" };
  await sql`
    UPDATE forecast_suggestion SET status = 'dismissed', reviewed_by = ${oleh ?? null}, reviewed_at = now()
    WHERE dokumen_id = ${id} AND status IN ('draft', 'submitted')
  `;
  return { ok: true };
}

export interface SubmitResult {
  ok: boolean;
  error?: string;
  approvalId?: string;
  approvalKode?: string;
  // Hasil notifikasi tahap 1 — UI wajib bilang kalau approver pertama tak
  // menerima apa-apa (dulu diabaikan: layar "sukses", usulan tertahan diam).
  notify?: NotifyResult;
}

const BARIS_DESKRIPSI_MAKS = 30;

const namaBulan = (periode: string): string =>
  new Date(`${periode.slice(0, 7)}-01T00:00:00Z`).toLocaleDateString("id-ID", { month: "long", year: "numeric", timeZone: "UTC" });

/** Deskripsi approval satu dokumen — ringkas, karena ikut terkirim ke WA approver. */
export function deskripsiDokumen(
  d: { kode: string; warehouseNama: string; kategori: string; periode: string; pipelineHot: number; rentangRata?: string | null },
  lines: { itemName: string; qty: number; currentQty: number; bufferQty: number | null; edLewat: boolean; nearEd: boolean; notes: string | null }[],
): string {
  const total = lines.reduce((a, l) => a + l.qty, 0);
  const rincian = lines.slice(0, BARIS_DESKRIPSI_MAKS).map((l, i) => {
    const tanda = l.edLewat ? " · ada batch lewat ED" : l.nearEd ? " · ada batch mendekati ED" : "";
    const buf = l.bufferQty != null ? `, buffer ${l.bufferQty}` : "";
    return `${i + 1}. ${l.itemName} — ${l.qty} (stok ${l.currentQty}${buf}${tanda})${l.notes ? ` — ${l.notes}` : ""}`;
  });
  const sisa = lines.length - BARIS_DESKRIPSI_MAKS;
  return (
    `Dokumen: ${d.kode}\nCabang: ${d.warehouseNama} · Kategori: ${d.kategori} · Periode: ${namaBulan(d.periode)}\n` +
    `Jumlah barang: ${lines.length} · Total qty: ${total}\n` +
    (d.rentangRata ? `Rata-rata penjualan dari: ${d.rentangRata}\n` : "") +
    `\nRincian:\n${rincian.join("\n")}` +
    (sisa > 0 ? `\n(+${sisa} barang lainnya — lihat dokumen di WRG-OS)` : "") +
    `\n\nDeal HOT aktif (konteks, bukan pemicu): ${d.pipelineHot}`
  );
}

const tglId = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/** Label rentang rata-rata satu dokumen; baris dengan rentang berbeda → "beragam". */
export function labelRentang(rentang: (Rentang | null)[]): string | null {
  const unik = [...new Set(rentang.map((r) => (r ? `${r.dari}|${r.sampai}` : "lama")))];
  if (unik.length === 0) return null;
  if (unik.length > 1) return "beragam per barang";
  if (unik[0] === "lama") return "6 bulan terakhir";
  const [dari, sampai] = unik[0].split("|");
  return `${tglId(dari)} – ${tglId(sampai)}`;
}

/** Label jenis penjualan dasar rata-rata satu dokumen; campur → "jenis beragam". */
export function labelJenis(jenis: (string | null)[]): string | null {
  const unik = [...new Set(jenis.map((j) => j ?? "semua"))];
  if (unik.length === 0) return null;
  if (unik.length > 1) return "jenis penjualan beragam";
  return `penjualan ${LABEL_JENIS[unik[0] as JenisPenjualan] ?? unik[0]}`;
}

/** Brand barang yang relevan untuk filter: ber-buffer, punya batch ED, atau pernah diusulkan. */
export async function listBrand(): Promise<string[]> {
  const sql = db();
  const rows = await sql`
    SELECT DISTINCT item_brand(id) AS brand FROM (
      SELECT item_id AS id FROM item_stock_buffer
      UNION SELECT item_id FROM forecast_suggestion
      UNION SELECT item_id FROM item_stock_batch WHERE ed_date IS NOT NULL AND quantity > 0
    ) x
  `;
  return rows.map((r) => (r.brand ? String(r.brand) : "")).filter(Boolean).sort((a, b) => a.localeCompare(b, "id"));
}

// "Ajukan" — satu dokumen cabang ke approval berjenjang F11.
// Wilayah dari pemetaan cabang, kategori dari dokumen; createApprovalRequest
// dipakai apa adanya.
export async function submitDokumen(id: string, submittedBy: string): Promise<SubmitResult> {
  const sql = db();
  const [d] = await sql`
    SELECT d.*, w.nama AS warehouse_nama
    FROM forecast_dokumen d JOIN warehouse w ON w.kode = d.warehouse_kode
    WHERE d.id = ${id}
  `;
  if (!d) return { ok: false, error: "dokumen tidak ditemukan" };
  const wilayah = (await wilayahGudang(sql)).get(String(d.warehouse_kode))?.wilayah ?? null;
  if (d.status !== "draft") return { ok: false, error: `dokumen sudah ${d.status}` };
  if (!isKategori(d.kategori)) {
    return { ok: false, error: "barang di dokumen ini belum punya kategori — pilih IVD/Medical per barang dulu" };
  }
  if (!isWilayah(wilayah)) {
    return { ok: false, error: `wilayah ${d.warehouse_nama} tak bisa diturunkan dari HoD dan belum diisi cadangan manual — atur di Setup` };
  }

  const lines = await sql`
    SELECT fs.*, ai.name AS item_name,
           (fs.nearest_ed_date < (now() AT TIME ZONE 'Asia/Jakarta')::date) AS ed_lewat
    FROM forecast_suggestion fs JOIN accurate_item ai ON ai.id = fs.item_id
    WHERE fs.dokumen_id = ${id} AND fs.status = 'draft'
    ORDER BY ai.name
  `;
  if (lines.length === 0) return { ok: false, error: "dokumen tidak punya barang untuk diajukan" };
  const nol = lines.filter((l) => !((l.final_qty != null ? Number(l.final_qty) : Number(l.suggested_qty)) > 0));
  if (nol.length) {
    return { ok: false, error: `qty final harus > 0 (atau abaikan barangnya): ${nol.map((l) => l.item_name).join(", ")}` };
  }

  const description = deskripsiDokumen(
    {
      kode: String(d.kode),
      warehouseNama: String(d.warehouse_nama),
      kategori: String(d.kategori),
      periode: toIsoDate(d.periode),
      pipelineHot: Math.max(...lines.map((l) => Number(l.pipeline_hot_count))),
      rentangRata: [
        labelRentang(lines.map((l) => (l.avg_dari && l.avg_sampai ? { dari: toIsoDate(l.avg_dari), sampai: toIsoDate(l.avg_sampai) } : null))),
        labelJenis(lines.map((l) => (l.avg_jenis ? String(l.avg_jenis) : null))),
      ].filter(Boolean).join(" · "),
    },
    lines.map((l) => {
      const reasons = Array.isArray(l.reasons) ? (l.reasons as string[]) : [];
      return {
        itemName: String(l.item_name),
        qty: l.final_qty != null ? Number(l.final_qty) : Number(l.suggested_qty),
        currentQty: Number(l.current_qty),
        bufferQty: l.buffer_qty != null ? Number(l.buffer_qty) : null,
        edLewat: reasons.includes("near_ed") && l.ed_lewat === true,
        nearEd: reasons.includes("near_ed"),
        notes: l.notes ? String(l.notes) : null,
      };
    }),
  );

  // Klaim atomik SEBELUM membuat approval (dua klik "Ajukan" bersamaan dulu
  // membuat dua approval_request — uji dev 12 Okt 2026).
  const [claim] = await sql`
    UPDATE forecast_dokumen SET status = 'submitted', submitted_by = ${submittedBy}, submitted_at = now()
    WHERE id = ${id} AND status = 'draft'
    RETURNING id
  `;
  if (!claim) return { ok: false, error: "dokumen ini sudah diajukan (atau sedang diajukan) — muat ulang halaman" };
  const ikut = (
    await sql`
      UPDATE forecast_suggestion SET status = 'submitted', reviewed_by = ${submittedBy}, reviewed_at = now()
      WHERE dokumen_id = ${id} AND status = 'draft'
      RETURNING id
    `
  ).map((r) => String(r.id));

  const lepasKlaim = async () => {
    await sql`
      UPDATE forecast_suggestion SET status = 'draft', reviewed_by = NULL, reviewed_at = NULL
      WHERE id = ANY(${ikut}::uuid[]) AND status = 'submitted' AND approval_request_id IS NULL
    `;
    await sql`
      UPDATE forecast_dokumen SET status = 'draft', submitted_by = NULL, submitted_at = NULL
      WHERE id = ${id} AND status = 'submitted' AND approval_request_id IS NULL
    `;
  };
  let res: Awaited<ReturnType<typeof createApprovalRequest>>;
  try {
    res = await createApprovalRequest({
      title: `Forecast ${d.warehouse_nama} — ${d.kategori} — ${namaBulan(toIsoDate(d.periode))}`,
      description,
      requestedBy: submittedBy,
      wilayah,
      kategori: d.kategori,
      // index unik approval_request_ref_pending_uq = pagar kedua submit kembar.
      refTabel: "forecast_dokumen",
      refId: id,
    });
  } catch (e) {
    await lepasKlaim();
    throw e;
  }
  if (!res.ok || !res.id) {
    await lepasKlaim();
    return { ok: false, error: res.error ?? "gagal membuat approval request" };
  }

  await sql`UPDATE forecast_dokumen SET approval_request_id = ${res.id} WHERE id = ${id}`;
  await sql`UPDATE forecast_suggestion SET approval_request_id = ${res.id} WHERE id = ANY(${ikut}::uuid[])`;
  return { ok: true, approvalId: res.id, approvalKode: res.kode, notify: res.notify };
}

// ── Wilayah approval dinamis ───────────────────────────────────────────────
// Keputusan user 15 Nov 2026: wilayah gudang tidak diisi manual, tapi ikut
// HoD Sales dari cabang penjualan yang dilayani gudang itu. Rantai:
// gudang ← cabang penjualan (peta 319: nama sama / peta manual) →
// hod_territory (cabang → hod_key) → peta approval tahap 1 (hod_key_map
// {"east": "rocky", "west": "yogi"}, dibalik). warehouse.wilayah (manual)
// hanya CADANGAN bila tak bisa diturunkan: gudang tanpa cabang penjualan,
// cabang tanpa HoD, atau cabangnya terbagi ke dua wilayah.

export interface WilayahTurunan {
  wilayah: string | null;
  sumber: "hod" | "manual" | null;
  /** Cabang penjualan yang dilayani gudang ini beserta HoD-nya. */
  cabang: { cabang: string; hod: string | null }[];
  /** Alasan jatuh ke cadangan manual. */
  catatan?: string;
}

/** Wilayah satu gudang dari HoD cabang-cabang penjualannya; null = tak bisa diturunkan. */
export function tentukanWilayah(
  cabang: { cabang: string; hod: string | null }[],
  hodKeWilayah: Map<string, string>,
): { wilayah: string | null; catatan?: string } {
  if (cabang.length === 0) return { wilayah: null, catatan: "tidak ada cabang penjualan yang dilayani gudang ini" };
  const w = new Set(cabang.map((c) => (c.hod ? hodKeWilayah.get(c.hod.toLowerCase()) ?? null : null)).filter((x): x is string => !!x));
  if (w.size === 0) return { wilayah: null, catatan: "cabang penjualannya belum punya HoD di teritori HoD" };
  if (w.size > 1) return { wilayah: null, catatan: "cabang penjualannya terbagi ke HoD East dan West" };
  return { wilayah: [...w][0] };
}

async function wilayahGudang(sql: Sql): Promise<Map<string, WilayahTurunan>> {
  const [gudangRows, teritori, petaRows, chain] = await Promise.all([
    sql`SELECT kode, nama, cabang, wilayah FROM warehouse WHERE jenis = 'cabang'`,
    sql`SELECT DISTINCT ON (upper(cabang)) cabang, hod_key FROM hod_territory ORDER BY upper(cabang), (source = 'manual') DESC, updated_at DESC`,
    sql`SELECT cabang FROM forecast_cabang_gudang`,
    sql`SELECT hod_key_map FROM approval_chain_config WHERE hod_key_map ? 'east' OR hod_key_map ? 'west' LIMIT 1`,
  ]);
  const hodKeWilayah = new Map<string, string>();
  const peta = (chain[0]?.hod_key_map ?? {}) as Record<string, string>;
  for (const [wil, hod] of Object.entries(peta)) if (isWilayah(wil) && hod) hodKeWilayah.set(String(hod).toLowerCase(), wil);
  const hodCabang = new Map(teritori.map((t) => [normal(String(t.cabang)), String(t.hod_key)]));
  const { manual, gudang } = await muatPeta(sql);
  // Semua nama cabang penjualan yang dikenal: teritori HoD + peta manual.
  const namaCabang = new Map<string, string>();
  for (const t of teritori) namaCabang.set(normal(String(t.cabang)), String(t.cabang));
  for (const r of petaRows) namaCabang.set(normal(String(r.cabang)), String(r.cabang));

  const out = new Map<string, WilayahTurunan>();
  for (const g of gudangRows) {
    const kode = String(g.kode);
    const dilayani = [...namaCabang.values()]
      .filter((c) => gudangUntukCabang(c, manual, gudang) === kode)
      .map((c) => ({ cabang: c, hod: hodCabang.get(normal(c)) ?? null }));
    const t = tentukanWilayah(dilayani, hodKeWilayah);
    const manualWil = g.wilayah ? String(g.wilayah) : null;
    out.set(
      kode,
      t.wilayah
        ? { wilayah: t.wilayah, sumber: "hod", cabang: dilayani }
        : { wilayah: manualWil, sumber: manualWil ? "manual" : null, cabang: dilayani, catatan: t.catatan },
    );
  }
  return out;
}

export interface WilayahCabangRow {
  kode: string;
  nama: string;
  /** Wilayah yang dipakai approval (turunan HoD, atau cadangan manual). */
  wilayah: string | null;
  sumber: "hod" | "manual" | null;
  /** Isian manual (cadangan). */
  wilayahManual: string | null;
  cabang: { cabang: string; hod: string | null }[];
  catatan?: string;
}

export async function listWilayahCabang(): Promise<WilayahCabangRow[]> {
  const sql = db();
  const [rows, turunan] = await Promise.all([
    sql`SELECT kode, nama, wilayah FROM warehouse WHERE jenis = 'cabang' AND aktif ORDER BY urutan, nama`,
    wilayahGudang(sql),
  ]);
  return rows.map((r) => {
    const t = turunan.get(String(r.kode));
    return {
      kode: String(r.kode),
      nama: String(r.nama),
      wilayah: t?.wilayah ?? null,
      sumber: t?.sumber ?? null,
      wilayahManual: r.wilayah ? String(r.wilayah) : null,
      cabang: t?.cabang ?? [],
      ...(t?.catatan ? { catatan: t.catatan } : {}),
    };
  });
}

export async function setWilayahCabang(kode: string, wilayah: unknown): Promise<{ ok: boolean; error?: string }> {
  if (wilayah !== null && !isWilayah(wilayah)) return { ok: false, error: `wilayah harus ${WILAYAH.join("/")} atau kosong` };
  const sql = db();
  const done = await sql`UPDATE warehouse SET wilayah = ${wilayah as string | null} WHERE kode = ${kode} AND jenis = 'cabang' RETURNING kode`;
  if (!done.length) return { ok: false, error: `gudang cabang "${kode}" tidak ditemukan` };
  return { ok: true };
}

export interface LinkPoInput {
  /** Nomor PO Accurate (mis. 1098/WRG/1026) yang dibuat Purchasing untuk usulan ini. */
  poNumber: string;
}

export interface LinkPoResult {
  ok: boolean;
  error?: string;
  purchaseOrderId?: string;
  poNumber?: string;
  /** Tertaut, tapi barang usulan tak ditemukan di baris PO (mungkin diganti/salah nomor). */
  warning?: string;
}


// F153 — usulan yang SUDAH approved (F11) ditautkan ke PO nyata. Sejak PO
// Tracker jadi cermin Accurate (migrasi 205, keputusan user 12 Okt 2026), PO
// dibuat Purchasing DI ACCURATE; WRG-OS tak lagi membuat PO sendiri (dulu:
// "auto-draft" PO lokal yang lalu harus diketik ulang ke Accurate = dua versi).
// Di sini cukup menautkan nomor PO Accurate yang sudah tersinkron, supaya
// usulan → PO → barang diterima bisa dilacak. Idempoten via
// forecast_suggestion.purchase_order_id; klaim atomik seperti sebelumnya.
export async function linkPurchaseOrder(id: string, input: LinkPoInput): Promise<LinkPoResult> {
  const poNumber = String(input?.poNumber ?? "").trim();
  if (!poNumber) return { ok: false, error: "nomor PO Accurate wajib diisi" };

  const sql = db();
  const rows = await sql`
    SELECT fs.*, ai.no AS item_no, ar.status AS approval_status, ${sql.unsafe(PO_MATI_SQL)} AS po_mati
    FROM forecast_suggestion fs
    JOIN accurate_item ai ON ai.id = fs.item_id
    LEFT JOIN approval_request ar ON ar.id = fs.approval_request_id
    LEFT JOIN purchase_order po ON po.id = fs.purchase_order_id
    WHERE fs.id = ${id}
  `;
  if (rows.length === 0) return { ok: false, error: "usulan tidak ditemukan" };
  const r = rows[0];
  const relink = r.status === "ordered" && !!r.purchase_order_id && r.po_mati === true;
  const prevPoId: string | null = r.purchase_order_id ? String(r.purchase_order_id) : null;
  if (r.purchase_order_id && !relink) return { ok: false, error: "usulan ini sudah ditautkan ke PO" };
  if (r.status !== "submitted" && !relink) {
    return { ok: false, error: `usulan berstatus "${r.status}" — harus "submitted" (sudah diajukan) dulu` };
  }
  if (r.approval_status !== "approved") {
    return { ok: false, error: `approval usulan ini belum selesai (status: ${r.approval_status ?? "belum ada approval_request"})` };
  }

  const [po] = await sql`
    SELECT po.id, po.po_number, ${sql.unsafe(PO_MATI_SQL)} AS mati
    FROM purchase_order po WHERE po.po_number = ${poNumber}
  `;
  if (!po) {
    return {
      ok: false,
      error: `PO "${poNumber}" belum ada di PO Tracker — pastikan sudah dibuat di Accurate, lalu tunggu sinkron berikutnya (atau klik Sinkron di PO Tracker).`,
    };
  }
  if (po.mati === true) return { ok: false, error: `PO "${poNumber}" sudah dibatalkan/ditutup — tautkan ke PO yang aktif` };
  if (prevPoId === String(po.id)) return { ok: false, error: "usulan ini sudah tertaut ke PO itu" };

  const [claim] = relink
    ? await sql`
        UPDATE forecast_suggestion SET purchase_order_id = ${po.id}
        WHERE id = ${id} AND status = 'ordered' AND purchase_order_id = ${prevPoId}
        RETURNING id
      `
    : await sql`
        UPDATE forecast_suggestion SET status = 'ordered', purchase_order_id = ${po.id}
        WHERE id = ${id} AND status = 'submitted' AND purchase_order_id IS NULL
        RETURNING id
      `;
  if (!claim) return { ok: false, error: "usulan ini sudah ditautkan (atau sedang ditautkan) — muat ulang halaman" };

  // Cek lunak: barang usulan ada di baris PO? Baris PO Accurate bisa belum
  // tertarik (detail menyusul), jadi kosong = tak dinilai, bukan peringatan.
  const lines = await sql`SELECT item_no FROM purchase_order_item WHERE purchase_order_id = ${po.id}`;
  const warning =
    lines.length > 0 && r.item_no && !lines.some((l) => l.item_no === r.item_no)
      ? `barang usulan (${r.item_no}) tidak ada di baris PO ${poNumber} — cek lagi nomornya`
      : undefined;
  return { ok: true, purchaseOrderId: String(po.id), poNumber: String(po.po_number), ...(warning ? { warning } : {}) };
}

// ── Rekap Purchasing (semua cabang, per barang, per bulan) ─────────────────
// Hanya dokumen yang approval-nya sudah DISETUJUI. Purchasing membuat PO di
// Accurate dari rekap ini, lalu menautkan nomornya per barang — satu nomor
// PO berlaku untuk semua cabang yang memesan barang itu.

export interface RekapCabang {
  suggestionId: string;
  warehouseKode: string;
  warehouseNama: string;
  dokumenKode: string;
  qty: number;
  status: string;
  poNumber: string | null;
  poMati: boolean;
  notes: string | null;
}

export interface RekapBarang {
  itemId: number;
  itemNo: string | null;
  itemName: string;
  kategori: string | null;
  totalQty: number;
  cabang: RekapCabang[];
  /** Baris yang masih bisa ditautkan ke PO (belum tertaut, atau PO-nya mati). */
  belumPo: number;
}

export interface RekapResult {
  bulan: string;
  barang: RekapBarang[];
  /** Dokumen bulan itu yang masih menunggu approval — belum masuk rekap. */
  menungguApproval: number;
}

/** Baris bisa (ulang) ditautkan ke PO: disetujui & belum tertaut, atau PO-nya mati. */
export function bisaTautPo(c: { status: string; poNumber: string | null; poMati: boolean }): boolean {
  return (c.status === "submitted" && !c.poNumber) || (c.status === "ordered" && c.poMati);
}

/** Kelompokkan baris approved per barang; urut kategori lalu nama. */
export function kelompokkanRekap(
  rows: (RekapCabang & { itemId: number; itemNo: string | null; itemName: string; kategori: string | null })[],
): RekapBarang[] {
  const map = new Map<number, RekapBarang>();
  for (const r of rows) {
    let b = map.get(r.itemId);
    if (!b) {
      b = { itemId: r.itemId, itemNo: r.itemNo, itemName: r.itemName, kategori: r.kategori, totalQty: 0, cabang: [], belumPo: 0 };
      map.set(r.itemId, b);
    }
    b.cabang.push({
      suggestionId: r.suggestionId, warehouseKode: r.warehouseKode, warehouseNama: r.warehouseNama, dokumenKode: r.dokumenKode,
      qty: r.qty, status: r.status, poNumber: r.poNumber, poMati: r.poMati, notes: r.notes,
    });
    b.totalQty += r.qty;
    if (bisaTautPo(r)) b.belumPo++;
  }
  return [...map.values()].sort(
    (a, b) => (a.kategori ?? "~").localeCompare(b.kategori ?? "~") || a.itemName.localeCompare(b.itemName),
  );
}

export async function rekapPurchasing(bulan: string, brandFilter?: string): Promise<RekapResult | { error: string }> {
  const brand = String(brandFilter ?? "").trim();
  const periode = periodeDariBulan(bulan);
  if (!periode) return { error: "bulan harus berformat YYYY-MM" };
  const sql = db();
  const rows = await sql`
    SELECT fs.id, fs.item_id, ai.no AS item_no, ai.name AS item_name, fs.kategori, fs.warehouse_kode, w.nama AS warehouse_nama,
           d.kode AS dokumen_kode, COALESCE(fs.final_qty, fs.suggested_qty) AS qty, fs.status, fs.notes,
           po.po_number, ${sql.unsafe(PO_MATI_SQL)} AS po_mati
    FROM forecast_suggestion fs
    JOIN forecast_dokumen d ON d.id = fs.dokumen_id
    JOIN approval_request ar ON ar.id = d.approval_request_id
    JOIN accurate_item ai ON ai.id = fs.item_id
    JOIN warehouse w ON w.kode = fs.warehouse_kode
    LEFT JOIN purchase_order po ON po.id = fs.purchase_order_id
    WHERE d.periode = ${periode}::date AND d.status = 'submitted' AND ar.status = 'approved'
      AND fs.status IN ('submitted', 'ordered')
      AND ${brand ? sql`upper(item_brand(fs.item_id)) = upper(${brand})` : sql`true`}
    ORDER BY w.urutan, w.nama
  `;
  const [{ n }] = await sql`
    SELECT count(*)::int AS n FROM forecast_dokumen d LEFT JOIN approval_request ar ON ar.id = d.approval_request_id
    WHERE d.periode = ${periode}::date AND d.status = 'submitted' AND COALESCE(ar.status, 'pending') = 'pending'
  `;
  const barang = kelompokkanRekap(
    rows.map((r) => ({
      suggestionId: String(r.id),
      itemId: Number(r.item_id),
      itemNo: r.item_no ? String(r.item_no) : null,
      itemName: String(r.item_name),
      kategori: r.kategori ? String(r.kategori) : null,
      warehouseKode: String(r.warehouse_kode),
      warehouseNama: String(r.warehouse_nama),
      dokumenKode: String(r.dokumen_kode),
      qty: Number(r.qty),
      status: String(r.status),
      poNumber: r.po_number ? String(r.po_number) : null,
      poMati: r.po_mati === true,
      notes: r.notes ? String(r.notes) : null,
    })),
  );
  return { bulan: periode.slice(0, 7), barang, menungguApproval: Number(n) };
}

export interface LinkPoRekapResult {
  ok: boolean;
  error?: string;
  /** Jumlah baris cabang yang tertaut. */
  linked?: number;
  poNumber?: string;
  warning?: string;
  /** Baris yang gagal ditautkan (cabang: alasan). */
  gagal?: string[];
}

// Tautkan satu nomor PO Accurate ke SEMUA cabang yang memesan barang itu di
// bulan itu. Per baris memakai linkPurchaseOrder apa adanya (cek approval,
// PO tersinkron & hidup, klaim atomik).
export async function linkPoRekap(input: { bulan: string; itemId: number; poNumber: string }): Promise<LinkPoRekapResult> {
  const poNumber = String(input.poNumber ?? "").trim();
  if (!poNumber) return { ok: false, error: "nomor PO Accurate wajib diisi" };
  const rekap = await rekapPurchasing(input.bulan);
  if ("error" in rekap) return { ok: false, error: rekap.error };
  const barang = rekap.barang.find((b) => b.itemId === Number(input.itemId));
  if (!barang) return { ok: false, error: "barang ini tidak ada di rekap bulan itu (belum disetujui?)" };
  const target = barang.cabang.filter(bisaTautPo);
  if (target.length === 0) return { ok: false, error: "semua cabang untuk barang ini sudah tertaut ke PO" };

  let linked = 0;
  let warning: string | undefined;
  const gagal: string[] = [];
  for (const c of target) {
    const r = await linkPurchaseOrder(c.suggestionId, { poNumber });
    if (r.ok) {
      linked++;
      warning ??= r.warning;
    } else {
      gagal.push(`${c.warehouseNama}: ${r.error}`);
    }
  }
  if (linked === 0) return { ok: false, error: gagal[0]?.replace(/^[^:]+: /, "") ?? "gagal menautkan PO", gagal };
  return { ok: true, linked, poNumber, ...(warning ? { warning } : {}), ...(gagal.length ? { gagal } : {}) };
}

const HEADER_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F1B2D" } } as const;

function gayaHeader(ws: ExcelJS.Worksheet) {
  ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  ws.getRow(1).fill = HEADER_FILL;
  ws.views = [{ state: "frozen", ySplit: 1 }];
}

/** Excel rekap: sheet Rekap (barang × cabang + total) dan Rincian (per baris dokumen). */
export async function rekapXlsx(bulan: string, brand?: string): Promise<Buffer | { error: string }> {
  const rekap = await rekapPurchasing(bulan, brand);
  if ("error" in rekap) return rekap;
  const cabang = [...new Map(rekap.barang.flatMap((b) => b.cabang.map((c) => [c.warehouseKode, c.warehouseNama] as const))).entries()];
  const wb = new ExcelJS.Workbook();

  const ws = wb.addWorksheet("Rekap");
  ws.columns = [
    { header: "No", key: "no", width: 6 },
    { header: "Kode Barang", key: "item_no", width: 16 },
    { header: "Nama Barang", key: "item_name", width: 44 },
    { header: "Kategori", key: "kategori", width: 10 },
    ...cabang.map(([kode, nama]) => ({ header: nama.replace(/^Gudang /, ""), key: `c_${kode}`, width: 12, style: { numFmt: "#,##0" } })),
    { header: "Total", key: "total", width: 12, style: { numFmt: "#,##0" } },
    { header: "No. PO", key: "po", width: 24 },
  ];
  rekap.barang.forEach((b, i) => {
    const row: Record<string, unknown> = {
      no: i + 1, item_no: b.itemNo ?? "", item_name: b.itemName, kategori: b.kategori ?? "", total: b.totalQty,
      po: [...new Set(b.cabang.map((c) => c.poNumber).filter(Boolean))].join(", "),
    };
    for (const c of b.cabang) row[`c_${c.warehouseKode}`] = (Number(row[`c_${c.warehouseKode}`] ?? 0) + c.qty);
    ws.addRow(row);
  });
  gayaHeader(ws);

  const rinci = wb.addWorksheet("Rincian");
  rinci.columns = [
    { header: "Dokumen", key: "dok", width: 24 },
    { header: "Cabang", key: "cabang", width: 20 },
    { header: "Kategori", key: "kategori", width: 10 },
    { header: "Kode Barang", key: "item_no", width: 16 },
    { header: "Nama Barang", key: "item_name", width: 44 },
    { header: "Qty", key: "qty", width: 10, style: { numFmt: "#,##0" } },
    { header: "Status", key: "status", width: 12 },
    { header: "No. PO", key: "po", width: 24 },
    { header: "Catatan", key: "notes", width: 36 },
  ];
  for (const b of rekap.barang) {
    for (const c of b.cabang) {
      rinci.addRow({
        dok: c.dokumenKode, cabang: c.warehouseNama, kategori: b.kategori ?? "", item_no: b.itemNo ?? "", item_name: b.itemName,
        qty: c.qty, status: c.status === "ordered" ? "PO tertaut" : "Disetujui", po: c.poNumber ?? "", notes: c.notes ?? "",
      });
    }
  }
  gayaHeader(rinci);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const STATUS_DOK: Record<string, string> = { draft: "Draft", submitted: "Diajukan", closed: "Ditutup" };
const STATUS_APPROVAL: Record<string, string> = { pending: "Menunggu approval", approved: "Disetujui", rejected: "Ditolak", canceled: "Dibatalkan" };
const STATUS_BARIS: Record<string, string> = { draft: "Draft", submitted: "Diajukan", ordered: "PO tertaut", dismissed: "Diabaikan" };

/** Excel dokumen cabang: sheet Dokumen (ringkasan) + Barang (semua baris, termasuk yang diabaikan). */
export async function dokumenXlsx(
  filter: { status?: string; bulan?: string; id?: string; brand?: string },
): Promise<{ buf: Buffer; nama: string } | { error: string }> {
  if (filter.bulan && !periodeDariBulan(filter.bulan)) return { error: "bulan harus berformat YYYY-MM" };
  const docs = await listDokumen(filter);
  if (filter.id && docs.length === 0) return { error: "dokumen tidak ditemukan" };
  const wb = new ExcelJS.Workbook();

  const ws = wb.addWorksheet("Dokumen");
  ws.columns = [
    { header: "Kode", key: "kode", width: 24 },
    { header: "Cabang", key: "cabang", width: 20 },
    { header: "Kategori", key: "kategori", width: 10 },
    { header: "Periode", key: "periode", width: 16 },
    { header: "Wilayah", key: "wilayah", width: 9 },
    { header: "Status", key: "status", width: 11 },
    { header: "Approval", key: "approval", width: 20 },
    { header: "Jumlah Barang", key: "jumlah", width: 13, style: { numFmt: "#,##0" } },
    { header: "Total Qty", key: "total", width: 12, style: { numFmt: "#,##0" } },
    { header: "Diajukan oleh", key: "oleh", width: 22 },
  ];
  for (const d of docs) {
    ws.addRow({
      kode: d.kode, cabang: d.warehouseNama, kategori: d.kategori ?? "Belum ada", periode: namaBulan(`${d.periode}-01`),
      wilayah: d.wilayah ? d.wilayah.charAt(0).toUpperCase() + d.wilayah.slice(1) : "", status: STATUS_DOK[d.status] ?? d.status,
      approval: d.approvalStatus ? `${d.approvalKode ?? ""} ${STATUS_APPROVAL[d.approvalStatus] ?? d.approvalStatus}`.trim() : "",
      jumlah: d.jumlahBarang, total: d.totalQty, oleh: d.submittedBy ?? "",
    });
  }
  gayaHeader(ws);

  const wsb = wb.addWorksheet("Barang");
  wsb.columns = [
    { header: "Dokumen", key: "dok", width: 24 },
    { header: "Cabang", key: "cabang", width: 20 },
    { header: "Kategori", key: "kategori", width: 10 },
    { header: "Kode Barang", key: "item_no", width: 16 },
    { header: "Nama Barang", key: "item_name", width: 44 },
    { header: "Brand", key: "brand", width: 16 },
    { header: "Alasan", key: "alasan", width: 26 },
    { header: "Stok", key: "stok", width: 9, style: { numFmt: "#,##0.##" } },
    { header: "Buffer %", key: "persen", width: 9, style: { numFmt: "#,##0.##" } },
    { header: "Stok Minimum", key: "buffer", width: 12, style: { numFmt: "#,##0.##" } },
    { header: "ED Terdekat", key: "ed", width: 12 },
    { header: "Rata²/bln", key: "avg", width: 10, style: { numFmt: "#,##0.##" } },
    { header: "Rentang Rata²", key: "rentang", width: 24 },
    { header: "Jenis Penjualan", key: "jenis", width: 15 },
    { header: "Usulan Sistem", key: "usulan", width: 12, style: { numFmt: "#,##0" } },
    { header: "Qty Final", key: "final", width: 10, style: { numFmt: "#,##0" } },
    { header: "Catatan", key: "notes", width: 32 },
    { header: "Status", key: "status", width: 12 },
    { header: "No. PO", key: "po", width: 22 },
  ];
  const alasan: Record<string, string> = { near_buffer: "Di bawah buffer", near_ed: "Batch mendekati/lewat ED" };
  for (const d of docs) {
    for (const l of d.lines) {
      wsb.addRow({
        dok: d.kode, cabang: d.warehouseNama, kategori: l.kategori ?? d.kategori ?? "", item_no: l.itemNo ?? "", item_name: l.itemName,
        brand: l.brand ?? "", jenis: LABEL_JENIS[(l.avgJenis ?? "semua") as JenisPenjualan] ?? l.avgJenis,
        alasan: l.reasons.map((r) => alasan[r] ?? r).join(", "), stok: l.currentQty, persen: l.bufferPersen, buffer: l.bufferQty,
        ed: l.nearestEdDate ?? "", avg: l.avgMonthlyQty6m, rentang: labelRentang([l.avgDari && l.avgSampai ? { dari: l.avgDari, sampai: l.avgSampai } : null]) ?? "",
        usulan: l.suggestedQty, final: qtyEfektif(l), notes: l.notes ?? "", status: STATUS_BARIS[l.status] ?? l.status, po: l.purchaseOrderNumber ?? "",
      });
    }
  }
  gayaHeader(wsb);

  const nama = filter.id && docs[0]
    ? `${docs[0].kode}.xlsx`
    : `Dokumen_Forecast${filter.bulan ? `_${filter.bulan}` : ""}${filter.status ? `_${filter.status}` : ""}${filter.brand ? `_${filter.brand}` : ""}.xlsx`;
  return { buf: Buffer.from(await wb.xlsx.writeBuffer()), nama };
}
