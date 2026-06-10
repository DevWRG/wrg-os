import { createHash } from "node:crypto";

import { db } from "../db.js";
import { callAi } from "../ai.js";
import { getWaMessages } from "./wa.js";
import { insertRekap } from "./digest.js";
import {
  getOverdueForDrafting,
  insertCollectionDraft,
  type OverdueItem,
} from "./collection.js";
import {
  getDealsForAudit,
  getDealTransitions,
  enqueuePipelineFlag,
  advIdx,
  WON,
  type TransitionRow,
} from "./pipeline.js";

// A2 — AR Aging Watch (Blueprint v2.3, R1/L2). Baca ar_aging_mv, prioritaskan
// piutang berisiko, log run ke audit_log (Layer 4 Output) + update registry.

const SEVERITY: Record<string, number> = {
  current: 0,
  "1-30": 1,
  "31-60": 2,
  "61-90": 3,
  "90+": 4,
};

export interface ArFinding {
  customer_id: string;
  customer_name: string | null;
  invoice_no: string;
  amount: number;
  days_overdue: number;
  bucket: string;
  severity: number;
  critical: boolean;
}

export async function runArWatch(): Promise<{
  agent_id: string;
  audit_id: string;
  summary: {
    overdue_invoices: number;
    overdue_amount: number;
    critical_count: number;
    by_bucket: Record<string, number>;
  };
  top_findings: ArFinding[];
}> {
  const sql = db();
  const rows = await sql`
    SELECT customer_id, customer_name, invoice_no, amount, days_overdue, bucket, is_anomaly
    FROM ar_aging_mv
    WHERE days_overdue > 0
    ORDER BY days_overdue DESC, amount DESC
  `;

  const findings: ArFinding[] = rows.map((r) => ({
    customer_id: String(r.customer_id),
    customer_name: r.customer_name ? String(r.customer_name) : null,
    invoice_no: String(r.invoice_no),
    amount: Number(r.amount),
    days_overdue: Number(r.days_overdue),
    bucket: String(r.bucket),
    severity: SEVERITY[String(r.bucket)] ?? 0,
    critical: String(r.bucket) === "90+" || Boolean(r.is_anomaly),
  }));

  const byBucket: Record<string, number> = {};
  for (const f of findings) byBucket[f.bucket] = (byBucket[f.bucket] ?? 0) + 1;
  const critical = findings.filter((f) => f.critical);
  const summary = {
    overdue_invoices: findings.length,
    overdue_amount: findings.reduce((a, f) => a + f.amount, 0),
    critical_count: critical.length,
    by_bucket: byBucket,
  };
  const top = critical.slice(0, 10);

  const inputHash = createHash("sha256").update(JSON.stringify(rows)).digest("hex");
  const outputHash = createHash("sha256")
    .update(JSON.stringify({ summary, top }))
    .digest("hex");
  const payload = { summary, top_findings: top };

  const [a] = await sql`
    INSERT INTO audit_log
      (use_case_id, correlation_id, agent_id, layer, event_type, r_tier, input_hash, output_hash, payload)
    VALUES
      ('D2', ${`a2-${inputHash.slice(0, 8)}`}, 'A2', 4, 'ar.watch.run', 'R1',
       ${inputHash}, ${outputHash}, ${sql.json(payload as unknown as Parameters<typeof sql.json>[0])})
    RETURNING id
  `;
  await sql`UPDATE agent_registry SET last_health_check = now() WHERE agent_id = 'A2'`;

  return { agent_id: "A2", audit_id: a.id as string, summary, top_findings: top };
}

// A1 — Distillation Cascade (Blueprint v2.3, R1/L2/LOW). Baca raw wa_message
// dalam satu window → distilasi via services/ai (/rekap, kompresi + LLM) →
// simpan artefak ke digest_rekap → log run ke audit_log (Layer 4) + registry.
// Tanpa OPENROUTER_API_KEY, panggilan ai jatuh ke dry_run (prompt sebagai
// output) sehingga cascade tetap berjalan offline.

export interface DistillResult {
  agent_id: string;
  distilled: boolean;
  audit_id: string | null;
  digest_id: string | null;
  summary: {
    messages: number;
    groups: number;
    window_hours: number;
    group_jid: string;
    model: string | null;
  };
  rekap_preview: string | null;
}

export async function runDistillationCascade(opts: {
  groupJid?: string;
  windowHours?: number;
}): Promise<DistillResult> {
  const sql = db();
  const windowHours = opts.windowHours && opts.windowHours > 0 ? opts.windowHours : 5;
  const groupJid = opts.groupJid;
  const rows = await getWaMessages(windowHours, groupJid);

  const groupCount = new Set(rows.map((r) => r.group_jid)).size;
  const baseSummary = {
    messages: rows.length,
    groups: groupCount,
    window_hours: windowHours,
    group_jid: groupJid ?? "_all",
    model: null as string | null,
  };

  // Tidak ada pesan dalam window → tidak ada yang didistilasi (no-op, no digest).
  if (rows.length === 0) {
    return {
      agent_id: "A1",
      distilled: false,
      audit_id: null,
      digest_id: null,
      summary: baseSummary,
      rekap_preview: null,
    };
  }

  // Bangun RekapRequest untuk services/ai dari raw wa_message.
  const endMs = Math.max(...rows.map((r) => r.ts_ms));
  const end = new Date(endMs);
  const start = new Date(endMs - windowHours * 3600 * 1000);
  const tanggal = end.toISOString().slice(0, 10);
  const jam = end.toISOString().slice(11, 16);
  const members: Record<string, string> = {};
  const groups: Record<string, string> = {};
  for (const r of rows) {
    if (r.sender_jid && r.sender_name) members[r.sender_jid] = r.sender_name;
    if (r.group_name) groups[r.group_jid] = r.group_name;
  }
  const rekapReq = {
    jam,
    tanggal,
    window_label: `${windowHours} jam terakhir`,
    messages: rows.map((r) => ({
      jid: r.group_jid,
      ts_ms: r.ts_ms,
      sender: r.sender_name ?? r.sender_jid ?? "unknown",
      body: r.body ?? "",
      media: r.message_type && r.message_type !== "text" ? r.message_type : null,
    })),
    members: Object.keys(members).length ? members : undefined,
    groups: Object.keys(groups).length ? groups : undefined,
    dry_run: !process.env.OPENROUTER_API_KEY,
  };

  const { status, data } = await callAi("/rekap", rekapReq);
  if (status >= 400) {
    throw new Error(`services/ai /rekap status ${status}: ${JSON.stringify(data)}`);
  }
  const rekapText = String(data.rekap ?? "");
  const model = (data.model as string | undefined) ?? null;

  const groupName =
    groupJid && groups[groupJid]
      ? groups[groupJid]
      : groupJid
        ? null
        : "WRG (agregat semua grup aktif)";
  const digestId = await insertRekap({
    group_jid: groupJid ?? "_all",
    group_name: groupName,
    period_start: start.toISOString(),
    period_end: end.toISOString(),
    raw_output: rekapText,
    model_used: model,
  });

  const summary = { ...baseSummary, model };
  const inputHash = createHash("sha256")
    .update(JSON.stringify(rekapReq.messages))
    .digest("hex");
  const outputHash = createHash("sha256").update(rekapText).digest("hex");
  const payload = { summary, digest_id: digestId, window: { start: start.toISOString(), end: end.toISOString() } };

  const [a] = await sql`
    INSERT INTO audit_log
      (use_case_id, correlation_id, agent_id, layer, event_type, r_tier, input_hash, output_hash, payload)
    VALUES
      ('D1b', ${`a1-${inputHash.slice(0, 8)}`}, 'A1', 4, 'distill.rekap.run', 'R1',
       ${inputHash}, ${outputHash}, ${sql.json(payload as unknown as Parameters<typeof sql.json>[0])})
    RETURNING id
  `;
  await sql`UPDATE agent_registry SET last_health_check = now() WHERE agent_id = 'A1'`;

  return {
    agent_id: "A1",
    distilled: true,
    audit_id: a.id as string,
    digest_id: digestId,
    summary,
    rekap_preview: rekapText.slice(0, 280),
  };
}

// A3 — Sari Collection Drafter (Blueprint v2.3, R2/L2/MED). Baca invoice
// overdue (ar_aging_mv) yang belum punya draft → minta services/ai menyusun
// draft pesan penagihan per invoice → simpan ke collection_draft (status
// 'draft', menunggu approval HITL — TIDAK auto-kirim) → log audit_log
// (Layer 4, R2) + update registry.

const VALID_DRAFT_TYPES = new Set(["whatsapp", "email", "formal_letter"]);

export interface DraftResult {
  agent_id: string;
  drafted: boolean;
  audit_id: string | null;
  draft_type: string;
  count: number;
  model: string | null;
  drafts: { customer_id: string; invoice_no: string; draft_id: string }[];
}

export async function runCollectionDrafter(opts: {
  draftType?: string;
  limit?: number;
}): Promise<DraftResult> {
  const sql = db();
  const draftType =
    opts.draftType && VALID_DRAFT_TYPES.has(opts.draftType) ? opts.draftType : "whatsapp";
  const limit = opts.limit && opts.limit > 0 ? Math.min(opts.limit, 25) : 10;
  const overdue: OverdueItem[] = await getOverdueForDrafting(limit);

  if (overdue.length === 0) {
    return {
      agent_id: "A3",
      drafted: false,
      audit_id: null,
      draft_type: draftType,
      count: 0,
      model: null,
      drafts: [],
    };
  }

  const { status, data } = await callAi("/collection-draft", {
    items: overdue,
    draft_type: draftType,
    dry_run: !process.env.OPENROUTER_API_KEY,
  });
  if (status >= 400) {
    throw new Error(`services/ai /collection-draft status ${status}: ${JSON.stringify(data)}`);
  }
  const drafted = (data.drafts as { customer_id: string; invoice_no: string; draft_text: string }[]) ?? [];
  const model = (data.model as string | undefined) ?? null;

  const saved: { customer_id: string; invoice_no: string; draft_id: string }[] = [];
  for (const d of drafted) {
    if (!d.draft_text) continue;
    const draftId = await insertCollectionDraft({
      customer_id: d.customer_id,
      invoice_no: d.invoice_no,
      draft_text: d.draft_text,
      draft_type: draftType,
    });
    saved.push({ customer_id: d.customer_id, invoice_no: d.invoice_no, draft_id: draftId });
  }

  const inputHash = createHash("sha256").update(JSON.stringify(overdue)).digest("hex");
  const outputHash = createHash("sha256")
    .update(JSON.stringify(drafted.map((d) => d.draft_text)))
    .digest("hex");
  const payload = { draft_type: draftType, count: saved.length, draft_ids: saved.map((s) => s.draft_id) };

  const [a] = await sql`
    INSERT INTO audit_log
      (use_case_id, correlation_id, agent_id, layer, event_type, r_tier, input_hash, output_hash, payload)
    VALUES
      ('D2', ${`a3-${inputHash.slice(0, 8)}`}, 'A3', 4, 'collection.draft.run', 'R2',
       ${inputHash}, ${outputHash}, ${sql.json(payload as unknown as Parameters<typeof sql.json>[0])})
    RETURNING id
  `;
  await sql`UPDATE agent_registry SET last_health_check = now() WHERE agent_id = 'A3'`;

  return {
    agent_id: "A3",
    drafted: true,
    audit_id: a.id as string,
    draft_type: draftType,
    count: saved.length,
    model,
    drafts: saved,
  };
}

// A4 — Pipeline Authenticity (Blueprint v2.3, R2/L3/MED). Audit keaslian
// pipeline secara deterministik: deteksi deal yang maju ke stage lanjut tanpa
// jejak #REPORT, mangkrak, lompat-stage, atau menang implausibel cepat. Temuan
// kritis dieskalasi ke hitl_queue (L3 gate) untuk verifikasi manusia. Log run
// ke audit_log (Layer 4, R2) + update registry.

const STALE_DAYS = Number(process.env.A4_STALE_DAYS ?? 30);
const MIN_CYCLE_DAYS = Number(process.env.A4_MIN_CYCLE_DAYS ?? 3);

export interface PipelineFinding {
  deal_id: string;
  customer_name: string | null;
  am_id: string;
  stage: string;
  estimated_value: number | null;
  flags: string[];
  score: number;
  critical: boolean;
}

export async function runPipelineAuthenticity(): Promise<{
  agent_id: string;
  audit_id: string;
  summary: {
    deals_scanned: number;
    flagged: number;
    critical: number;
    escalated: number;
    by_flag: Record<string, number>;
  };
  findings: PipelineFinding[];
}> {
  const sql = db();
  const deals = await getDealsForAudit();
  const transitions = await getDealTransitions();

  const byDeal = new Map<string, TransitionRow[]>();
  for (const t of transitions) {
    const arr = byDeal.get(t.deal_id) ?? [];
    arr.push(t);
    byDeal.set(t.deal_id, arr);
  }

  const findings: PipelineFinding[] = [];
  for (const d of deals) {
    const flags: string[] = [];
    const criticalFlags = new Set<string>();
    const adv = advIdx(d.stage);
    const trail = byDeal.get(d.deal_id) ?? [];
    const isWon = WON.has(d.stage);

    // 1. Maju ke SPH+ tanpa satupun transisi tercatat → tidak didukung jejak.
    if (adv >= 2 && d.log_count === 0) {
      flags.push("unsupported");
      criticalFlags.add("unsupported");
    }
    // 2. Mangkrak: masih terbuka tapi tak bergerak > STALE_DAYS.
    if (!isWon && d.days_idle > STALE_DAYS) flags.push("stale");
    // 3. Lompat-stage: ada transisi yang melompati >=2 tingkat maju.
    for (const t of trail) {
      const from = t.from_stage ? advIdx(t.from_stage) : -1;
      const to = advIdx(t.to_stage);
      if (from >= 0 && to >= 0 && to - from >= 2) {
        flags.push("stage_skip");
        if (WON.has(t.to_stage)) criticalFlags.add("stage_skip");
        break;
      }
    }
    // 4. Menang implausibel cepat: transisi ke WON < MIN_CYCLE_DAYS dari created.
    if (isWon) {
      const wonT = trail.find((t) => WON.has(t.to_stage));
      const wonMs = wonT ? wonT.ts_ms : null;
      if (wonMs !== null) {
        const cycleDays = (wonMs - d.created_ms) / 86_400_000;
        if (cycleDays < MIN_CYCLE_DAYS) {
          flags.push("rapid_win");
          criticalFlags.add("rapid_win");
        }
      }
    }

    if (flags.length === 0) continue;
    const uniqFlags = [...new Set(flags)];
    findings.push({
      deal_id: d.deal_id,
      customer_name: d.customer_name,
      am_id: d.am_id,
      stage: d.stage,
      estimated_value: d.estimated_value,
      flags: uniqFlags,
      score: uniqFlags.length + criticalFlags.size,
      critical: criticalFlags.size > 0,
    });
  }
  findings.sort((a, b) => b.score - a.score);

  const byFlag: Record<string, number> = {};
  for (const f of findings) for (const fl of f.flags) byFlag[fl] = (byFlag[fl] ?? 0) + 1;
  const critical = findings.filter((f) => f.critical);

  // Eskalasi temuan kritis ke HITL (L3), idempoten per deal.
  let escalated = 0;
  for (const f of critical) {
    const id = await enqueuePipelineFlag(f);
    if (id) escalated += 1;
  }

  const summary = {
    deals_scanned: deals.length,
    flagged: findings.length,
    critical: critical.length,
    escalated,
    by_flag: byFlag,
  };
  const top = findings.slice(0, 25);
  const inputHash = createHash("sha256").update(JSON.stringify(deals)).digest("hex");
  const outputHash = createHash("sha256").update(JSON.stringify({ summary, top })).digest("hex");
  const payload = { summary, flagged_deals: top };

  const [a] = await sql`
    INSERT INTO audit_log
      (use_case_id, correlation_id, agent_id, layer, event_type, r_tier, input_hash, output_hash, payload)
    VALUES
      ('D1', ${`a4-${inputHash.slice(0, 8)}`}, 'A4', 4, 'pipeline.authenticity.run', 'R2',
       ${inputHash}, ${outputHash}, ${sql.json(payload as unknown as Parameters<typeof sql.json>[0])})
    RETURNING id
  `;
  await sql`UPDATE agent_registry SET last_health_check = now() WHERE agent_id = 'A4'`;

  return { agent_id: "A4", audit_id: a.id as string, summary, findings: top };
}
