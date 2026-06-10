import { db } from "../db.js";
import { recordReportTouch } from "./deal.js";
import type { ReportItem } from "../parsers/report.js";

// HITL gate (D6): match #REPORT yang ambiguous (0.40–0.69) tidak auto-transisi —
// masuk hitl_queue (pending) untuk dipilih manusia, lalu di-resolve.

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "x";
}

export interface AmbiguousCandidate {
  deal_id: string;
  customer_name: string;
  score: number;
}

export async function enqueueAmbiguous(opts: {
  amId: string;
  item: ReportItem;
  candidates: AmbiguousCandidate[];
  toStage?: string;
  correlationId?: string;
  rTier?: string;
  hitlLevel?: string;
}): Promise<string> {
  const sql = db();
  const corr = opts.correlationId ?? `report-${opts.amId}-${slug(opts.item.customer)}`;
  const payload = {
    type: "report_ambiguous_match",
    am_id: opts.amId,
    item: opts.item,
    candidates: opts.candidates,
    to_stage: opts.toStage ?? null,
  };
  const rows = await sql`
    INSERT INTO hitl_queue (correlation_id, r_tier, hitl_level, payload)
    VALUES (${corr}, ${opts.rTier ?? "R1"}, ${opts.hitlLevel ?? "L2"}, ${sql.json(payload as unknown as Parameters<typeof sql.json>[0])})
    RETURNING id
  `;
  return rows[0].id as string;
}

export async function listHitl(status = "pending") {
  const sql = db();
  return sql`
    SELECT id, correlation_id, agent_id, r_tier, hitl_level, status, payload, created_at
    FROM hitl_queue WHERE status = ${status} ORDER BY created_at
  `;
}

export interface ResolveResult {
  ok: boolean;
  error?: string;
  status?: string;
  deal_id?: string;
  state_log_id?: string;
  stage?: string;
}

export async function resolveHitl(
  id: string,
  opts: { decision: "approve" | "reject"; chosen_deal_id?: string; approver_id?: string },
): Promise<ResolveResult> {
  const sql = db();
  const rows = await sql`SELECT id, status, payload FROM hitl_queue WHERE id = ${id}`;
  if (rows.length === 0) return { ok: false, error: "hitl item tidak ditemukan" };
  if (rows[0].status !== "pending") return { ok: false, error: `item sudah ${rows[0].status}` };

  const payloadType = (rows[0].payload as { type?: string }).type;

  if (opts.decision === "reject") {
    await sql`UPDATE hitl_queue SET status='rejected', approver_id=${opts.approver_id ?? null}, decided_at=now() WHERE id=${id}`;
    return { ok: true, status: "rejected" };
  }

  // Item generik (mis. A4 pipeline_authenticity_flag): approve = "diakui /
  // ditindaklanjuti" — cukup set status, tanpa transisi #REPORT.
  if (payloadType && payloadType !== "report_ambiguous_match") {
    await sql`UPDATE hitl_queue SET status='approved', approver_id=${opts.approver_id ?? null}, decided_at=now() WHERE id=${id}`;
    return { ok: true, status: "approved" };
  }

  // approve #REPORT ambiguous: butuh chosen_deal_id → terapkan transisi tertunda
  if (!opts.chosen_deal_id) return { ok: false, error: "chosen_deal_id wajib untuk approve" };
  const p = rows[0].payload as {
    am_id: string;
    item: ReportItem;
    to_stage: string | null;
  };
  const applied = await recordReportTouch(
    p.am_id,
    opts.chosen_deal_id,
    p.item.hasil,
    p.item.next_action,
    p.to_stage ?? undefined,
  );
  await sql`UPDATE hitl_queue SET status='approved', approver_id=${opts.approver_id ?? null}, decided_at=now() WHERE id=${id}`;
  return {
    ok: true,
    status: "approved",
    deal_id: opts.chosen_deal_id,
    state_log_id: applied.state_log_id,
    stage: applied.stage,
  };
}
