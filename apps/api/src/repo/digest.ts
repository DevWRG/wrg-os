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
  const rekaps = await sql`
    SELECT id, group_jid, group_name, period_start::text, period_end::text,
           model_used, raw_output, created_at::text
    FROM digest_rekap ORDER BY created_at DESC LIMIT ${limit}
  `;
  const resumes = await sql`
    SELECT id, period_date::text, period_type, model_used, raw_output, created_at::text
    FROM digest_resume ORDER BY created_at DESC LIMIT ${limit}
  `;
  return {
    rekaps: rekaps.map((r) => ({
      id: String(r.id),
      group_jid: String(r.group_jid),
      group_name: r.group_name ? String(r.group_name) : null,
      period_start: String(r.period_start),
      period_end: String(r.period_end),
      model_used: r.model_used ? String(r.model_used) : null,
      raw_output: String(r.raw_output ?? ""),
      created_at: String(r.created_at),
    })),
    resumes: resumes.map((r) => ({
      id: String(r.id),
      period_date: String(r.period_date),
      period_type: String(r.period_type),
      model_used: r.model_used ? String(r.model_used) : null,
      raw_output: String(r.raw_output ?? ""),
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
