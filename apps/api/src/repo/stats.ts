import { db } from "../db.js";

// KPI dashboard utama dari D1/D6. Agregat deal + HITL + audit + activity.

export interface DashboardStats {
  deals: {
    total: number;
    open: number;
    won: number;
    lost: number;
    total_value: number;
    open_value: number;
  };
  hitl_pending: number;
  activity_total: number;
  audit_events: number;
  by_stage: { stage: string; count: number }[];
}

export async function getDashboardStats(amId?: string): Promise<DashboardStats> {
  const sql = db();
  const filter = amId ? sql`WHERE am_id = ${amId}` : sql``;

  const [agg] = await sql`
    SELECT
      count(*)                                                          AS total,
      count(*) FILTER (WHERE stage NOT IN ('Closing-Won','Closing-Lost'))        AS open,
      count(*) FILTER (WHERE stage IN ('Closing-Won'))                   AS won,
      count(*) FILTER (WHERE stage = 'Closing-Lost')                            AS lost,
      COALESCE(sum(estimated_value), 0)                                 AS total_value,
      COALESCE(sum(estimated_value) FILTER (WHERE stage NOT IN ('Closing-Won','Closing-Lost')), 0) AS open_value
    FROM deal ${filter}
  `;

  const byStage = await sql`
    SELECT stage, count(*) AS count FROM deal ${filter} GROUP BY stage ORDER BY count DESC
  `;

  const [hitl] = await sql`SELECT count(*) AS n FROM hitl_queue WHERE status = 'pending'`;
  const [act] = await sql`SELECT count(*) AS n FROM spt_state_log`;
  const [aud] = await sql`SELECT count(*) AS n FROM audit_log`;

  return {
    deals: {
      total: Number(agg.total),
      open: Number(agg.open),
      won: Number(agg.won),
      lost: Number(agg.lost),
      total_value: Number(agg.total_value),
      open_value: Number(agg.open_value),
    },
    hitl_pending: Number(hitl.n),
    activity_total: Number(act.n),
    audit_events: Number(aud.n),
    by_stage: byStage.map((r) => ({ stage: String(r.stage), count: Number(r.count) })),
  };
}
