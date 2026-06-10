import { serve } from "@hono/node-server";
import { Hono } from "hono";
import type { Context } from "hono";
import type { EventEnvelope } from "@wrg/types";
import { isEventEnvelope } from "./envelope.js";
import { parsePlan } from "./parsers/plan.js";
import { parseReport } from "./parsers/report.js";
import { matchCustomer, type PlanCandidate } from "./parsers/fuzzy.js";
import { isDbEnabled, pingDb } from "./db.js";
import { insertAuditEvent } from "./repo/audit.js";
import { upsertDealsFromPlan, logReportToDeals, getPipeline } from "./repo/deal.js";
import { enqueueAmbiguous, listHitl, resolveHitl } from "./repo/hitl.js";
import { insertRekap, insertResume, getDigestHistory } from "./repo/digest.js";
import { getDashboardStats } from "./repo/stats.js";
import { getCustomers } from "./repo/customer.js";
import { ingestInvoices, getAging, type InvoiceInput } from "./repo/ar.js";
import {
  runArWatch,
  runDistillationCascade,
  runCollectionDrafter,
  runPipelineAuthenticity,
  runAnomalyDetection,
  runSalesDocDrafter,
  runProductIntelligence,
  runSentimentExtraction,
  runSpiderNetwork,
  runExecutiveSynthesis,
  runCoachingSynthesis,
} from "./repo/agents.js";
import { listCollectionDrafts } from "./repo/collection.js";
import { listSalesDocs } from "./repo/salesdoc.js";
import { getProductIntelligence } from "./repo/product.js";
import { listAnnotations } from "./repo/sentiment.js";
import { getNetworkInput, computeNetwork } from "./repo/network.js";
import { listBriefings } from "./repo/executive.js";
import { listCoachingNotes } from "./repo/coaching.js";
import { ingestWaMessages, type WaMessageInput } from "./repo/wa.js";
import { aiBaseUrl, callAi } from "./ai.js";
import { startScheduler, getScheduleStatus } from "./scheduler.js";

const app = new Hono();

app.get("/health", async (c) => {
  const db = isDbEnabled() ? (await pingDb()) ? "ok" : "down" : "disabled";
  return c.json({ status: "ok", service: "wrg-api", db });
});

// Event ingestion (ADR-024). Body harus berupa EventEnvelope yang valid.
app.post("/events", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }

  if (!isEventEnvelope(body)) {
    return c.json(
      { error: "payload is not a valid EventEnvelope (ADR-024)" },
      422,
    );
  }

  const event: EventEnvelope = body;
  // Persist ke audit_log (Layer 2 Input) kalau DB tersambung; else echo saja.
  let auditId: string | null = null;
  if (isDbEnabled()) {
    try {
      auditId = await insertAuditEvent(event);
    } catch (e) {
      return c.json({ error: "gagal persist audit_log", detail: String(e) }, 500);
    }
  }
  return c.json(
    {
      accepted: true,
      event_id: event.event_id,
      type: event.type,
      correlation_id: event.correlation_id,
      audit_id: auditId,
      persisted: auditId !== null,
    },
    202,
  );
});

// Tier AI/data: forward ke services/ai (FastAPI). api = orkestrator domain yang
// meng-enrich data dari DB sebelum memanggil tier AI. Klien (aiBaseUrl/callAi)
// dipindah ke ./ai.js agar dipakai bersama repo/agents (A1 distillation cascade).

// Proxy generik ke services/ai untuk operasi AI/data passthrough.
async function forwardToAi(c: Context, aiPath: string): Promise<Response> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }
  try {
    const res = await fetch(`${aiBaseUrl()}${aiPath}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    return new Response(text, {
      status: res.status,
      headers: { "content-type": "application/json" },
    });
  } catch {
    return c.json({ error: "ai service unreachable" }, 502);
  }
}

// Window periode rekap dari jam+tanggal (default mundur N jam), bisa di-override.
function deriveWindow(
  tanggal?: string,
  jam?: string,
  hours = 5,
  ps?: string,
  pe?: string,
): { periodStart: string; periodEnd: string } {
  if (ps && pe) return { periodStart: ps, periodEnd: pe };
  const t = jam && /^\d{2}:\d{2}$/.test(jam) ? jam : "00:00";
  const base = tanggal ? new Date(`${tanggal}T${t}:00Z`) : new Date();
  const end = Number.isNaN(base.getTime()) ? new Date() : base;
  const start = new Date(end.getTime() - hours * 3600 * 1000);
  return { periodStart: start.toISOString(), periodEnd: end.toISOString() };
}

app.post("/daily-summary", (c) => forwardToAi(c, "/daily-summary"));

app.post("/rekap", async (c) => {
  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }
  let r;
  try {
    r = await callAi("/rekap", body);
  } catch {
    return c.json({ error: "ai service unreachable" }, 502);
  }
  if (r.status >= 400 || !isDbEnabled()) return c.json(r.data, r.status === 200 ? 200 : (r.status as 200));
  try {
    const { periodStart, periodEnd } = deriveWindow(
      body.tanggal as string | undefined,
      body.jam as string | undefined,
      5,
      body.period_start as string | undefined,
      body.period_end as string | undefined,
    );
    const digestId = await insertRekap({
      group_jid: (body.group_jid as string) ?? "_all",
      group_name: (body.group_name as string) ?? "WRG (agregat semua grup aktif)",
      period_start: periodStart,
      period_end: periodEnd,
      raw_output: String(r.data.rekap ?? ""),
      model_used: r.data.model as string | undefined,
    });
    return c.json({ ...r.data, persisted: true, digest_id: digestId });
  } catch (e) {
    return c.json({ ...r.data, persisted: false, persist_error: String(e) });
  }
});

app.post("/resume", async (c) => {
  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }
  let r;
  try {
    r = await callAi("/resume", body);
  } catch {
    return c.json({ error: "ai service unreachable" }, 502);
  }
  if (r.status >= 400 || !isDbEnabled()) return c.json(r.data, r.status === 200 ? 200 : (r.status as 200));
  try {
    const digestId = await insertResume({
      period_date: (body.tanggal as string) ?? new Date().toISOString().slice(0, 10),
      period_type: (body.period_type as string) ?? "evening",
      raw_output: String(r.data.resume ?? ""),
      model_used: r.data.model as string | undefined,
    });
    return c.json({ ...r.data, persisted: true, digest_id: digestId });
  } catch (e) {
    return c.json({ ...r.data, persisted: false, persist_error: String(e) });
  }
});

// ── CRM parser domain (port legacy/crm wrg-plan / wrg-report) ──
// Pure parsing/normalisasi/klasifikasi. Persistensi ke PostgreSQL (INSERT
// sales_plan/activity_log) menyusul saat DB tersambung — endpoint ini balas
// struktur yang AKAN disimpan + (untuk report) hasil fuzzy-match ke plan.

app.post("/parse/plan", async (c) => {
  let body: { message?: string; now?: string; deadline?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }
  if (typeof body.message !== "string") {
    return c.json({ error: "body.message (string) wajib" }, 400);
  }
  return c.json(parsePlan(body.message, { now: body.now, deadline: body.deadline }));
});

app.post("/parse/report", async (c) => {
  let body: { message?: string; plans?: PlanCandidate[] };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }
  if (typeof body.message !== "string") {
    return c.json({ error: "body.message (string) wajib" }, 400);
  }
  const parsed = parseReport(body.message);
  const plans = body.plans ?? [];
  // Lampirkan fuzzy-match per item ke plan kandidat (sales_plan hari itu).
  const items = parsed.items.map((it) => ({
    ...it,
    match: matchCustomer(it.customer, plans),
  }));
  return c.json({ ...parsed, items });
});

// ── Domain action: parse + persist ke D1 (deal/spt_state_log) ──
// #PLAN → upsert deal pipeline; #REPORT → fuzzy-match deal + spt_state_log.
// Butuh DATABASE_URL + am_id. Tanpa DB → 503 (pakai /parse/* utk preview).

app.post("/plan", async (c) => {
  let body: { message?: string; am_id?: string; now?: string; deadline?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }
  if (typeof body.message !== "string") {
    return c.json({ error: "body.message (string) wajib" }, 400);
  }
  const parsed = parsePlan(body.message, { now: body.now, deadline: body.deadline });
  if (!isDbEnabled()) {
    return c.json({ ...parsed, persisted: false, note: "DATABASE_URL off — pakai /parse/plan utk preview" });
  }
  if (!body.am_id) return c.json({ error: "body.am_id wajib untuk persist" }, 400);
  if (parsed.customers.length === 0) return c.json({ ...parsed, persisted: false }, 400);
  try {
    const deals = await upsertDealsFromPlan(body.am_id, parsed.customers);
    return c.json({ ...parsed, persisted: true, deals }, 201);
  } catch (e) {
    return c.json({ error: "gagal persist deal", detail: String(e) }, 500);
  }
});

app.post("/report", async (c) => {
  let body: { message?: string; am_id?: string; to_stage?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }
  if (typeof body.message !== "string") {
    return c.json({ error: "body.message (string) wajib" }, 400);
  }
  const parsed = parseReport(body.message);
  if (!isDbEnabled()) {
    return c.json({ ...parsed, persisted: false, note: "DATABASE_URL off — pakai /parse/report utk preview" });
  }
  if (!body.am_id) return c.json({ error: "body.am_id wajib untuk persist" }, 400);
  const amId = body.am_id;
  const toStage = body.to_stage;
  try {
    const matched = await logReportToDeals(amId, parsed.items, toStage);
    // Match ambiguous → masuk HITL queue (gate D6), tidak auto-transisi.
    const items = [];
    for (const it of matched) {
      if (it.match.kind === "ambiguous") {
        const hitlId = await enqueueAmbiguous({
          amId,
          item: { customer: it.customer, hasil: it.hasil, next_action: it.next_action },
          candidates: it.match.candidates,
          toStage,
        });
        items.push({ ...it, hitl_id: hitlId });
      } else {
        items.push(it);
      }
    }
    return c.json({ mode: parsed.mode, tanggal: parsed.tanggal, errors: parsed.errors, persisted: true, items }, 201);
  } catch (e) {
    return c.json({ error: "gagal persist report", detail: String(e) }, 500);
  }
});

// ── Dashboard KPI read model ──
app.get("/stats", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const amId = c.req.query("am_id") || undefined;
  return c.json(await getDashboardStats(amId));
});

// ── Digest history (monitor rekap/resume tersimpan) ──
app.get("/digests", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const limit = Math.min(Number(c.req.query("limit") ?? 20) || 20, 100);
  return c.json(await getDigestHistory(limit));
});

// ── AR Aging (D2): feeder Accurate + read model ──
app.post("/ar/invoices", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  let body: { invoices?: InvoiceInput[]; asof?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }
  if (!Array.isArray(body.invoices) || body.invoices.length === 0) {
    return c.json({ error: "body.invoices (array non-kosong) wajib" }, 400);
  }
  return c.json(await ingestInvoices(body.invoices, body.asof), 201);
});

app.get("/ar/aging", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  return c.json(await getAging(c.req.query("bucket") || undefined));
});

// A2 AR Aging Watch agent — analisis ar_aging_mv + log ke audit_log (D6).
app.post("/agents/a2/run", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  return c.json(await runArWatch(), 201);
});

// A3 Sari Collection Drafter — draft pesan penagihan invoice overdue (D2).
// Body opsional: { draft_type: whatsapp|email|formal_letter, limit }.
app.post("/agents/a3/run", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  let body: { draft_type?: string; limit?: number } = {};
  try {
    body = await c.req.json();
  } catch {
    // body opsional — default: whatsapp, limit 10.
  }
  const r = await runCollectionDrafter({ draftType: body.draft_type, limit: body.limit });
  return c.json(r, r.drafted ? 201 : 200);
});

// A4 Pipeline Authenticity — audit keaslian pipeline, eskalasi kritis ke HITL (D1).
app.post("/agents/a4/run", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  return c.json(await runPipelineAuthenticity(), 201);
});

// A5 Anomaly Detection — outlier numerik lintas-domain, eskalasi kritis ke HITL.
app.post("/agents/a5/run", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  return c.json(await runAnomalyDetection(), 201);
});

// A6 Sales Doc Drafter — draft dokumen penjualan (D1). Body opsional:
// { deal_id, doc_type: sph|offering_letter|presentation|mou, limit }.
app.post("/agents/a6/run", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  let body: { deal_id?: string; doc_type?: string; limit?: number } = {};
  try {
    body = await c.req.json();
  } catch {
    // body opsional — default: batch, limit 5.
  }
  const r = await runSalesDocDrafter({
    dealId: body.deal_id,
    docType: body.doc_type,
    limit: body.limit,
  });
  return c.json(r, r.drafted ? 201 : 200);
});

// Read model dokumen penjualan (status: draft|approved|sent).
app.get("/sales/docs", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const docs = await listSalesDocs(c.req.query("status") || undefined);
  return c.json({ count: docs.length, docs });
});

// A7 Product Intelligence — agregasi intelijen produk dari pipeline (D1).
app.post("/agents/a7/run", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  return c.json(await runProductIntelligence(), 201);
});

// Read model intelijen produk (live compute, tanpa audit) untuk UI.
app.get("/products/intelligence", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const products = await getProductIntelligence();
  return c.json({ count: products.length, products });
});

// A8 Sentiment & Entity Extraction — anotasi wa_message (D1b). Body opsional:
// { window_hours, group_jid, limit }.
app.post("/agents/a8/run", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  let body: { window_hours?: number; group_jid?: string; limit?: number } = {};
  try {
    body = await c.req.json();
  } catch {
    // body opsional
  }
  const r = await runSentimentExtraction({
    windowHours: body.window_hours,
    groupJid: body.group_jid,
    limit: body.limit,
  });
  return c.json(r, r.annotated ? 201 : 200);
});

// Read model anotasi (filter sentiment: positive|neutral|negative).
app.get("/messages/annotations", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const annotations = await listAnnotations(c.req.query("sentiment") || undefined);
  return c.json({ count: annotations.length, annotations });
});

// A9 Spider Network Analyst — graf relasi dari anotasi (D1b).
app.post("/agents/a9/run", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  let body: { window_days?: number } = {};
  try {
    body = await c.req.json();
  } catch {
    // body opsional
  }
  return c.json(await runSpiderNetwork({ windowDays: body.window_days }), 201);
});

// Read model graf jaringan (live compute, tanpa audit) untuk visualisasi UI.
app.get("/network/graph", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const days = Number(c.req.query("window_days")) || 30;
  const graph = computeNetwork(await getNetworkInput(days));
  return c.json(graph);
});

// A10 Executive Synthesis — briefing eksekutif lintas-domain (D6).
app.post("/agents/a10/run", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  let body: { period_label?: string } = {};
  try {
    body = await c.req.json();
  } catch {
    // body opsional
  }
  return c.json(await runExecutiveSynthesis({ periodLabel: body.period_label }), 201);
});

// Read model briefing eksekutif.
app.get("/briefings", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const briefings = await listBriefings();
  return c.json({ count: briefings.length, briefings });
});

// A11 Coaching Outcome Synthesis — coaching per AM (D1). Body opsional: { period }.
app.post("/agents/a11/run", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  let body: { period?: string } = {};
  try {
    body = await c.req.json();
  } catch {
    // body opsional
  }
  const r = await runCoachingSynthesis({ period: body.period });
  return c.json(r, r.synthesized ? 201 : 200);
});

// Read model catatan coaching (filter am_id).
app.get("/coaching/notes", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const notes = await listCoachingNotes(c.req.query("am_id") || undefined);
  return c.json({ count: notes.length, notes });
});

// Read model draft penagihan (status: draft|approved|sent).
app.get("/ar/collection-drafts", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const status = c.req.query("status") || undefined;
  const drafts = await listCollectionDrafts(status);
  return c.json({ count: drafts.length, drafts });
});

// Status penjadwal agen (cron in-process) — observabilitas konfigurasi.
app.get("/agents/schedule", (c) => c.json(getScheduleStatus()));

// ── WhatsApp raw store (D1b): feeder pesan mentah → wa_message ──
app.post("/wa/messages", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  let body: { messages?: WaMessageInput[] };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return c.json({ error: "body.messages (array non-kosong) wajib" }, 400);
  }
  return c.json(await ingestWaMessages(body.messages), 201);
});

// A1 Distillation Cascade agent — baca wa_message (raw) → distilasi via
// services/ai (/rekap) → simpan digest_rekap + log ke audit_log (D6/D1b).
app.post("/agents/a1/run", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  let body: { group_jid?: string; window_hours?: number } = {};
  try {
    body = await c.req.json();
  } catch {
    // body opsional — default: semua grup, window 5 jam.
  }
  const r = await runDistillationCascade({
    groupJid: body.group_jid,
    windowHours: body.window_hours,
  });
  return c.json(r, r.distilled ? 201 : 200);
});

// ── Customers read model (diturunkan dari deal) ──
app.get("/customers", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const amId = c.req.query("am_id") || undefined;
  const customers = await getCustomers(amId);
  return c.json({ count: customers.length, customers });
});

// ── Pipeline read model (dashboard): deal per-stage ──
app.get("/pipeline", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const amId = c.req.query("am_id") || undefined;
  return c.json(await getPipeline(amId));
});

// ── HITL gate (D6): antrian konfirmasi untuk match ambiguous ──
app.get("/hitl", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const status = c.req.query("status") ?? "pending";
  const rows = await listHitl(status);
  return c.json({ status, count: rows.length, items: rows });
});

app.post("/hitl/resolve", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  let body: {
    id?: string;
    decision?: "approve" | "reject";
    chosen_deal_id?: string;
    approver_id?: string;
  };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }
  if (!body.id || (body.decision !== "approve" && body.decision !== "reject")) {
    return c.json({ error: "id + decision (approve|reject) wajib" }, 400);
  }
  const r = await resolveHitl(body.id, {
    decision: body.decision,
    chosen_deal_id: body.chosen_deal_id,
    approver_id: body.approver_id,
  });
  return c.json(r, r.ok ? 200 : 400);
});

const port = Number(process.env.PORT ?? 4000);
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`wrg-api listening on http://localhost:${info.port}`);
  startScheduler();
});
