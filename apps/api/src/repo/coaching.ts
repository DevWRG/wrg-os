import { db } from "../db.js";

// D1 — coaching per Account Manager (A11). Metrik diturunkan dari deal +
// spt_state_log (aktivitas). Satu note per AM per periode (idempoten).

export interface AmMetrics {
  am_id: string;
  deals: number;
  open: number;
  won: number;
  lost: number;
  total_value: number;
  open_value: number;
  win_rate: number | null;
  activity: number;
}

// AM (dari deal) yang BELUM punya coaching_note untuk periode ini, + metriknya.
export async function getAmsNeedingCoaching(period: string): Promise<AmMetrics[]> {
  const sql = db();
  const rows = await sql`
    SELECT d.am_id,
           count(*)::int AS deals,
           count(*) FILTER (WHERE stage NOT IN ('Deal','MOU','Lose'))::int AS open,
           count(*) FILTER (WHERE stage IN ('Deal','MOU'))::int AS won,
           count(*) FILTER (WHERE stage = 'Lose')::int AS lost,
           coalesce(sum(estimated_value), 0) AS total_value,
           coalesce(sum(estimated_value) FILTER (WHERE stage NOT IN ('Deal','MOU','Lose')), 0) AS open_value,
           (SELECT count(*) FROM spt_state_log s WHERE s.changed_by = d.am_id)::int AS activity
    FROM deal d
    WHERE NOT EXISTS (
      SELECT 1 FROM coaching_note cn WHERE cn.am_id = d.am_id AND cn.period = ${period}
    )
    GROUP BY d.am_id
    ORDER BY d.am_id
  `;
  return rows.map((r) => {
    const won = Number(r.won);
    const lost = Number(r.lost);
    const decided = won + lost;
    return {
      am_id: String(r.am_id),
      deals: Number(r.deals),
      open: Number(r.open),
      won,
      lost,
      total_value: Number(r.total_value),
      open_value: Number(r.open_value),
      win_rate: decided > 0 ? Math.round((won / decided) * 100) / 100 : null,
      activity: Number(r.activity),
    };
  });
}

export async function insertCoachingNote(opts: {
  am_id: string;
  period: string;
  metrics: unknown;
  strengths: string[];
  gaps: string[];
  recommendations: string[];
  score: number;
}): Promise<string> {
  const sql = db();
  const j = (v: unknown) => sql.json(v as unknown as Parameters<typeof sql.json>[0]);
  const rows = await sql`
    INSERT INTO coaching_note
      (am_id, period, metrics, strengths, gaps, recommendations, score, generated_by)
    VALUES
      (${opts.am_id}, ${opts.period}, ${j(opts.metrics)}, ${j(opts.strengths)},
       ${j(opts.gaps)}, ${j(opts.recommendations)}, ${opts.score}, 'A11')
    RETURNING id
  `;
  return rows[0].id as string;
}

export interface CoachingNoteRow {
  id: string;
  am_id: string;
  period: string | null;
  metrics: unknown;
  strengths: string[];
  gaps: string[];
  recommendations: string[];
  score: number | null;
  created_at: string;
}

export async function listCoachingNotes(amId?: string, limit = 50): Promise<CoachingNoteRow[]> {
  const sql = db();
  const rows = await sql`
    SELECT id, am_id, period, metrics, strengths, gaps, recommendations, score, created_at::text
    FROM coaching_note
    WHERE ${amId ? sql`am_id = ${amId}` : sql`true`}
    ORDER BY created_at DESC
    LIMIT ${limit}
  `;
  return rows.map((r) => ({
    id: String(r.id),
    am_id: String(r.am_id),
    period: r.period ? String(r.period) : null,
    metrics: r.metrics ?? {},
    strengths: Array.isArray(r.strengths) ? (r.strengths as string[]) : [],
    gaps: Array.isArray(r.gaps) ? (r.gaps as string[]) : [],
    recommendations: Array.isArray(r.recommendations) ? (r.recommendations as string[]) : [],
    score: r.score === null ? null : Number(r.score),
    created_at: String(r.created_at),
  }));
}
