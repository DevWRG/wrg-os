import { db } from "../db.js";

// F43 Kurir Performance — BACA-SAJA di atas shipment_tracking (keputusan user
// 13 Okt 2026: data pengiriman hanya dari WA, tanpa input web). Dulu modul ini
// punya tabel & form sendiri (courier_delivery, migrasi 115) yang tak
// tersambung ke WA sama sekali — dibuang.
//
// Kurir = pengirim #KIRIM (kirim_by: nama roster, atau "driver <nama>" lewat
// DM). Tanpa target tiba (Accurate tak punya datanya; keputusan user: cukup
// durasi rata-rata), jadi tak ada label "telat". Durasi dalam JAM:
//   kirim→terima = waktu tempuh kurir (#KIRIM → #TERIMA)
//   kirim→BAST   = sampai serah-terima resmi
// Satu kurir tanpa beda huruf besar/kecil (GROUP BY lower), label = ejaan terbanyak.

export interface KurirPerformaAngka {
  total: number;
  dalam_perjalanan: number;
  diterima: number;
  selesai: number;
  avg_jam_terima: number | null;
  avg_jam_bast: number | null;
  avg_km: number | null;
}

export interface KurirPerformaRow extends KurirPerformaAngka {
  kurir: string;
  terakhir_kirim: string | null;
}

export interface KurirPerformaSummary {
  from: string | null;
  to: string | null;
  overall: KurirPerformaAngka;
  by_kurir: KurirPerformaRow[];
}

const round1 = (n: unknown): number | null => (n == null ? null : Math.round(Number(n) * 10) / 10);

function angka(r: Record<string, unknown>): KurirPerformaAngka {
  return {
    total: Number(r.total ?? 0),
    dalam_perjalanan: Number(r.dalam_perjalanan ?? 0),
    diterima: Number(r.diterima ?? 0),
    selesai: Number(r.selesai ?? 0),
    avg_jam_terima: round1(r.avg_jam_terima),
    avg_jam_bast: round1(r.avg_jam_bast),
    avg_km: round1(r.avg_km),
  };
}

export async function getKurirPerformaSummary(opts?: { from?: string; to?: string }): Promise<KurirPerformaSummary> {
  const sql = db();
  // Periode = tanggal #KIRIM versi WIB.
  const where = sql`
    kirim_at IS NOT NULL AND kirim_by IS NOT NULL
    AND ${opts?.from ? sql`(kirim_at AT TIME ZONE 'Asia/Jakarta')::date >= ${opts.from}::date` : sql`true`}
    AND ${opts?.to ? sql`(kirim_at AT TIME ZONE 'Asia/Jakarta')::date <= ${opts.to}::date` : sql`true`}
  `;
  const agregat = sql`
    COUNT(*)::int AS total,
    COUNT(*) FILTER (WHERE status = 'dikirim')::int AS dalam_perjalanan,
    COUNT(*) FILTER (WHERE terima_at IS NOT NULL)::int AS diterima,
    COUNT(*) FILTER (WHERE status = 'bast')::int AS selesai,
    AVG(EXTRACT(EPOCH FROM (terima_at - kirim_at)) / 3600) FILTER (WHERE terima_at IS NOT NULL)::float8 AS avg_jam_terima,
    AVG(EXTRACT(EPOCH FROM (bast_at - kirim_at)) / 3600) FILTER (WHERE bast_at IS NOT NULL)::float8 AS avg_jam_bast,
    AVG(distance_km) FILTER (WHERE distance_km IS NOT NULL)::float8 AS avg_km
  `;
  const [rows, overall] = await Promise.all([
    sql`
      SELECT mode() WITHIN GROUP (ORDER BY kirim_by) AS kurir, ${agregat}, MAX(kirim_at) AS terakhir_kirim
      FROM shipment_tracking WHERE ${where}
      GROUP BY lower(kirim_by)
      ORDER BY total DESC, 1 ASC
    `,
    sql`SELECT ${agregat} FROM shipment_tracking WHERE ${where}`,
  ]);
  return {
    from: opts?.from ?? null,
    to: opts?.to ?? null,
    overall: angka(overall[0] ?? {}),
    by_kurir: rows.map((r) => ({
      kurir: String(r.kurir),
      ...angka(r),
      terakhir_kirim: r.terakhir_kirim ? new Date(r.terakhir_kirim as string | Date).toISOString() : null,
    })),
  };
}
