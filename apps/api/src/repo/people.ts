import { db } from "../db.js";

// D6 — People Analytics (A12). Rollup tingkat-organisasi dari coaching_note
// (A11): ambil note TERBARU per AM, lalu agregasi skor & gap se-tim. Pure &
// deterministik — dipakai run (ter-audit) dan endpoint GET (live, tanpa audit).

const ATTENTION_SCORE = Number(process.env.A12_ATTENTION_SCORE ?? 30);

export interface LatestNote {
  am_id: string;
  period: string | null;
  score: number | null;
  gaps: string[];
}

// Note coaching terbaru per AM (DISTINCT ON am_id, created_at desc).
export async function getLatestCoachingNotes(): Promise<LatestNote[]> {
  const sql = db();
  const rows = await sql`
    SELECT DISTINCT ON (am_id) am_id, period, score, gaps
    FROM coaching_note
    ORDER BY am_id, created_at DESC
  `;
  return rows.map((r) => ({
    am_id: String(r.am_id),
    period: r.period ? String(r.period) : null,
    score: r.score === null ? null : Number(r.score),
    gaps: Array.isArray(r.gaps) ? (r.gaps as string[]) : [],
  }));
}

export interface PeopleAnalytics {
  summary: {
    team_size: number;
    avg_score: number | null;
    min_score: number | null;
    max_score: number | null;
    distribution: { high: number; mid: number; low: number };
  };
  top_performers: { am_id: string; score: number }[];
  needs_attention: { am_id: string; score: number; gaps: string[] }[];
  common_gaps: { gap: string; count: number }[];
}

export function computePeopleAnalytics(notes: LatestNote[]): PeopleAnalytics {
  const scored = notes.filter((n) => n.score !== null) as (LatestNote & { score: number })[];
  const scores = scored.map((n) => n.score);

  const distribution = { high: 0, mid: 0, low: 0 };
  for (const s of scores) {
    if (s >= 60) distribution.high += 1;
    else if (s >= ATTENTION_SCORE) distribution.mid += 1;
    else distribution.low += 1;
  }

  const ranked = [...scored].sort((a, b) => b.score - a.score);
  const top_performers = ranked.slice(0, 5).map((n) => ({ am_id: n.am_id, score: n.score }));
  const needs_attention = ranked
    .filter((n) => n.score < ATTENTION_SCORE)
    .sort((a, b) => a.score - b.score)
    .map((n) => ({ am_id: n.am_id, score: n.score, gaps: n.gaps }));

  const gapCount = new Map<string, number>();
  for (const n of notes) for (const g of n.gaps) gapCount.set(g, (gapCount.get(g) ?? 0) + 1);
  const common_gaps = [...gapCount.entries()]
    .map(([gap, count]) => ({ gap, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  return {
    summary: {
      team_size: notes.length,
      avg_score: scores.length ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 100) / 100 : null,
      min_score: scores.length ? Math.min(...scores) : null,
      max_score: scores.length ? Math.max(...scores) : null,
      distribution,
    },
    top_performers,
    needs_attention,
    common_gaps,
  };
}
