import { db } from "../db.js";

// F41 Forecast vs Actual PO Gap Report (Purchasing), lanjutan F13 PO Tracker
// (purchase-order.ts) + F35 PO Approval Workflow (kolom purchase_order.lini).
// purchase_forecast = input manual rencana/anggaran pembelian per periode
// (bulan/tahun) + lini opsional (IVD/Medical, NULL = seluruh lini). Tidak ada
// tabel/kolom F13/F35 yang disentuh — file ini murni baca purchase_order/
// purchase_order_item utk menghitung actual/gap (LEFT JOIN LATERAL, correlated
// per baris forecast), pola computed sama "telat" F39/"variance" F51/status
// PO F13. date/timestamptz eksplisit ::text di SELECT/RETURNING (gotcha
// postgres.js yang sama di semua repo lain).

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
  forecast_value: number;
  forecast_qty: number | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  actual_value: number;
  actual_qty: number;
  gap_value: number;
  gap_qty: number | null;
  gap_percent: number | null;
}

function mapRow(r: Record<string, unknown>): PurchaseForecastRow {
  const forecast_value = Number(r.forecast_value);
  const forecast_qty = r.forecast_qty != null ? Number(r.forecast_qty) : null;
  const actual_value = Number(r.actual_value ?? 0);
  const actual_qty = Number(r.actual_qty ?? 0);
  return {
    id: String(r.id),
    period_year: Number(r.period_year),
    period_month: Number(r.period_month),
    lini: (r.lini != null ? String(r.lini) : null) as PurchaseForecastLini | null,
    forecast_value,
    forecast_qty,
    notes: r.notes != null ? String(r.notes) : null,
    created_by: r.created_by != null ? String(r.created_by) : null,
    created_at: String(r.created_at),
    updated_at: String(r.updated_at),
    actual_value,
    actual_qty,
    gap_value: actual_value - forecast_value,
    gap_qty: forecast_qty != null ? actual_qty - forecast_qty : null,
    gap_percent: forecast_value > 0 ? ((actual_value - forecast_value) / forecast_value) * 100 : null,
  };
}

// LEFT JOIN LATERAL correlated ke baris f (periode+lini) — f.lini IS NULL
// artinya forecast "seluruh lini" jadi actual-nya jumlah SEMUA PO periode itu
// (termasuk PO legacy_exempt yang lini-nya sendiri NULL), sedangkan forecast
// ber-lini spesifik hanya menjumlah PO dgn lini yang sama persis.
function forecastCols(sql: ReturnType<typeof db>) {
  return sql`
    f.id, f.period_year, f.period_month, f.lini, f.forecast_value, f.forecast_qty, f.notes, f.created_by,
    f.created_at::text, f.updated_at::text,
    COALESCE(act.actual_value, 0) AS actual_value,
    COALESCE(act.actual_qty, 0) AS actual_qty
  `;
}

const ACTUAL_LATERAL_JOIN = (sql: ReturnType<typeof db>) => sql`
  LEFT JOIN LATERAL (
    SELECT SUM(poi.qty_ordered * COALESCE(poi.unit_price, 0)) AS actual_value,
           SUM(poi.qty_ordered) AS actual_qty
    FROM purchase_order po
    JOIN purchase_order_item poi ON poi.purchase_order_id = po.id
    WHERE po.cancelled_at IS NULL
      AND EXTRACT(YEAR FROM po.order_date)::int = f.period_year
      AND EXTRACT(MONTH FROM po.order_date)::int = f.period_month
      AND (f.lini IS NULL OR po.lini = f.lini)
  ) act ON true
`;

function isUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: string }).code === "23505";
}

function validateLini(lini: unknown): PurchaseForecastLini | null {
  if (lini === undefined || lini === null || lini === "") return null;
  if (lini !== "IVD" && lini !== "Medical") {
    throw new PurchaseForecastError(400, "lini tidak valid (IVD/Medical, atau kosongkan utk seluruh lini)");
  }
  return lini;
}

export interface PurchaseForecastInput {
  period_year: number;
  period_month: number;
  lini?: PurchaseForecastLini | null;
  forecast_value: number;
  forecast_qty?: number | null;
  notes?: string | null;
  created_by?: string | null;
}

// BUG-20 — batas bawah (>=2000) sudah ada sejak awal, tapi tanpa batas atas
// nilai absurd (mis. 999999) diterima mentah-mentah. Batas atas dibuat
// longgar (10 tahun ke depan) — cukup utk forecast wajar, tidak menolak
// input sah yang cuma lebih maju dari tahun berjalan.
function maxForecastYear(): number {
  return new Date().getUTCFullYear() + 10;
}

function validateInput(t: { period_year: number; period_month: number; forecast_value: number }): void {
  if (!Number.isInteger(t.period_year) || t.period_year < 2000 || t.period_year > maxForecastYear()) {
    throw new PurchaseForecastError(400, `period_year tidak valid (2000-${maxForecastYear()})`);
  }
  if (!Number.isInteger(t.period_month) || t.period_month < 1 || t.period_month > 12) {
    throw new PurchaseForecastError(400, "period_month harus 1-12");
  }
  if (!(Number(t.forecast_value) >= 0)) {
    throw new PurchaseForecastError(400, "forecast_value harus >= 0");
  }
}

export async function listPurchaseForecast(opts?: { year?: number }): Promise<PurchaseForecastRow[]> {
  const sql = db();
  const rows = await sql`
    SELECT ${forecastCols(sql)}
    FROM purchase_forecast f
    ${ACTUAL_LATERAL_JOIN(sql)}
    WHERE ${opts?.year ? sql`f.period_year = ${opts.year}` : sql`true`}
    ORDER BY f.period_year DESC, f.period_month DESC, f.lini NULLS FIRST
  `;
  return rows.map(mapRow);
}

export async function createPurchaseForecast(t: PurchaseForecastInput): Promise<PurchaseForecastRow> {
  validateInput(t);
  const lini = validateLini(t.lini);
  const sql = db();
  try {
    const rows = await sql`
      INSERT INTO purchase_forecast (period_year, period_month, lini, forecast_value, forecast_qty, notes, created_by)
      VALUES (${t.period_year}, ${t.period_month}, ${lini}, ${t.forecast_value}, ${t.forecast_qty ?? null}, ${t.notes ?? null}, ${t.created_by ?? null})
      RETURNING id
    `;
    const [row] = await sql`SELECT ${forecastCols(sql)} FROM purchase_forecast f ${ACTUAL_LATERAL_JOIN(sql)} WHERE f.id = ${rows[0].id}`;
    return mapRow(row);
  } catch (e) {
    if (isUniqueViolation(e)) {
      throw new PurchaseForecastError(409, "Forecast utk periode+lini ini sudah ada — edit baris yang ada, jangan duplikat");
    }
    throw e;
  }
}

export interface PurchaseForecastUpdate {
  period_year?: number;
  period_month?: number;
  lini?: PurchaseForecastLini | null;
  forecast_value?: number;
  forecast_qty?: number | null;
  notes?: string | null;
}

export async function updatePurchaseForecast(id: string, f: PurchaseForecastUpdate): Promise<PurchaseForecastRow | null> {
  const sql = db();
  const [existing] = await sql`SELECT period_year, period_month, forecast_value FROM purchase_forecast WHERE id = ${id}`;
  if (!existing) return null;
  validateInput({
    period_year: f.period_year ?? Number(existing.period_year),
    period_month: f.period_month ?? Number(existing.period_month),
    forecast_value: f.forecast_value ?? Number(existing.forecast_value),
  });
  const lini = f.lini !== undefined ? validateLini(f.lini) : undefined;
  try {
    const rows = await sql`
      UPDATE purchase_forecast SET
        period_year    = COALESCE(${f.period_year ?? null}, period_year),
        period_month   = COALESCE(${f.period_month ?? null}, period_month),
        lini           = ${lini !== undefined ? lini : sql`lini`},
        forecast_value = COALESCE(${f.forecast_value ?? null}, forecast_value),
        forecast_qty   = ${f.forecast_qty !== undefined ? f.forecast_qty : sql`forecast_qty`},
        notes          = ${f.notes !== undefined ? f.notes : sql`notes`},
        updated_at     = now()
      WHERE id = ${id}
      RETURNING id
    `;
    if (!rows.length) return null;
    const [row] = await sql`SELECT ${forecastCols(sql)} FROM purchase_forecast f ${ACTUAL_LATERAL_JOIN(sql)} WHERE f.id = ${id}`;
    return mapRow(row);
  } catch (e) {
    if (isUniqueViolation(e)) {
      throw new PurchaseForecastError(409, "Forecast utk periode+lini ini sudah ada — edit baris yang ada, jangan duplikat");
    }
    throw e;
  }
}

export async function deletePurchaseForecast(id: string): Promise<{ deleted: number }> {
  const sql = db();
  const rows = await sql`DELETE FROM purchase_forecast WHERE id = ${id} RETURNING id`;
  return { deleted: rows.length };
}
