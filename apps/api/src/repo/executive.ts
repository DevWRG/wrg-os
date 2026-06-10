import { db } from "../db.js";
import { getDashboardStats } from "./stats.js";
import { getAging } from "./ar.js";

// D6 — A10 Executive Synthesis. Mengumpulkan sinyal lintas-domain untuk briefing
// eksekutif dan menyimpan hasilnya ke digest_briefing.

export interface ExecutiveSignals {
  pipeline: Awaited<ReturnType<typeof getDashboardStats>>;
  ar: { buckets: { bucket: string; count: number; total: number }[] };
  sentiment: { positive: number; neutral: number; negative: number };
  hitl_by_agent: Record<string, number>;
  agent_activity: Record<string, number>;
}

export async function gatherExecutiveSignals(): Promise<ExecutiveSignals> {
  const sql = db();
  const pipeline = await getDashboardStats();
  const aging = await getAging();

  const sentRows = await sql`
    SELECT sentiment, count(*)::int AS n
    FROM message_annotation
    WHERE created_at >= now() - interval '7 days'
    GROUP BY sentiment
  `;
  const sentiment = { positive: 0, neutral: 0, negative: 0 };
  for (const r of sentRows) {
    const k = String(r.sentiment) as keyof typeof sentiment;
    if (k in sentiment) sentiment[k] = Number(r.n);
  }

  const hitlRows = await sql`
    SELECT coalesce(agent_id, 'report') AS agent_id, count(*)::int AS n
    FROM hitl_queue WHERE status = 'pending' GROUP BY agent_id
  `;
  const hitl_by_agent: Record<string, number> = {};
  for (const r of hitlRows) hitl_by_agent[String(r.agent_id)] = Number(r.n);

  const actRows = await sql`
    SELECT agent_id, count(*)::int AS n
    FROM audit_log
    WHERE layer = 4 AND agent_id IS NOT NULL AND occurred_at >= now() - interval '24 hours'
    GROUP BY agent_id
  `;
  const agent_activity: Record<string, number> = {};
  for (const r of actRows) agent_activity[String(r.agent_id)] = Number(r.n);

  return {
    pipeline,
    ar: { buckets: aging.buckets },
    sentiment,
    hitl_by_agent,
    agent_activity,
  };
}

export async function insertBriefing(opts: {
  sections: unknown;
  raw_output: string;
  model_used?: string | null;
}): Promise<{ id: string; week_start: string }> {
  const sql = db();
  const rows = await sql`
    INSERT INTO digest_briefing (week_start, sections, raw_output, model_used, hitl_status)
    VALUES (date_trunc('week', now())::date,
            ${sql.json(opts.sections as unknown as Parameters<typeof sql.json>[0])},
            ${opts.raw_output}, ${opts.model_used ?? null}, 'pending')
    RETURNING id, week_start::text
  `;
  return { id: rows[0].id as string, week_start: String(rows[0].week_start) };
}

export interface BriefingRow {
  id: string;
  week_start: string;
  raw_output: string;
  model_used: string | null;
  hitl_status: string;
  created_at: string;
}

export async function listBriefings(limit = 20): Promise<BriefingRow[]> {
  const sql = db();
  const rows = await sql`
    SELECT id, week_start::text, raw_output, model_used, hitl_status, created_at::text
    FROM digest_briefing ORDER BY created_at DESC LIMIT ${limit}
  `;
  return rows.map((r) => ({
    id: String(r.id),
    week_start: String(r.week_start),
    raw_output: String(r.raw_output ?? ""),
    model_used: r.model_used ? String(r.model_used) : null,
    hitl_status: String(r.hitl_status),
    created_at: String(r.created_at),
  }));
}
