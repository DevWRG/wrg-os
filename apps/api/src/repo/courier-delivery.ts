import { db } from "../db.js";

// F43 Kurir/Ekspedisi Performance Dashboard (Shipping) — modul standalone,
// TIDAK terhubung ke shipment_tracking/pickup_plan (branch F12/F42/F45/F93
// belum merge ke dev). Satu tabel flat `courier_delivery` (pola sama F39
// supplier-eta): tiap baris = satu kejadian pengiriman berdiri sendiri.
// kurir_name/kurir_wa_number teks bebas — tidak ada roster master kurir di
// project ini (lihat komentar migrasi 095). is_late/is_overdue dihitung di
// SQL, duration_days di JS (mapRow) — pola computed yang sama dgn "telat" F39.
// date/timestamptz eksplisit ::text di SELECT/RETURNING (gotcha postgres.js
// yang sama di semua repo lain).

export class CourierDeliveryError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "CourierDeliveryError";
  }
}

export type CourierDeliveryStatus = "dalam_perjalanan" | "selesai" | "bermasalah";
const VALID_STATUS: CourierDeliveryStatus[] = ["dalam_perjalanan", "selesai", "bermasalah"];
export const isValidCourierDeliveryStatus = (s: unknown): s is CourierDeliveryStatus =>
  typeof s === "string" && (VALID_STATUS as string[]).includes(s);

export interface CourierDeliveryRow {
  id: string;
  kurir_name: string;
  kurir_wa_number: string | null;
  sj_number: string | null;
  customer_name: string | null;
  cabang: string | null;
  tanggal_kirim: string;
  target_tiba_date: string | null;
  tanggal_tiba: string | null;
  distance_km: number | null;
  status: CourierDeliveryStatus;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  is_late: boolean;
  is_overdue: boolean;
  duration_days: number | null;
}

function diffDays(from: string, to: string): number {
  const a = new Date(`${from}T00:00:00Z`).getTime();
  const b = new Date(`${to}T00:00:00Z`).getTime();
  return Math.round((b - a) / 86_400_000);
}

function mapRow(r: Record<string, unknown>): CourierDeliveryRow {
  const tanggal_kirim = String(r.tanggal_kirim);
  const tanggal_tiba = r.tanggal_tiba != null ? String(r.tanggal_tiba) : null;
  return {
    id: String(r.id),
    kurir_name: String(r.kurir_name),
    kurir_wa_number: r.kurir_wa_number != null ? String(r.kurir_wa_number) : null,
    sj_number: r.sj_number != null ? String(r.sj_number) : null,
    customer_name: r.customer_name != null ? String(r.customer_name) : null,
    cabang: r.cabang != null ? String(r.cabang) : null,
    tanggal_kirim,
    target_tiba_date: r.target_tiba_date != null ? String(r.target_tiba_date) : null,
    tanggal_tiba,
    distance_km: r.distance_km != null ? Number(r.distance_km) : null,
    status: r.status as CourierDeliveryStatus,
    notes: r.notes != null ? String(r.notes) : null,
    created_by: r.created_by != null ? String(r.created_by) : null,
    created_at: String(r.created_at),
    updated_at: String(r.updated_at),
    is_late: Boolean(r.is_late),
    is_overdue: Boolean(r.is_overdue),
    duration_days: tanggal_tiba ? diffDays(tanggal_kirim, tanggal_tiba) : null,
  };
}

function cols(sql: ReturnType<typeof db>) {
  return sql`
    id, kurir_name, kurir_wa_number, sj_number, customer_name, cabang,
    tanggal_kirim::text, target_tiba_date::text, tanggal_tiba::text,
    distance_km, status, notes, created_by, created_at::text, updated_at::text,
    (status = 'selesai' AND target_tiba_date IS NOT NULL AND tanggal_tiba > target_tiba_date) AS is_late,
    (status = 'dalam_perjalanan' AND target_tiba_date IS NOT NULL AND target_tiba_date < CURRENT_DATE) AS is_overdue
  `;
}

export interface CourierDeliveryInput {
  kurir_name: string;
  kurir_wa_number?: string | null;
  sj_number?: string | null;
  customer_name?: string | null;
  cabang?: string | null;
  tanggal_kirim?: string;
  target_tiba_date?: string | null;
  distance_km?: number | null;
  notes?: string | null;
  created_by?: string | null;
}

export async function createCourierDelivery(t: CourierDeliveryInput): Promise<CourierDeliveryRow> {
  if (!t.kurir_name?.trim()) throw new CourierDeliveryError(400, "kurir_name wajib diisi");
  const sql = db();
  const rows = await sql`
    INSERT INTO courier_delivery (
      kurir_name, kurir_wa_number, sj_number, customer_name, cabang,
      tanggal_kirim, target_tiba_date, distance_km, notes, created_by
    ) VALUES (
      ${t.kurir_name.trim()}, ${t.kurir_wa_number ?? null}, ${t.sj_number ?? null}, ${t.customer_name ?? null}, ${t.cabang ?? null},
      ${t.tanggal_kirim ?? sql`CURRENT_DATE`}, ${t.target_tiba_date ?? null}, ${t.distance_km ?? null}, ${t.notes ?? null}, ${t.created_by ?? null}
    )
    RETURNING id
  `;
  const created = await getCourierDelivery(String(rows[0].id));
  if (!created) throw new Error("gagal membaca courier delivery setelah dibuat");
  return created;
}

export async function listCourierDeliveries(opts?: {
  status?: CourierDeliveryStatus;
  kurirName?: string;
  cabang?: string;
  from?: string;
  to?: string;
  limit?: number;
}): Promise<CourierDeliveryRow[]> {
  const sql = db();
  const rows = await sql`
    SELECT ${cols(sql)}
    FROM courier_delivery
    WHERE ${opts?.status ? sql`status = ${opts.status}` : sql`true`}
      AND ${opts?.kurirName ? sql`kurir_name = ${opts.kurirName}` : sql`true`}
      AND ${opts?.cabang ? sql`cabang = ${opts.cabang}` : sql`true`}
      AND ${opts?.from ? sql`tanggal_kirim >= ${opts.from}::date` : sql`true`}
      AND ${opts?.to ? sql`tanggal_kirim <= ${opts.to}::date` : sql`true`}
    ORDER BY tanggal_kirim DESC, created_at DESC
    LIMIT ${opts?.limit ?? 1000}
  `;
  return rows.map(mapRow);
}

export async function getCourierDelivery(id: string): Promise<CourierDeliveryRow | null> {
  const sql = db();
  const rows = await sql`SELECT ${cols(sql)} FROM courier_delivery WHERE id = ${id}`;
  return rows.length ? mapRow(rows[0]) : null;
}

export interface CourierDeliveryPatch {
  kurir_name?: string;
  kurir_wa_number?: string | null;
  sj_number?: string | null;
  customer_name?: string | null;
  cabang?: string | null;
  tanggal_kirim?: string;
  target_tiba_date?: string | null;
  tanggal_tiba?: string | null;
  distance_km?: number | null;
  status?: CourierDeliveryStatus;
  notes?: string | null;
}

export async function updateCourierDelivery(id: string, patch: CourierDeliveryPatch): Promise<CourierDeliveryRow> {
  if (patch.kurir_name !== undefined && !patch.kurir_name.trim()) {
    throw new CourierDeliveryError(400, "kurir_name tidak boleh kosong");
  }
  if (patch.status !== undefined && !isValidCourierDeliveryStatus(patch.status)) {
    throw new CourierDeliveryError(400, "status tidak valid (dalam_perjalanan/selesai/bermasalah)");
  }
  const existing = await getCourierDelivery(id);
  if (!existing) throw new CourierDeliveryError(404, "pengiriman tidak ditemukan");

  const sql = db();
  const next = {
    kurir_name: patch.kurir_name?.trim() ?? existing.kurir_name,
    kurir_wa_number: patch.kurir_wa_number !== undefined ? patch.kurir_wa_number : existing.kurir_wa_number,
    sj_number: patch.sj_number !== undefined ? patch.sj_number : existing.sj_number,
    customer_name: patch.customer_name !== undefined ? patch.customer_name : existing.customer_name,
    cabang: patch.cabang !== undefined ? patch.cabang : existing.cabang,
    tanggal_kirim: patch.tanggal_kirim ?? existing.tanggal_kirim,
    target_tiba_date: patch.target_tiba_date !== undefined ? patch.target_tiba_date : existing.target_tiba_date,
    // Menandai status "selesai" tanpa tanggal_tiba eksplisit → default hari ini.
    tanggal_tiba:
      patch.tanggal_tiba !== undefined
        ? patch.tanggal_tiba
        : patch.status === "selesai" && !existing.tanggal_tiba
          ? new Date().toISOString().slice(0, 10)
          : existing.tanggal_tiba,
    distance_km: patch.distance_km !== undefined ? patch.distance_km : existing.distance_km,
    status: patch.status ?? existing.status,
    notes: patch.notes !== undefined ? patch.notes : existing.notes,
  };
  if (next.tanggal_tiba && next.tanggal_tiba < next.tanggal_kirim) {
    throw new CourierDeliveryError(400, "tanggal_tiba tidak boleh sebelum tanggal_kirim");
  }

  await sql`
    UPDATE courier_delivery SET
      kurir_name = ${next.kurir_name},
      kurir_wa_number = ${next.kurir_wa_number},
      sj_number = ${next.sj_number},
      customer_name = ${next.customer_name},
      cabang = ${next.cabang},
      tanggal_kirim = ${next.tanggal_kirim},
      target_tiba_date = ${next.target_tiba_date},
      tanggal_tiba = ${next.tanggal_tiba},
      distance_km = ${next.distance_km},
      status = ${next.status},
      notes = ${next.notes},
      updated_at = now()
    WHERE id = ${id}
  `;
  const updated = await getCourierDelivery(id);
  if (!updated) throw new Error("gagal membaca courier delivery setelah update");
  return updated;
}

export async function deleteCourierDelivery(id: string): Promise<{ deleted: number }> {
  const sql = db();
  const rows = await sql`DELETE FROM courier_delivery WHERE id = ${id} RETURNING id`;
  return { deleted: rows.length };
}

export interface CourierPerformanceRow {
  kurir_name: string;
  total: number;
  selesai_count: number;
  dalam_perjalanan_count: number;
  bermasalah_count: number;
  late_count: number;
  on_time_rate_pct: number | null;
  avg_duration_days: number | null;
}

export interface CourierPerformanceSummary {
  from: string | null;
  to: string | null;
  overall: {
    total: number;
    selesai_count: number;
    dalam_perjalanan_count: number;
    bermasalah_count: number;
    late_count: number;
    overdue_count: number;
    on_time_rate_pct: number | null;
    avg_duration_days: number | null;
  };
  by_kurir: CourierPerformanceRow[];
}

const round1 = (n: number): number => Math.round(n * 10) / 10;

// Agregasi GROUP BY kurir_name utk ranking performa + ringkasan keseluruhan.
// on_time_rate dihitung di JS dari selesai_count/late_count (agregat SQL),
// bukan kolom — pola computed yang sama dgn approval_status F138.
export async function getCourierPerformanceSummary(opts?: { from?: string; to?: string }): Promise<CourierPerformanceSummary> {
  const sql = db();
  const rows = await sql`
    SELECT
      kurir_name,
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE status = 'selesai')::int AS selesai_count,
      COUNT(*) FILTER (WHERE status = 'dalam_perjalanan')::int AS dalam_perjalanan_count,
      COUNT(*) FILTER (WHERE status = 'bermasalah')::int AS bermasalah_count,
      COUNT(*) FILTER (WHERE status = 'selesai' AND target_tiba_date IS NOT NULL AND tanggal_tiba > target_tiba_date)::int AS late_count,
      COUNT(*) FILTER (WHERE status = 'dalam_perjalanan' AND target_tiba_date IS NOT NULL AND target_tiba_date < CURRENT_DATE)::int AS overdue_count,
      AVG(tanggal_tiba - tanggal_kirim) FILTER (WHERE status = 'selesai' AND tanggal_tiba IS NOT NULL)::float8 AS avg_duration_days
    FROM courier_delivery
    WHERE ${opts?.from ? sql`tanggal_kirim >= ${opts.from}::date` : sql`true`}
      AND ${opts?.to ? sql`tanggal_kirim <= ${opts.to}::date` : sql`true`}
    GROUP BY kurir_name
    ORDER BY total DESC, kurir_name ASC
  `;

  const byKurir: CourierPerformanceRow[] = rows.map((r) => {
    const selesai = Number(r.selesai_count);
    const late = Number(r.late_count);
    return {
      kurir_name: String(r.kurir_name),
      total: Number(r.total),
      selesai_count: selesai,
      dalam_perjalanan_count: Number(r.dalam_perjalanan_count),
      bermasalah_count: Number(r.bermasalah_count),
      late_count: late,
      on_time_rate_pct: selesai > 0 ? round1(((selesai - late) / selesai) * 100) : null,
      avg_duration_days: r.avg_duration_days != null ? round1(Number(r.avg_duration_days)) : null,
    };
  });

  const overallSelesai = byKurir.reduce((a, r) => a + r.selesai_count, 0);
  const overallLate = byKurir.reduce((a, r) => a + r.late_count, 0);
  const overallOverdue = rows.reduce((a, r) => a + Number(r.overdue_count), 0);
  const durasiRows = byKurir.filter((r) => r.avg_duration_days != null && r.selesai_count > 0);
  const totalSelesaiForAvg = durasiRows.reduce((a, r) => a + r.selesai_count, 0);
  const overallAvgDuration =
    totalSelesaiForAvg > 0
      ? round1(durasiRows.reduce((a, r) => a + (r.avg_duration_days as number) * r.selesai_count, 0) / totalSelesaiForAvg)
      : null;

  return {
    from: opts?.from ?? null,
    to: opts?.to ?? null,
    overall: {
      total: byKurir.reduce((a, r) => a + r.total, 0),
      selesai_count: overallSelesai,
      dalam_perjalanan_count: byKurir.reduce((a, r) => a + r.dalam_perjalanan_count, 0),
      bermasalah_count: byKurir.reduce((a, r) => a + r.bermasalah_count, 0),
      late_count: overallLate,
      overdue_count: overallOverdue,
      on_time_rate_pct: overallSelesai > 0 ? round1(((overallSelesai - overallLate) / overallSelesai) * 100) : null,
      avg_duration_days: overallAvgDuration,
    },
    by_kurir: byKurir,
  };
}
