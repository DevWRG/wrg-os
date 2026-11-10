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

// F9 Duplicate Customer Name Alert — dipicu sinkron dari createDeal() (deal.ts),
// BUKAN dari agent/cron. agent_id sengaja NULL (sama pola report_ambiguous_match).
export interface DupNameCandidate {
  kind: "deal" | "accurate_customer";
  ref_id: string;
  customer_name: string;
  am_id: string | null;
  cabang: string | null;
  score: number;
  exact: boolean;
}

export async function enqueueDuplicateCustomerName(opts: {
  dealId: string;
  customerName: string;
  amId: string | null;
  cabang: string | null;
  candidates: DupNameCandidate[];
}): Promise<string | null> {
  const sql = db();
  const corr = `f9-${opts.dealId}`;
  // Anti-spam: 1 dealId cuma boleh punya 1 flag pending (dealId baru = UUID
  // fresh, jadi ini murni pertahanan kalau fungsi ini dipanggil ulang nanti).
  const existing = await sql`SELECT 1 FROM hitl_queue WHERE correlation_id = ${corr} AND status = 'pending' LIMIT 1`;
  if (existing.length > 0) return null;
  const payload = {
    type: "duplicate_customer_name_flag",
    deal_id: opts.dealId,
    customer_name: opts.customerName,
    am_id: opts.amId,
    cabang: opts.cabang,
    candidates: opts.candidates,
  };
  const rows = await sql`
    INSERT INTO hitl_queue (correlation_id, r_tier, hitl_level, payload)
    VALUES (${corr}, 'R1', 'L2', ${sql.json(payload as unknown as Parameters<typeof sql.json>[0])})
    RETURNING id
  `;
  return rows[0].id as string;
}

export async function listHitl(status = "pending") {
  const sql = db();
  return sql`
    SELECT h.id, h.correlation_id, h.agent_id, h.r_tier, h.hitl_level, h.status, h.payload,
           h.created_at, mu.am_name
    FROM hitl_queue h
    -- am_id prod berupa angka ("10") — sertakan nama dari master_user untuk kartu.
    LEFT JOIN LATERAL (
      SELECT COALESCE(NULLIF(nama, ''), NULLIF(panggilan, '')) AS am_name
      FROM master_user WHERE am_id = h.payload->>'am_id' LIMIT 1
    ) mu ON true
    WHERE h.status = ${status} ORDER BY h.created_at
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

/** Kandidat yang dipilih untuk ditautkan (F9). */
export interface ChosenRef { kind: "deal" | "accurate_customer"; ref_id: string }

/**
 * Murni (dites): kandidat yang dipilih HARUS salah satu kandidat di payload item itu —
 * tombol Tautkan tak boleh dipakai untuk mengganti nama ke customer sembarang.
 */
export function pilihKandidatDup(candidates: DupNameCandidate[] | undefined, ref: ChosenRef | undefined): DupNameCandidate | null {
  if (!ref || (ref.kind !== "deal" && ref.kind !== "accurate_customer") || !ref.ref_id) return null;
  return (candidates ?? []).find((c) => c.kind === ref.kind && String(c.ref_id) === String(ref.ref_id)) ?? null;
}

/**
 * F9 "Tautkan": samakan nama customer deal dengan kandidat (nama resmi Accurate atau nama di
 * deal lain) dan tautkan akun faskesnya, lalu catat di riwayat deal & tutup item HITL.
 * Menggabungkan dua deal sengaja TIDAK dilakukan. UPDATE langsung (bukan updateDeal) supaya
 * tak memicu cek duplikat ulang atas nama yang justru baru dipilih manusia.
 */
async function tautkanDuplikat(
  itemId: string,
  p: { deal_id: string; customer_name: string; candidates: DupNameCandidate[] },
  ref: ChosenRef,
  approver: string | null,
): Promise<ResolveResult> {
  const cand = pilihKandidatDup(p.candidates, ref);
  if (!cand) return { ok: false, error: "kandidat tidak ada di item ini" };
  const sql = db();
  return sql.begin(async (tx) => {
    const [d] = await tx`SELECT deal_id, customer_name, stage, account_id FROM deal WHERE deal_id = ${p.deal_id} FOR UPDATE`;
    if (!d) return { ok: false, error: "deal tidak ditemukan (mungkin sudah dihapus)" };
    let nama: string; let akun: string | null;
    if (cand.kind === "accurate_customer") {
      const [a] = await tx`SELECT id, name FROM accurate_customer WHERE id = ${cand.ref_id}`;
      if (!a) return { ok: false, error: "customer Accurate tidak ditemukan" };
      nama = String(a.name); akun = String(a.id);
    } else {
      const [o] = await tx`SELECT customer_name, account_id FROM deal WHERE deal_id = ${cand.ref_id}`;
      if (!o) return { ok: false, error: "deal pembanding tidak ditemukan" };
      nama = String(o.customer_name); akun = o.account_id == null ? null : String(o.account_id);
    }
    await tx`
      UPDATE deal SET customer_name = ${nama},
        account_id = COALESCE(${akun}::bigint, account_id), updated_at = now()
      WHERE deal_id = ${p.deal_id}`;
    await tx`
      INSERT INTO spt_state_log (deal_id, from_stage, to_stage, changed_by, reason)
      VALUES (${p.deal_id}, ${d.stage}, ${d.stage}, ${approver},
        ${`F9 nama customer ditautkan: "${String(d.customer_name)}" → "${nama}" (${cand.kind === "accurate_customer" ? "customer Accurate" : "deal lain"})`})`;
    await tx`UPDATE hitl_queue SET status='approved', approver_id=${approver}, decided_at=now() WHERE id=${itemId}`;
    return { ok: true, status: "approved", deal_id: p.deal_id };
  });
}

export async function resolveHitl(
  id: string,
  opts: { decision: "approve" | "reject"; chosen_deal_id?: string; approver_id?: string; chosen_ref?: ChosenRef },
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

  // F9: approve + kandidat terpilih = Tautkan (samakan nama + akun). Tanpa kandidat = "bukan duplikat".
  if (payloadType === "duplicate_customer_name_flag" && opts.chosen_ref) {
    const p = rows[0].payload as { deal_id: string; customer_name: string; candidates: DupNameCandidate[] };
    return tautkanDuplikat(id, p, opts.chosen_ref, opts.approver_id ?? null);
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
