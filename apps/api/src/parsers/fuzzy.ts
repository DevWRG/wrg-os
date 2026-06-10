// Fuzzy match #REPORT → sales_plan. Mendekati pg_trgm (trigram similarity) yang
// dipakai legacy di SQL; thresholds identik (≥0.70 auto, 0.40–0.69 ambiguous, <0.40 unmatched).
// CATATAN: ini aproksimasi in-code. Path produksi tetap pakai pg_trgm di PostgreSQL
// saat DB tersambung — skor bisa beda tipis, tapi semantik threshold sama.

const REPORT_AUTO_MATCH = 0.7;
const REPORT_AMBIGUOUS = 0.4;

function trigrams(s: string): Set<string> {
  const t = `  ${s.toLowerCase().trim().replace(/\s+/g, " ")} `;
  const out = new Set<string>();
  for (let i = 0; i < t.length - 2; i++) out.add(t.slice(i, i + 3));
  return out;
}

export function similarity(a: string, b: string): number {
  const ta = trigrams(a);
  const tb = trigrams(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const x of ta) if (tb.has(x)) inter++;
  const union = ta.size + tb.size - inter;
  return union === 0 ? 0 : inter / union;
}

export interface PlanCandidate {
  plan_id: string;
  customer_name: string;
}

export type MatchKind = "auto" | "ambiguous" | "unmatched";

export interface MatchResult {
  kind: MatchKind;
  plan_id: string | null;
  score: number;
  candidates: { plan_id: string; customer_name: string; score: number }[];
}

/** Klasifikasi satu input customer vs daftar plan kandidat (sales_plan hari itu). */
export function matchCustomer(
  input: string,
  plans: PlanCandidate[],
): MatchResult {
  const scored = plans
    .map((p) => ({ ...p, score: similarity(p.customer_name, input) }))
    .filter((p) => p.score > 0.25) // selaras filter awal legacy (similarity > 0.25)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  const top = scored[0];
  if (!top || top.score < REPORT_AMBIGUOUS) {
    return { kind: "unmatched", plan_id: null, score: top?.score ?? 0, candidates: scored };
  }
  if (top.score >= REPORT_AUTO_MATCH) {
    return { kind: "auto", plan_id: top.plan_id, score: top.score, candidates: scored };
  }
  return { kind: "ambiguous", plan_id: null, score: top.score, candidates: scored };
}
