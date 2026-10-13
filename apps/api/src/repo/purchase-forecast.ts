import { db } from "../db.js";

// F41 Forecast vs Realisasi PO — rombak 13 Okt 2026 (migrasi 213).
//
// Forecast = rencana pembelian dalam RUPIAH per bulan × lini × vendor
// (lini NULL = semua lini, vendor NULL = semua vendor). Realisasi dihitung dari
// PO Accurate (purchase_order + purchase_order_item, cermin migrasi 205), PO
// batal tak dihitung. Keputusan user:
//   - pecahan resmi = lini + vendor; brand hanya tampilan analisis (vendor ≈
//     principal dan datanya 100% lengkap, brand bergantung Klasifikasi Produk);
//   - lini TIDAK dari purchase_order.lini (kosong di semua PO Accurate) tapi
//     per BARANG lewat Klasifikasi Produk: product_code.kategori IVD → 'IVD',
//     kategori lain → 'Medical', tak terpetakan → NULL ("Belum terklasifikasi").
// Barang PO dicocokkan ke product_code lewat kode_2025 (= nomor barang
// Accurate) atau accurate_item_id → accurate_item.no.

type Sql = ReturnType<typeof db>;

export type PurchaseForecastLini = "IVD" | "Medical";

export class PurchaseForecastError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "PurchaseForecastError";
  }
}

export interface PurchaseForecastRow {
  id: string;
  period_year: number;
  period_month: number;
  lini: PurchaseForecastLini | null;
  vendor_id: number | null;
  vendor_name: string | null;
  forecast_value: number;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  actual_value: number;
  gap_value: number;
  gap_percent: number | null;
}

export const gapPercent = (forecast: number, actual: number): number | null =>
  forecast > 0 ? Math.round(((actual - forecast) / forecast) * 1000) / 10 : null;

function mapRow(r: Record<string, unknown>): PurchaseForecastRow {
  const forecast_value = Number(r.forecast_value);
  const actual_value = Number(r.actual_value ?? 0);
  return {
    id: String(r.id),
    period_year: Number(r.period_year),
    period_month: Number(r.period_month),
    lini: (r.lini != null ? String(r.lini) : null) as PurchaseForecastLini | null,
    vendor_id: r.vendor_id != null ? Number(r.vendor_id) : null,
    vendor_name: r.vendor_name != null ? String(r.vendor_name) : null,
    forecast_value,
    notes: r.notes != null ? String(r.notes) : null,
    created_by: r.created_by != null ? String(r.created_by) : null,
    created_at: String(r.created_at),
    updated_at: String(r.updated_at),
    actual_value,
    gap_value: actual_value - forecast_value,
    gap_percent: gapPercent(forecast_value, actual_value),
  };
}

// Baris barang PO (non-batal) + lini & brand hasil Klasifikasi Produk.
function poBaris(sql: Sql) {
  return sql`
    SELECT
      po.id AS po_id,
      EXTRACT(YEAR FROM po.order_date)::int AS y,
      EXTRACT(MONTH FROM po.order_date)::int AS m,
      po.vendor_id,
      COALESCE(av.name, po.vendor_name) AS vendor_name,
      poi.qty_ordered * COALESCE(poi.unit_price, 0) AS nilai,
      CASE WHEN kl.kategori IS NULL THEN NULL
           WHEN upper(kl.kategori) = 'IVD' THEN 'IVD'
           ELSE 'Medical' END AS lini,
      kl.brand
    FROM purchase_order po
    JOIN purchase_order_item poi ON poi.purchase_order_id = po.id
    LEFT JOIN accurate_vendor av ON av.id = po.vendor_id
    LEFT JOIN LATERAL (
      SELECT k.nama AS kategori, NULLIF(trim(pc.brand), '') AS brand
      FROM product_code pc
      JOIN product_kategori k ON k.id = pc.kategori_id
      LEFT JOIN accurate_item ai ON ai.id = pc.accurate_item_id
      WHERE poi.item_no IS NOT NULL AND (pc.kode_2025 = poi.item_no OR ai.no = poi.item_no)
      ORDER BY (pc.kode_2025 = poi.item_no) DESC NULLS LAST
      LIMIT 1
    ) kl ON true
    WHERE po.cancelled_at IS NULL AND po.order_date IS NOT NULL
  `;
}

function forecastSelect(sql: Sql, f: { id?: string; year?: number; month?: number }) {
  const where = sql`
    ${f.id ? sql`f.id = ${f.id}` : sql`true`}
    AND ${f.year ? sql`f.period_year = ${f.year}` : sql`true`}
    AND ${f.month ? sql`f.period_month = ${f.month}` : sql`true`}
  `;
  return sql`
    WITH b AS (${poBaris(sql)})
    SELECT f.id, f.period_year, f.period_month, f.lini, f.vendor_id,
           COALESCE(av.name, f.vendor_name) AS vendor_name,
           f.forecast_value, f.notes, f.created_by, f.created_at::text, f.updated_at::text,
           COALESCE((
             SELECT SUM(b.nilai) FROM b
             WHERE b.y = f.period_year AND b.m = f.period_month
               AND (f.lini IS NULL OR b.lini = f.lini)
               AND (f.vendor_id IS NULL OR b.vendor_id = f.vendor_id)
           ), 0) AS actual_value
    FROM purchase_forecast f
    LEFT JOIN accurate_vendor av ON av.id = f.vendor_id
    WHERE ${where}
    ORDER BY f.period_year DESC, f.period_month DESC, f.lini NULLS FIRST, 6 NULLS FIRST
  `;
}

function isUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: string }).code === "23505";
}

function validateLini(lini: unknown): PurchaseForecastLini | null {
  if (lini === undefined || lini === null || lini === "") return null;
  if (lini !== "IVD" && lini !== "Medical") {
    throw new PurchaseForecastError(400, "lini tidak valid (IVD/Medical, atau kosongkan untuk semua lini)");
  }
  return lini;
}

// Vendor wajib ada di master Accurate; nama disimpan sebagai snapshot.
async function resolveVendor(vendorId: unknown): Promise<{ id: number | null; name: string | null }> {
  if (vendorId === undefined || vendorId === null || vendorId === "") return { id: null, name: null };
  const id = Number(vendorId);
  if (!Number.isInteger(id) || id <= 0) throw new PurchaseForecastError(400, "vendor_id tidak valid");
  const [v] = await db()`SELECT id, name FROM accurate_vendor WHERE id = ${id}`;
  if (!v) throw new PurchaseForecastError(400, "vendor tidak ditemukan di master vendor Accurate");
  return { id: Number(v.id), name: v.name != null ? String(v.name) : null };
}

const maxForecastYear = (): number => new Date().getUTCFullYear() + 10;

export function validatePeriod(year: number, month: number): void {
  if (!Number.isInteger(year) || year < 2000 || year > maxForecastYear()) {
    throw new PurchaseForecastError(400, `period_year tidak valid (2000-${maxForecastYear()})`);
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new PurchaseForecastError(400, "period_month harus 1-12");
  }
}

export function validateValue(v: unknown): number {
  const n = typeof v === "string" && v.trim() === "" ? NaN : Number(v);
  if (v === null || v === undefined || !Number.isFinite(n) || n < 0) {
    throw new PurchaseForecastError(400, "forecast_value harus angka >= 0");
  }
  return n;
}

const DUPLIKAT = "Forecast untuk bulan + lini + vendor ini sudah ada — edit baris yang ada, jangan duplikat";

export async function listPurchaseForecast(opts?: { year?: number; month?: number }): Promise<PurchaseForecastRow[]> {
  const rows = await forecastSelect(db(), { year: opts?.year, month: opts?.month });
  return rows.map(mapRow);
}

async function getById(id: string): Promise<PurchaseForecastRow | null> {
  const rows = await forecastSelect(db(), { id });
  return rows.length ? mapRow(rows[0]) : null;
}

export interface PurchaseForecastInput {
  period_year: number;
  period_month: number;
  lini?: PurchaseForecastLini | null;
  vendor_id?: number | null;
  forecast_value: number;
  notes?: string | null;
  created_by?: string | null;
}

export async function createPurchaseForecast(t: PurchaseForecastInput): Promise<PurchaseForecastRow> {
  validatePeriod(Number(t.period_year), Number(t.period_month));
  const value = validateValue(t.forecast_value);
  const lini = validateLini(t.lini);
  const vendor = await resolveVendor(t.vendor_id);
  const sql = db();
  try {
    const [row] = await sql`
      INSERT INTO purchase_forecast (period_year, period_month, lini, vendor_id, vendor_name, forecast_value, notes, created_by)
      VALUES (${Number(t.period_year)}, ${Number(t.period_month)}, ${lini}, ${vendor.id}, ${vendor.name}, ${value},
              ${t.notes?.trim() || null}, ${t.created_by ?? null})
      RETURNING id
    `;
    return (await getById(String(row.id)))!;
  } catch (e) {
    if (isUniqueViolation(e)) throw new PurchaseForecastError(409, DUPLIKAT);
    throw e;
  }
}

export interface PurchaseForecastUpdate {
  period_year?: number;
  period_month?: number;
  lini?: PurchaseForecastLini | null;
  vendor_id?: number | null;
  forecast_value?: number;
  notes?: string | null;
}

// Periode tak bisa diedit (hapus & buat ulang); lini/vendor/nilai/catatan boleh.
export async function updatePurchaseForecast(id: string, f: PurchaseForecastUpdate): Promise<PurchaseForecastRow | null> {
  const sql = db();
  const [existing] = await sql`SELECT period_year, period_month FROM purchase_forecast WHERE id = ${id}`;
  if (!existing) return null;
  if (f.period_year !== undefined && Number(f.period_year) !== Number(existing.period_year)) {
    throw new PurchaseForecastError(400, "periode tidak bisa diedit — hapus & buat ulang kalau perlu pindah periode");
  }
  if (f.period_month !== undefined && Number(f.period_month) !== Number(existing.period_month)) {
    throw new PurchaseForecastError(400, "periode tidak bisa diedit — hapus & buat ulang kalau perlu pindah periode");
  }
  const value = f.forecast_value !== undefined ? validateValue(f.forecast_value) : undefined;
  const lini = f.lini !== undefined ? validateLini(f.lini) : undefined;
  const vendor = f.vendor_id !== undefined ? await resolveVendor(f.vendor_id) : undefined;
  try {
    await sql`
      UPDATE purchase_forecast SET
        lini           = ${lini !== undefined ? lini : sql`lini`},
        vendor_id      = ${vendor !== undefined ? vendor.id : sql`vendor_id`},
        vendor_name    = ${vendor !== undefined ? vendor.name : sql`vendor_name`},
        forecast_value = ${value !== undefined ? value : sql`forecast_value`},
        notes          = ${f.notes !== undefined ? f.notes?.trim() || null : sql`notes`},
        updated_at     = now()
      WHERE id = ${id}
    `;
    return getById(id);
  } catch (e) {
    if (isUniqueViolation(e)) throw new PurchaseForecastError(409, DUPLIKAT);
    throw e;
  }
}

export async function deletePurchaseForecast(id: string): Promise<{ deleted: number }> {
  const sql = db();
  const rows = await sql`DELETE FROM purchase_forecast WHERE id = ${id} RETURNING id`;
  return { deleted: rows.length };
}

// ── Ringkasan per lini / vendor / brand untuk satu periode ──────────────────

export interface RingkasanBaris {
  key: string; // nama lini/vendor/brand, atau "Belum terklasifikasi"/"Vendor tanpa ID Accurate"
  forecast_value: number | null; // null = dimensi tanpa forecast (brand)
  actual_value: number;
  gap_value: number | null;
  gap_percent: number | null;
  po_count: number;
}

export interface PurchaseForecastSummary {
  period_year: number;
  period_month: number | null;
  // forecast_basis: "semua" = baris forecast lini+vendor "semua" dipakai sbg
  // total; "jumlah_baris" = tak ada baris itu, total = jumlah semua baris
  // (benar hanya kalau baris-barisnya tak saling tumpang tindih).
  total: { forecast_value: number; forecast_basis: "semua" | "jumlah_baris" | "kosong"; actual_value: number; gap_value: number; gap_percent: number | null };
  klasifikasi: { actual_value: number; terklasifikasi_value: number; persen: number | null };
  by_lini: RingkasanBaris[];
  by_vendor: RingkasanBaris[];
  by_brand: RingkasanBaris[];
}

export const BELUM_TERKLASIFIKASI = "Belum terklasifikasi";
export const VENDOR_LAIN = "Vendor tanpa ID Accurate";

// Pure — diuji unit. Gabungkan realisasi & forecast per kunci; kunci yang
// hanya punya forecast tetap tampil (realisasi 0), urut realisasi terbesar.
export function gabungRingkasan(
  aktual: { key: string; nilai: number; po: number }[],
  forecast: Map<string, number> | null,
): RingkasanBaris[] {
  const keys = new Set([...aktual.map((a) => a.key), ...(forecast ? forecast.keys() : [])]);
  return [...keys]
    .map((key) => {
      const a = aktual.find((x) => x.key === key);
      const actual_value = a?.nilai ?? 0;
      const fv = forecast ? forecast.get(key) ?? 0 : null;
      return {
        key,
        forecast_value: fv,
        actual_value,
        gap_value: fv != null ? actual_value - fv : null,
        gap_percent: fv != null ? gapPercent(fv, actual_value) : null,
        po_count: a?.po ?? 0,
      };
    })
    .sort((x, y) => y.actual_value - x.actual_value || (y.forecast_value ?? 0) - (x.forecast_value ?? 0));
}

export async function getPurchaseForecastSummary(year: number, month?: number | null): Promise<PurchaseForecastSummary> {
  validatePeriod(year, month ?? 1);
  const sql = db();
  const periode = sql`b.y = ${year} AND ${month ? sql`b.m = ${month}` : sql`true`}`;
  const [lini, vendor, brand, tot, fRows] = await Promise.all([
    sql`WITH b AS (${poBaris(sql)})
        SELECT COALESCE(b.lini, ${BELUM_TERKLASIFIKASI}) AS key, SUM(b.nilai)::float8 AS nilai,
               count(DISTINCT b.po_id)::int AS po
        FROM b WHERE ${periode} GROUP BY 1`,
    sql`WITH b AS (${poBaris(sql)})
        SELECT COALESCE(max(b.vendor_name), ${VENDOR_LAIN}) AS key, SUM(b.nilai)::float8 AS nilai,
               count(DISTINCT b.po_id)::int AS po
        FROM b WHERE ${periode} GROUP BY b.vendor_id`,
    sql`WITH b AS (${poBaris(sql)})
        SELECT COALESCE(b.brand, ${BELUM_TERKLASIFIKASI}) AS key, SUM(b.nilai)::float8 AS nilai,
               count(DISTINCT b.po_id)::int AS po
        FROM b WHERE ${periode} GROUP BY 1`,
    sql`WITH b AS (${poBaris(sql)})
        SELECT COALESCE(SUM(b.nilai), 0)::float8 AS total,
               COALESCE(SUM(b.nilai) FILTER (WHERE b.lini IS NOT NULL), 0)::float8 AS terklas
        FROM b WHERE ${periode}`,
    sql`SELECT f.lini, f.vendor_id, COALESCE(av.name, f.vendor_name) AS vendor_name, f.forecast_value::float8 AS v
        FROM purchase_forecast f LEFT JOIN accurate_vendor av ON av.id = f.vendor_id
        WHERE f.period_year = ${year} AND ${month ? sql`f.period_month = ${month}` : sql`true`}`,
  ]);

  const fLini = new Map<string, number>();
  const fVendor = new Map<string, number>();
  let fJumlah = 0;
  let fSemua: number | null = null;
  for (const r of fRows) {
    const v = Number(r.v);
    fJumlah += v;
    if (!r.lini && r.vendor_id == null) fSemua = (fSemua ?? 0) + v;
    if (r.lini) fLini.set(String(r.lini), (fLini.get(String(r.lini)) ?? 0) + v);
    if (r.vendor_id != null) {
      const k = String(r.vendor_name ?? r.vendor_id);
      fVendor.set(k, (fVendor.get(k) ?? 0) + v);
    }
  }
  const asAktual = (rows: readonly Record<string, unknown>[]) =>
    rows.map((r) => ({ key: String(r.key), nilai: Number(r.nilai), po: Number(r.po) }));

  // Baris "semua lini & semua vendor" = total resmi; tanpa itu jumlahkan semua
  // baris. Menjumlah semuanya tanpa syarat menghitung dobel (5 M semua + 2 M
  // IVD + 1 M vendor X ≠ 8 M) — ketahuan saat uji atas data dev 13 Okt 2026.
  const fTotal = fSemua ?? fJumlah;
  const basis = fSemua != null ? "semua" : fRows.length ? "jumlah_baris" : "kosong";
  const total = Number(tot[0]?.total ?? 0);
  const terklas = Number(tot[0]?.terklas ?? 0);
  return {
    period_year: year,
    period_month: month ?? null,
    total: { forecast_value: fTotal, forecast_basis: basis, actual_value: total, gap_value: total - fTotal, gap_percent: gapPercent(fTotal, total) },
    klasifikasi: { actual_value: total, terklasifikasi_value: terklas, persen: total > 0 ? Math.round((terklas / total) * 1000) / 10 : null },
    by_lini: gabungRingkasan(asAktual(lini), fLini),
    by_vendor: gabungRingkasan(asAktual(vendor), fVendor),
    by_brand: gabungRingkasan(asAktual(brand), null),
  };
}

// Pilihan vendor di form: vendor Accurate yang pernah punya PO, urut nama.
export async function listForecastVendors(): Promise<{ id: number; name: string }[]> {
  const rows = await db()`
    SELECT av.id, av.name FROM accurate_vendor av
    WHERE EXISTS (SELECT 1 FROM purchase_order po WHERE po.vendor_id = av.id)
    ORDER BY av.name
  `;
  return rows.map((r) => ({ id: Number(r.id), name: String(r.name) }));
}
