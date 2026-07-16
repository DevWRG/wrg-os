import { db } from "../db.js";

// Persist artefak digest monitor (rekap/resume) dari services/ai ke D1b.
// raw_output = teks LLM; kolom terstruktur (bullets/sections JSONB) pakai default
// schema (output ai berupa teks, belum di-parse ke struktur).

export async function insertRekap(opts: {
  group_jid: string;
  group_name?: string | null;
  period_start: string; // ISO
  period_end: string; // ISO
  raw_output: string;
  model_used?: string | null;
}): Promise<string> {
  const sql = db();
  const rows = await sql`
    INSERT INTO digest_rekap (group_jid, group_name, period_start, period_end, raw_output, model_used)
    VALUES (${opts.group_jid}, ${opts.group_name ?? null}, ${opts.period_start},
            ${opts.period_end}, ${opts.raw_output}, ${opts.model_used ?? null})
    RETURNING id
  `;
  return rows[0].id as string;
}

export interface RekapHistory {
  id: string;
  group_jid: string;
  group_name: string | null;
  period_start: string;
  period_end: string;
  model_used: string | null;
  raw_output: string;
  created_at: string;
}

export interface ResumeHistory {
  id: string;
  period_date: string;
  period_type: string;
  model_used: string | null;
  raw_output: string;
  created_at: string;
}

export async function getDigestHistory(
  limit = 20,
): Promise<{ rekaps: RekapHistory[]; resumes: ResumeHistory[] }> {
  const sql = db();
  // Sumber: monitor_digest (port wrg-monitor) — rekap kolektif & resume eksekutif.
  const rekaps = await sql`
    SELECT id::text AS id, tanggal::text, waktu, content, source_file, created_at::text
    FROM monitor_digest WHERE kind = 'rekap'
    ORDER BY tanggal DESC, waktu DESC NULLS LAST LIMIT ${limit}
  `;
  const resumes = await sql`
    SELECT id::text AS id, tanggal::text, waktu, content, source_file, created_at::text
    FROM monitor_digest WHERE kind = 'resume'
    ORDER BY tanggal DESC, waktu DESC NULLS LAST LIMIT ${limit}
  `;
  const model = (sf: unknown) => (sf === "generated" ? "generated (wrg-os)" : null);
  return {
    rekaps: rekaps.map((r) => ({
      id: String(r.id),
      group_jid: "—",
      group_name: `Rekap${r.waktu ? ` ${String(r.waktu)} WIB` : ""} · ${String(r.tanggal)}`,
      period_start: String(r.tanggal),
      period_end: String(r.tanggal),
      model_used: model(r.source_file),
      raw_output: String(r.content ?? ""),
      created_at: String(r.created_at),
    })),
    resumes: resumes.map((r) => ({
      id: String(r.id),
      period_date: String(r.tanggal),
      period_type: r.waktu ? `${String(r.waktu)} WIB` : "—",
      model_used: model(r.source_file),
      raw_output: String(r.content ?? ""),
      created_at: String(r.created_at),
    })),
  };
}

// ── Infografis Digest History ──
// Metadata: agregat dari monitor_digest (semua kind: rekap/resume/daily/weekly/briefing).
// Metrik konten: DIHITUNG ULANG retroaktif dari sumber asli (activity_log + sales_todo
// AM/TODO-mode + sales_plan) per hari — bukan parsing teks LLM (rapuh). Selaras logika
// runDailySummary (dailysummary.ts) tapi per-rentang tanggal.
export async function getDigestInsights(days = 30): Promise<{
  meta: {
    days: number;
    total: number;
    lastAt: string | null;
    byKind: { kind: string; count: number }[];
    timeline: Array<Record<string, number | string>>;
    byHour: { hour: string; count: number }[];
  };
  ops: {
    days: number;
    wajibTotal: number;
    daily: Array<{
      tanggal: string;
      anggota_aktif: number;
      anggota_plan: number;
      total_report: number;
      matched: number;
      unmatched: number;
    }>;
  };
}> {
  const sql = db();
  const d = Math.min(Math.max(Number(days) || 30, 1), 180);

  // ── Metadata (monitor_digest) ──
  const [tot] = await sql`SELECT count(*)::int AS n, max(created_at)::text AS last_at FROM monitor_digest`;
  const byKindRows = await sql`
    SELECT kind, count(*)::int AS n FROM monitor_digest
    WHERE tanggal >= CURRENT_DATE - (${d}::int - 1)
    GROUP BY kind ORDER BY n DESC
  `;
  const tlRows = await sql`
    SELECT tanggal::text AS d, kind, count(*)::int AS n FROM monitor_digest
    WHERE tanggal >= CURRENT_DATE - (${d}::int - 1)
    GROUP BY tanggal, kind ORDER BY tanggal
  `;
  const hourRows = await sql`
    SELECT substring(COALESCE(waktu, '??') FROM 1 FOR 2) AS hour, count(*)::int AS n
    FROM monitor_digest
    WHERE tanggal >= CURRENT_DATE - (${d}::int - 1)
    GROUP BY 1 ORDER BY 1
  `;

  // Pivot timeline → satu baris per tanggal, kolom per kind + total.
  const KINDS = ["rekap", "resume", "daily", "weekly", "briefing"];
  const tlMap = new Map<string, Record<string, number | string>>();
  for (const r of tlRows) {
    const day = String(r.d);
    const row = tlMap.get(day) ?? { tanggal: day, total: 0, rekap: 0, resume: 0, daily: 0, weekly: 0, briefing: 0 };
    const k = KINDS.includes(String(r.kind)) ? String(r.kind) : "rekap";
    row[k] = (Number(row[k]) || 0) + Number(r.n);
    row.total = (Number(row.total) || 0) + Number(r.n);
    tlMap.set(day, row);
  }
  const timeline = [...tlMap.values()].sort((a, b) => String(a.tanggal).localeCompare(String(b.tanggal)));

  // ── Metrik konten (recompute retroaktif per hari) ──
  const [wajib] = await sql`
    SELECT count(*)::int AS n FROM master_user mu
    WHERE mu.aktif AND COALESCE(mu.wajib_plan_report, true)
  `;
  const opsRows = await sql`
    WITH days AS (
      SELECT generate_series(CURRENT_DATE - (${d}::int - 1), CURRENT_DATE, INTERVAL '1 day')::date AS d
    ),
    active_am AS (
      SELECT tanggal AS d, am_id FROM activity_log WHERE tanggal >= CURRENT_DATE - (${d}::int - 1)
      UNION
      SELECT tanggal AS d, am_id FROM sales_todo WHERE reported = TRUE AND tanggal >= CURRENT_DATE - (${d}::int - 1)
    ),
    aktif AS (SELECT d, count(DISTINCT am_id)::int AS aktif FROM active_am GROUP BY d),
    rc AS (
      SELECT d, sum(reports)::int AS total_report, sum(matched)::int AS matched FROM (
        SELECT tanggal AS d, count(*) AS reports,
               count(*) FILTER (WHERE NOT COALESCE(is_unmatched, false)) AS matched
        FROM activity_log WHERE tanggal >= CURRENT_DATE - (${d}::int - 1) GROUP BY tanggal
        UNION ALL
        SELECT st.tanggal AS d, count(*) AS reports,
               count(*) FILTER (WHERE COALESCE(item->>'status', 'matched') <> 'unmatched') AS matched
        FROM sales_todo st CROSS JOIN LATERAL jsonb_array_elements(COALESCE(st.report_data, '[]'::jsonb)) AS item
        WHERE st.reported = TRUE AND st.tanggal >= CURRENT_DATE - (${d}::int - 1) GROUP BY st.tanggal
      ) x GROUP BY d
    ),
    pl AS (
      SELECT tanggal AS d, count(DISTINCT am_id)::int AS anggota_plan
      FROM sales_plan WHERE tanggal >= CURRENT_DATE - (${d}::int - 1) GROUP BY tanggal
    )
    SELECT days.d::text AS tanggal,
      COALESCE(aktif.aktif, 0)::int AS anggota_aktif,
      COALESCE(pl.anggota_plan, 0)::int AS anggota_plan,
      COALESCE(rc.total_report, 0)::int AS total_report,
      COALESCE(rc.matched, 0)::int AS matched
    FROM days
    LEFT JOIN aktif ON aktif.d = days.d
    LEFT JOIN rc ON rc.d = days.d
    LEFT JOIN pl ON pl.d = days.d
    ORDER BY days.d
  `;

  return {
    meta: {
      days: d,
      total: Number(tot?.n ?? 0),
      lastAt: tot?.last_at ? String(tot.last_at) : null,
      byKind: byKindRows.map((r) => ({ kind: String(r.kind), count: Number(r.n) })),
      timeline,
      byHour: hourRows.map((r) => ({ hour: String(r.hour), count: Number(r.n) })),
    },
    ops: {
      days: d,
      wajibTotal: Number(wajib?.n ?? 0),
      daily: opsRows.map((r) => {
        const total_report = Number(r.total_report);
        const matched = Number(r.matched);
        return {
          tanggal: String(r.tanggal),
          anggota_aktif: Number(r.anggota_aktif),
          anggota_plan: Number(r.anggota_plan),
          total_report,
          matched,
          unmatched: Math.max(0, total_report - matched),
        };
      }),
    },
  };
}

export async function insertResume(opts: {
  period_date: string; // YYYY-MM-DD
  period_type: string; // morning | evening
  raw_output: string;
  model_used?: string | null;
}): Promise<string> {
  const sql = db();
  const rows = await sql`
    INSERT INTO digest_resume (period_date, period_type, raw_output, model_used)
    VALUES (${opts.period_date}, ${opts.period_type}, ${opts.raw_output}, ${opts.model_used ?? null})
    RETURNING id
  `;
  return rows[0].id as string;
}
