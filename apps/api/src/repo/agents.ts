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
import {
  getDealValueSeries,
  getArAmountSeries,
  enqueueAnomalyFlag,
  median,
  mad,
  type SeriesPoint,
} from "./anomaly.js";
import {
  getDealsNeedingDoc,
  getDealById,
  insertSalesDoc,
  DOC_TYPE_FOR_STAGE,
  VALID_DOC_TYPES,
  type DealForDoc,
} from "./salesdoc.js";
import { getProductIntelligence, type ProductIntel } from "./product.js";
import {
  getMessagesToAnnotate,
  insertAnnotation,
  type MessageToAnnotate,
} from "./sentiment.js";
import { getNetworkInput, computeNetwork, type NetworkGraph } from "./network.js";
import { gatherExecutiveSignals, insertBriefing } from "./executive.js";
import {
  getAmsNeedingCoaching,
  insertCoachingNote,
  type AmMetrics,
} from "./coaching.js";

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

// A5 — Anomaly Detection (Blueprint v2.3, R2/L3/MED). Deteksi outlier numerik
// lintas-domain (nilai deal, nominal AR) dengan statistik robust: modified
// z-score berbasis median + MAD (Iglewicz-Hoaglin), tahan terhadap outlier
// itu sendiri. Anomali ekstrem dieskalasi ke hitl_queue (L3). Log run ke
// audit_log (Layer 4, R2, D6 governance/observability) + update registry.

const A5_Z = Number(process.env.A5_Z_THRESHOLD ?? 3.5);
const A5_CRITICAL_Z = Number(process.env.A5_CRITICAL_Z ?? 5);
const A5_MIN_SAMPLES = Number(process.env.A5_MIN_SAMPLES ?? 5);

export interface AnomalyFinding {
  stream: string;
  entity_id: string;
  label: string | null;
  value: number;
  score: number; // |modified z|
  direction: "high" | "low";
  median: number;
  critical: boolean;
}

// Deteksi outlier satu stream via modified z-score. Stream < MIN_SAMPLES atau
// MAD=0 (tak ada sebaran) dilewati — statistik tak bermakna.
function detectStream(stream: string, points: SeriesPoint[]): AnomalyFinding[] {
  if (points.length < A5_MIN_SAMPLES) return [];
  const values = points.map((p) => p.value);
  const med = median(values);
  const m = mad(values, med);
  if (m === 0) return [];
  const out: AnomalyFinding[] = [];
  for (const p of points) {
    const mz = Math.abs((0.6745 * (p.value - med)) / m);
    if (mz < A5_Z) continue;
    out.push({
      stream,
      entity_id: p.entity_id,
      label: p.label,
      value: p.value,
      score: Math.round(mz * 100) / 100,
      direction: p.value >= med ? "high" : "low",
      median: med,
      critical: mz >= A5_CRITICAL_Z,
    });
  }
  return out;
}

export async function runAnomalyDetection(): Promise<{
  agent_id: string;
  audit_id: string;
  summary: {
    streams_analyzed: number;
    samples: number;
    anomalies: number;
    critical: number;
    escalated: number;
    by_stream: Record<string, number>;
  };
  findings: AnomalyFinding[];
}> {
  const sql = db();
  const streams: { name: string; points: SeriesPoint[] }[] = [
    { name: "deal_value", points: await getDealValueSeries() },
    { name: "ar_amount", points: await getArAmountSeries() },
  ];

  let samples = 0;
  let analyzed = 0;
  const findings: AnomalyFinding[] = [];
  for (const s of streams) {
    samples += s.points.length;
    if (s.points.length >= A5_MIN_SAMPLES) analyzed += 1;
    findings.push(...detectStream(s.name, s.points));
  }
  findings.sort((a, b) => b.score - a.score);

  const byStream: Record<string, number> = {};
  for (const f of findings) byStream[f.stream] = (byStream[f.stream] ?? 0) + 1;
  const critical = findings.filter((f) => f.critical);

  let escalated = 0;
  for (const f of critical) {
    const id = await enqueueAnomalyFlag({
      stream: f.stream,
      entity_id: f.entity_id,
      label: f.label,
      value: f.value,
      score: f.score,
      direction: f.direction,
      median: f.median,
    });
    if (id) escalated += 1;
  }

  const summary = {
    streams_analyzed: analyzed,
    samples,
    anomalies: findings.length,
    critical: critical.length,
    escalated,
    by_stream: byStream,
  };
  const top = findings.slice(0, 25);
  const inputHash = createHash("sha256")
    .update(JSON.stringify(streams.map((s) => s.points)))
    .digest("hex");
  const outputHash = createHash("sha256").update(JSON.stringify({ summary, top })).digest("hex");
  const payload = { summary, anomalies: top };

  const [a] = await sql`
    INSERT INTO audit_log
      (use_case_id, correlation_id, agent_id, layer, event_type, r_tier, input_hash, output_hash, payload)
    VALUES
      ('D6', ${`a5-${inputHash.slice(0, 8)}`}, 'A5', 4, 'anomaly.detection.run', 'R2',
       ${inputHash}, ${outputHash}, ${sql.json(payload as unknown as Parameters<typeof sql.json>[0])})
    RETURNING id
  `;
  await sql`UPDATE agent_registry SET last_health_check = now() WHERE agent_id = 'A5'`;

  return { agent_id: "A5", audit_id: a.id as string, summary, findings: top };
}

// A6 — Sales Doc Drafter (Blueprint v2.3, R2/L2/HIGH). Susun dokumen penjualan
// (SPH/offering/presentation/MOU) dari konteks deal via services/ai → simpan ke
// sales_doc (status 'draft', menunggu review — TIDAK auto-kirim) → log
// audit_log (Layer 4, R2, D1) + update registry. Mode: targeted (deal_id) atau
// batch (deal di stage ber-dokumen yang belum punya doc).

function docTypeFor(deal: DealForDoc, requested?: string): string {
  if (requested && VALID_DOC_TYPES.has(requested)) return requested;
  return DOC_TYPE_FOR_STAGE[deal.stage] ?? "sph";
}

export interface SalesDocResult {
  agent_id: string;
  drafted: boolean;
  audit_id: string | null;
  count: number;
  model: string | null;
  docs: { deal_id: string; doc_type: string; doc_id: string; title: string }[];
}

export async function runSalesDocDrafter(opts: {
  dealId?: string;
  docType?: string;
  limit?: number;
}): Promise<SalesDocResult> {
  const sql = db();
  const limit = opts.limit && opts.limit > 0 ? Math.min(opts.limit, 10) : 5;

  let targets: { deal: DealForDoc; docType: string }[] = [];
  if (opts.dealId) {
    const deal = await getDealById(opts.dealId);
    if (deal) targets = [{ deal, docType: docTypeFor(deal, opts.docType) }];
  } else {
    const deals = await getDealsNeedingDoc(limit);
    targets = deals.map((deal) => ({ deal, docType: docTypeFor(deal, opts.docType) }));
  }

  if (targets.length === 0) {
    return { agent_id: "A6", drafted: false, audit_id: null, count: 0, model: null, docs: [] };
  }

  const saved: { deal_id: string; doc_type: string; doc_id: string; title: string }[] = [];
  let lastModel: string | null = null;
  for (const { deal, docType } of targets) {
    const { status, data } = await callAi("/sales-doc", {
      customer_name: deal.customer_name,
      am_id: deal.am_id,
      stage: deal.stage,
      estimated_value: deal.estimated_value ?? 0,
      product_ids: deal.product_ids,
      notes: deal.notes,
      doc_type: docType,
      dry_run: !process.env.OPENROUTER_API_KEY,
    });
    if (status >= 400) {
      throw new Error(`services/ai /sales-doc status ${status}: ${JSON.stringify(data)}`);
    }
    const draftText = String(data.draft_text ?? "");
    if (!draftText) continue;
    const title = String(data.title ?? `${docType} — ${deal.customer_name ?? deal.customer_id}`);
    lastModel = (data.model as string | undefined) ?? lastModel;
    const docId = await insertSalesDoc({
      deal_id: deal.deal_id,
      customer_id: deal.customer_id,
      customer_name: deal.customer_name,
      doc_type: docType,
      title,
      draft_text: draftText,
      model_used: data.model as string | undefined,
    });
    saved.push({ deal_id: deal.deal_id, doc_type: docType, doc_id: docId, title });
  }

  const inputHash = createHash("sha256")
    .update(JSON.stringify(targets.map((t) => ({ deal_id: t.deal.deal_id, doc_type: t.docType }))))
    .digest("hex");
  const outputHash = createHash("sha256")
    .update(JSON.stringify(saved.map((s) => s.doc_id)))
    .digest("hex");
  const payload = { count: saved.length, docs: saved };

  const [a] = await sql`
    INSERT INTO audit_log
      (use_case_id, correlation_id, agent_id, layer, event_type, r_tier, input_hash, output_hash, payload)
    VALUES
      ('D1', ${`a6-${inputHash.slice(0, 8)}`}, 'A6', 4, 'sales.doc.draft.run', 'R2',
       ${inputHash}, ${outputHash}, ${sql.json(payload as unknown as Parameters<typeof sql.json>[0])})
    RETURNING id
  `;
  await sql`UPDATE agent_registry SET last_health_check = now() WHERE agent_id = 'A6'`;

  return {
    agent_id: "A6",
    drafted: saved.length > 0,
    audit_id: a.id as string,
    count: saved.length,
    model: lastModel,
    docs: saved,
  };
}

// A7 — Product Intelligence (Blueprint v2.3, R1/L2/LOW). Agregasi intelijen
// produk dari deal.product_ids (jumlah deal, nilai pipeline, win-rate per
// produk). Deterministik, read-only terhadap domain; log run ke audit_log
// (Layer 4, R1, D1) + update registry. Tanpa eskalasi HITL (sifatnya laporan).

export async function runProductIntelligence(): Promise<{
  agent_id: string;
  audit_id: string;
  summary: {
    products: number;
    total_pipeline_value: number;
    open_pipeline_value: number;
    top_by_value: { product_id: string; total_value: number }[];
  };
  products: ProductIntel[];
}> {
  const sql = db();
  const rows = await getProductIntelligence();

  const totalValue = rows.reduce((a, r) => a + r.total_value, 0);
  const openValue = rows.reduce((a, r) => a + r.open_value, 0);
  const summary = {
    products: rows.length,
    total_pipeline_value: totalValue,
    open_pipeline_value: openValue,
    top_by_value: rows.slice(0, 5).map((r) => ({
      product_id: r.product_id,
      total_value: r.total_value,
    })),
  };

  const inputHash = createHash("sha256").update(JSON.stringify(rows)).digest("hex");
  const outputHash = createHash("sha256").update(JSON.stringify(summary)).digest("hex");
  const payload = { summary, products: rows.slice(0, 50) };

  const [a] = await sql`
    INSERT INTO audit_log
      (use_case_id, correlation_id, agent_id, layer, event_type, r_tier, input_hash, output_hash, payload)
    VALUES
      ('D1', ${`a7-${inputHash.slice(0, 8)}`}, 'A7', 4, 'product.intel.run', 'R1',
       ${inputHash}, ${outputHash}, ${sql.json(payload as unknown as Parameters<typeof sql.json>[0])})
    RETURNING id
  `;
  await sql`UPDATE agent_registry SET last_health_check = now() WHERE agent_id = 'A7'`;

  return { agent_id: "A7", audit_id: a.id as string, summary, products: rows };
}

// A8 — Sentiment & Entity Extraction (Blueprint v2.3, R1/L2/LOW). Baca
// wa_message dalam window yang belum dianotasi → services/ai (/extract,
// per-pesan sentiment+entity, fallback rule-based) → simpan ke
// message_annotation → log audit_log (Layer 4, R1, D1b) + update registry.

interface ExtractedAnnotation {
  id: string;
  sentiment: string;
  sentiment_score: number;
  entities: { type: string; value: string }[];
}

export async function runSentimentExtraction(opts: {
  windowHours?: number;
  groupJid?: string;
  limit?: number;
}): Promise<{
  agent_id: string;
  annotated: boolean;
  audit_id: string | null;
  count: number;
  model: string | null;
  summary: { positive: number; neutral: number; negative: number; entities: number };
}> {
  const sql = db();
  const windowHours = opts.windowHours && opts.windowHours > 0 ? opts.windowHours : 24;
  const limit = opts.limit && opts.limit > 0 ? Math.min(opts.limit, 100) : 50;
  const messages: MessageToAnnotate[] = await getMessagesToAnnotate(
    windowHours,
    opts.groupJid,
    limit,
  );

  if (messages.length === 0) {
    return {
      agent_id: "A8",
      annotated: false,
      audit_id: null,
      count: 0,
      model: null,
      summary: { positive: 0, neutral: 0, negative: 0, entities: 0 },
    };
  }

  const { status, data } = await callAi("/extract", {
    messages: messages.map((m) => ({ id: m.id, sender: m.sender_name, body: m.body })),
    dry_run: !process.env.OPENROUTER_API_KEY,
  });
  if (status >= 400) {
    throw new Error(`services/ai /extract status ${status}: ${JSON.stringify(data)}`);
  }
  const annotations = (data.annotations as ExtractedAnnotation[]) ?? [];
  const model = (data.model as string | undefined) ?? null;
  const byMsg = new Map(messages.map((m) => [m.id, m]));

  const dist = { positive: 0, neutral: 0, negative: 0, entities: 0 };
  let saved = 0;
  for (const ann of annotations) {
    const msg = byMsg.get(ann.id);
    if (!msg) continue;
    const entities = Array.isArray(ann.entities) ? ann.entities : [];
    await insertAnnotation({
      wa_message_id: msg.id,
      group_jid: msg.group_jid,
      sender_name: msg.sender_name,
      sentiment: ann.sentiment,
      sentiment_score: ann.sentiment_score,
      entities,
      model_used: model,
    });
    saved += 1;
    if (ann.sentiment === "positive") dist.positive += 1;
    else if (ann.sentiment === "negative") dist.negative += 1;
    else dist.neutral += 1;
    dist.entities += entities.length;
  }

  const inputHash = createHash("sha256")
    .update(JSON.stringify(messages.map((m) => m.id)))
    .digest("hex");
  const outputHash = createHash("sha256").update(JSON.stringify(annotations)).digest("hex");
  const payload = { count: saved, summary: dist };

  const [a] = await sql`
    INSERT INTO audit_log
      (use_case_id, correlation_id, agent_id, layer, event_type, r_tier, input_hash, output_hash, payload)
    VALUES
      ('D1b', ${`a8-${inputHash.slice(0, 8)}`}, 'A8', 4, 'sentiment.extract.run', 'R1',
       ${inputHash}, ${outputHash}, ${sql.json(payload as unknown as Parameters<typeof sql.json>[0])})
    RETURNING id
  `;
  await sql`UPDATE agent_registry SET last_health_check = now() WHERE agent_id = 'A8'`;

  return {
    agent_id: "A8",
    annotated: saved > 0,
    audit_id: a.id as string,
    count: saved,
    model,
    summary: dist,
  };
}

// A9 — Spider Network Analyst (Blueprint v2.3, R1/L2/MED). Bangun graf relasi
// dari anotasi A8 (entity + pengirim yang muncul bersama) → metrik jaringan
// (sentralitas, pasangan teratas, komponen). Deterministik, read-only; log run
// ke audit_log (Layer 4, R1, D1b) + update registry. Tanpa HITL.

export async function runSpiderNetwork(opts: { windowDays?: number }): Promise<{
  agent_id: string;
  audit_id: string;
  summary: NetworkGraph["summary"];
  top_nodes: NetworkGraph["top_nodes"];
  top_edges: NetworkGraph["top_edges"];
}> {
  const sql = db();
  const windowDays = opts.windowDays && opts.windowDays > 0 ? opts.windowDays : 30;
  const rows = await getNetworkInput(windowDays);
  const graph = computeNetwork(rows);

  const inputHash = createHash("sha256").update(JSON.stringify(rows)).digest("hex");
  const outputHash = createHash("sha256")
    .update(JSON.stringify({ summary: graph.summary, top_nodes: graph.top_nodes }))
    .digest("hex");
  const payload = {
    summary: graph.summary,
    top_nodes: graph.top_nodes,
    top_edges: graph.top_edges,
  };

  const [a] = await sql`
    INSERT INTO audit_log
      (use_case_id, correlation_id, agent_id, layer, event_type, r_tier, input_hash, output_hash, payload)
    VALUES
      ('D1b', ${`a9-${inputHash.slice(0, 8)}`}, 'A9', 4, 'network.analysis.run', 'R1',
       ${inputHash}, ${outputHash}, ${sql.json(payload as unknown as Parameters<typeof sql.json>[0])})
    RETURNING id
  `;
  await sql`UPDATE agent_registry SET last_health_check = now() WHERE agent_id = 'A9'`;

  return {
    agent_id: "A9",
    audit_id: a.id as string,
    summary: graph.summary,
    top_nodes: graph.top_nodes,
    top_edges: graph.top_edges,
  };
}

// A10 — Executive Synthesis (Blueprint v2.3, R1/L2/HIGH). Kumpulkan sinyal
// lintas-domain (pipeline, AR, HITL, sentimen, aktivitas agen) → services/ai
// mensintesis briefing eksekutif → simpan ke digest_briefing (hitl_status
// 'pending', menunggu review) → log audit_log (Layer 4, R1, D6) + registry.
// Capstone yang merangkum keluaran A1–A9.

export async function runExecutiveSynthesis(opts: { periodLabel?: string }): Promise<{
  agent_id: string;
  audit_id: string;
  briefing_id: string;
  week_start: string;
  model: string | null;
  preview: string;
}> {
  const sql = db();
  const periodLabel = opts.periodLabel ?? "harian";
  const signals = await gatherExecutiveSignals();

  const { status, data } = await callAi("/executive-synthesis", {
    signals,
    period_label: periodLabel,
    dry_run: !process.env.OPENROUTER_API_KEY,
  });
  if (status >= 400) {
    throw new Error(`services/ai /executive-synthesis status ${status}: ${JSON.stringify(data)}`);
  }
  const briefingText = String(data.briefing ?? "");
  const model = (data.model as string | undefined) ?? null;

  const { id: briefingId, week_start } = await insertBriefing({
    sections: signals,
    raw_output: briefingText,
    model_used: model,
  });

  const inputHash = createHash("sha256").update(JSON.stringify(signals)).digest("hex");
  const outputHash = createHash("sha256").update(briefingText).digest("hex");
  const payload = { briefing_id: briefingId, week_start, period_label: periodLabel };

  const [a] = await sql`
    INSERT INTO audit_log
      (use_case_id, correlation_id, agent_id, layer, event_type, r_tier, input_hash, output_hash, payload)
    VALUES
      ('D6', ${`a10-${inputHash.slice(0, 8)}`}, 'A10', 4, 'executive.synthesis.run', 'R1',
       ${inputHash}, ${outputHash}, ${sql.json(payload as unknown as Parameters<typeof sql.json>[0])})
    RETURNING id
  `;
  await sql`UPDATE agent_registry SET last_health_check = now() WHERE agent_id = 'A10'`;

  return {
    agent_id: "A10",
    audit_id: a.id as string,
    briefing_id: briefingId,
    week_start,
    model,
    preview: briefingText.slice(0, 320),
  };
}

// A11 — Coaching Outcome Synthesis (Blueprint v2.3, R1/L2/MED). Sintesis
// outcome coaching per Account Manager dari metrik kinerja (deal, win-rate,
// aktivitas) → strengths/gaps/recommendations + skor → simpan ke coaching_note
// (idempoten per AM+periode). Deterministik; log audit_log (Layer 4, R1, D1) +
// registry. Tanpa LLM/HITL. Berorientasi pengembangan tim.

const COACH_WIN_GOOD = Number(process.env.A11_WIN_GOOD ?? 0.5);
const COACH_WIN_LOW = Number(process.env.A11_WIN_LOW ?? 0.3);
const COACH_ACTIVITY_LOW = Number(process.env.A11_ACTIVITY_LOW ?? 1);

function synthesizeCoaching(m: AmMetrics): {
  strengths: string[];
  gaps: string[];
  recommendations: string[];
  score: number;
} {
  const strengths: string[] = [];
  const gaps: string[] = [];
  const recommendations: string[] = [];
  const wr = m.win_rate;

  if (wr !== null && wr >= COACH_WIN_GOOD) strengths.push(`Win-rate kuat (${Math.round(wr * 100)}%)`);
  if (m.activity > 5) strengths.push(`Aktivitas pelaporan aktif (${m.activity} update)`);
  if (m.total_value > 0) strengths.push(`Mengelola pipeline senilai Rp${Math.round(m.total_value).toLocaleString("id-ID")}`);

  if (wr !== null && wr < COACH_WIN_LOW) {
    gaps.push(`Win-rate rendah (${Math.round(wr * 100)}%)`);
    recommendations.push("Tinjau kualifikasi prospek & strategi closing bersama mentor.");
  }
  if (m.activity <= COACH_ACTIVITY_LOW) {
    gaps.push("Aktivitas pelaporan minim");
    recommendations.push("Tingkatkan disiplin #REPORT harian untuk visibilitas pipeline.");
  }
  if (m.open >= 5 && m.activity <= m.open) {
    gaps.push(`Pipeline pasif (${m.open} deal terbuka, sedikit update)`);
    recommendations.push("Jadwalkan follow-up rutin untuk deal terbuka yang menua.");
  }
  if (wr === null && m.deals > 0) {
    gaps.push("Belum ada deal yang ditutup (menang/kalah)");
    recommendations.push("Fokuskan effort untuk membawa minimal satu deal ke keputusan.");
  }
  if (gaps.length === 0) recommendations.push("Pertahankan ritme; ambil deal bernilai lebih besar.");

  // Skor komposit 0-100: win-rate (40) + aktivitas (30) + volume deal (30).
  const score =
    Math.round(
      ((wr ?? 0) * 40 + Math.min(m.activity / 10, 1) * 30 + Math.min(m.deals / 10, 1) * 30) * 100,
    ) / 100;

  return { strengths, gaps, recommendations, score };
}

export async function runCoachingSynthesis(opts: { period?: string }): Promise<{
  agent_id: string;
  audit_id: string;
  period: string;
  synthesized: boolean;
  count: number;
  notes: { am_id: string; note_id: string; score: number }[];
}> {
  const sql = db();
  const now = new Date();
  const period =
    opts.period ?? `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const ams = await getAmsNeedingCoaching(period);

  const notes: { am_id: string; note_id: string; score: number }[] = [];
  for (const m of ams) {
    const syn = synthesizeCoaching(m);
    const noteId = await insertCoachingNote({
      am_id: m.am_id,
      period,
      metrics: m,
      strengths: syn.strengths,
      gaps: syn.gaps,
      recommendations: syn.recommendations,
      score: syn.score,
    });
    notes.push({ am_id: m.am_id, note_id: noteId, score: syn.score });
  }

  const inputHash = createHash("sha256").update(JSON.stringify(ams)).digest("hex");
  const outputHash = createHash("sha256").update(JSON.stringify(notes)).digest("hex");
  const payload = { period, count: notes.length, notes };

  const [a] = await sql`
    INSERT INTO audit_log
      (use_case_id, correlation_id, agent_id, layer, event_type, r_tier, input_hash, output_hash, payload)
    VALUES
      ('D1', ${`a11-${inputHash.slice(0, 8)}`}, 'A11', 4, 'coaching.synthesis.run', 'R1',
       ${inputHash}, ${outputHash}, ${sql.json(payload as unknown as Parameters<typeof sql.json>[0])})
    RETURNING id
  `;
  await sql`UPDATE agent_registry SET last_health_check = now() WHERE agent_id = 'A11'`;

  return {
    agent_id: "A11",
    audit_id: a.id as string,
    period,
    synthesized: notes.length > 0,
    count: notes.length,
    notes,
  };
}
