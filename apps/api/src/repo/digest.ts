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
