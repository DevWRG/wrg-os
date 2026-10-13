// F131 — AR & kecepatan pembayaran per faskes (permintaan user 13 Okt 2026:
// "tambahin AR & kecepatan pembayarannya" di timeline Accounts 360).
//
// Tanggal BAYAR = raw->>'lastPaymentDateView' dari Accurate ("09 Oct 2026") —
// tanggal pelunasan sebenarnya. lunas_at (migrasi 094) hanya cadangan: itu
// tanggal sync MELIHAT faktur jadi PAID, rata-rata ~5 hari setelah bayar
// sungguhan (cek prod 13 Okt: 7.450 dari 7.799 faktur lunas 18 bln punya
// lastPaymentDateView; median 42 hari, 74% dibayar lewat jatuh tempo).
// Catatan: untuk faktur yang dicicil, ini tanggal cicilan TERAKHIR.
//
// Jatuh tempo = raw->>'dueDate' (dd/MM/yyyy) — SENGAJA bukan ar_aging_mv.due_date
// (lihat faktur.ts). Toleran ISO & dd-MM-yyyy, selaras normalizeAccurateDate.
// Fragmen di bawah mengharapkan alias tabel `ai` = accurate_invoice.

import { db } from "../db.js";

type Sql = ReturnType<typeof db>;

export const tglBayarSql = (sql: Sql) => sql`(CASE
  WHEN ai.raw->>'lastPaymentDateView' ~ '^[0-9]{2} [A-Za-z]{3} [0-9]{4}$' THEN to_date(ai.raw->>'lastPaymentDateView', 'DD Mon YYYY')
  ELSE ai.lunas_at END)`;

export const jatuhTempoSql = (sql: Sql) => sql`(CASE
  WHEN ai.raw->>'dueDate' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' THEN substr(ai.raw->>'dueDate', 1, 10)::date
  WHEN ai.raw->>'dueDate' ~ '^[0-9]{2}[/-][0-9]{2}[/-][0-9]{4}' THEN to_date(replace(substr(ai.raw->>'dueDate', 1, 10), '-', '/'), 'DD/MM/YYYY')
  END)`;

export interface StatBayar {
  faktur: number;           // faktur lunas dalam jendela (menurut tanggal bayar)
  median_hari: number | null;
  rata_hari: number | null;
  tepat_pct: number | null; // % dibayar ≤ jatuh tempo (dari faktur yang jatuh temponya diketahui)
  rata_telat_hari: number | null; // rata-rata keterlambatan, hanya faktur yang telat
}

export interface RingkasPembayaran {
  piutang: { sisa: number; faktur_terbuka: number; lewat_tempo: { faktur: number; nilai: number; terlama_hari: number } };
  bayar_12bln: StatBayar;
  bayar_sebelumnya: StatBayar; // 12 bln sebelumnya — pembanding tren
}

/** Murni: label tren kecepatan bayar (median hari) dibanding periode sebelumnya. */
export function trenBayar(kini: StatBayar, dulu: StatBayar): "lebih cepat" | "lebih lambat" | "stabil" | null {
  if (kini.median_hari == null || dulu.median_hari == null || kini.faktur < 3 || dulu.faktur < 3) return null;
  const d = kini.median_hari - dulu.median_hari;
  if (Math.abs(d) < 7) return "stabil";
  return d < 0 ? "lebih cepat" : "lebih lambat";
}

const statDari = (r: Record<string, unknown> | undefined): StatBayar => ({
  faktur: Number(r?.faktur) || 0,
  median_hari: r?.median == null ? null : Math.round(Number(r.median)),
  rata_hari: r?.rata == null ? null : Math.round(Number(r.rata)),
  tepat_pct: r?.ada_due && Number(r.ada_due) > 0 ? Math.round((Number(r.tepat) / Number(r.ada_due)) * 100) : null,
  rata_telat_hari: r?.rata_telat == null ? null : Math.round(Number(r.rata_telat)),
});

export async function ringkasPembayaran(ids: number[]): Promise<RingkasPembayaran> {
  const sql = db();
  const [[ar], stat] = await Promise.all([
    sql`
      SELECT COALESCE(sum(ai.outstanding), 0)::float8 AS sisa, count(*)::int AS terbuka,
             count(*) FILTER (WHERE ${jatuhTempoSql(sql)} < current_date)::int AS lewat,
             COALESCE(sum(ai.outstanding) FILTER (WHERE ${jatuhTempoSql(sql)} < current_date), 0)::float8 AS lewat_nilai,
             COALESCE(max(current_date - ${jatuhTempoSql(sql)}) FILTER (WHERE ${jatuhTempoSql(sql)} < current_date), 0)::int AS terlama
      FROM accurate_invoice ai
      WHERE ai.customer_id = ANY(${ids}::bigint[]) AND ai.outstanding > 0`,
    sql`
      WITH f AS (
        SELECT ai.tanggal, ${tglBayarSql(sql)} AS bayar, ${jatuhTempoSql(sql)} AS due
        FROM accurate_invoice ai
        WHERE ai.customer_id = ANY(${ids}::bigint[]) AND ai.status = 'PAID'
      )
      SELECT CASE WHEN bayar > current_date - 365 THEN 'kini' ELSE 'dulu' END AS jendela,
             count(*)::int AS faktur,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY bayar - tanggal) AS median,
             avg(bayar - tanggal) AS rata,
             count(*) FILTER (WHERE due IS NOT NULL)::int AS ada_due,
             count(*) FILTER (WHERE due IS NOT NULL AND bayar <= due)::int AS tepat,
             avg(bayar - due) FILTER (WHERE bayar > due) AS rata_telat
      FROM f
      WHERE bayar IS NOT NULL AND bayar >= tanggal AND bayar > current_date - 730
      GROUP BY 1`,
  ]);
  const by = new Map(stat.map((r) => [String(r.jendela), r as Record<string, unknown>]));
  return {
    piutang: {
      sisa: Number(ar?.sisa) || 0, faktur_terbuka: Number(ar?.terbuka) || 0,
      lewat_tempo: { faktur: Number(ar?.lewat) || 0, nilai: Number(ar?.lewat_nilai) || 0, terlama_hari: Number(ar?.terlama) || 0 },
    },
    bayar_12bln: statDari(by.get("kini")),
    bayar_sebelumnya: statDari(by.get("dulu")),
  };
}
