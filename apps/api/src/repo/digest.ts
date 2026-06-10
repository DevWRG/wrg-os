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
