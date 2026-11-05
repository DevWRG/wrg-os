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
           count(*) FILTER (WHERE stage NOT IN ('Closing-Won','Closing-Lost'))::int AS open,
           count(*) FILTER (WHERE stage IN ('Closing-Won'))::int AS won,
           count(*) FILTER (WHERE stage = 'Closing-Lost')::int AS lost,
           coalesce(sum(estimated_value), 0) AS total_value,
           coalesce(sum(estimated_value) FILTER (WHERE stage NOT IN ('Closing-Won','Closing-Lost')), 0) AS open_value,
           (SELECT count(*) FROM spt_state_log s WHERE s.changed_by = d.am_id)::int AS activity
    FROM deal d
    -- Deal tanpa AM (VACANT) bukan orang yang bisa di-coaching; tanpa saringan
    -- ini String(null) tersimpan sebagai am_id "null" dan tiap run menambah lagi.
    WHERE d.am_id IS NOT NULL AND btrim(d.am_id) <> ''
      AND NOT EXISTS (
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
  // Nama dari master_user (am_id prod berupa angka "10", tak terbaca manusia).
  am_name: string | null;
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
    SELECT cn.id, cn.am_id, mu.am_name, cn.period, cn.metrics, cn.strengths, cn.gaps,
           cn.recommendations, cn.score, cn.created_at::text
    FROM coaching_note cn
    LEFT JOIN LATERAL (
      SELECT COALESCE(NULLIF(nama, ''), NULLIF(panggilan, '')) AS am_name
      FROM master_user WHERE am_id = cn.am_id LIMIT 1
    ) mu ON true
    WHERE ${amId ? sql`cn.am_id = ${amId}` : sql`true`}
    ORDER BY cn.created_at DESC
    LIMIT ${limit}
  `;
  return rows.map((r) => ({
    id: String(r.id),
    am_id: String(r.am_id),
    am_name: r.am_name ? String(r.am_name) : null,
    period: r.period ? String(r.period) : null,
    metrics: r.metrics ?? {},
    strengths: Array.isArray(r.strengths) ? (r.strengths as string[]) : [],
    gaps: Array.isArray(r.gaps) ? (r.gaps as string[]) : [],
    recommendations: Array.isArray(r.recommendations) ? (r.recommendations as string[]) : [],
    score: r.score === null ? null : Number(r.score),
    created_at: String(r.created_at),
  }));
}
