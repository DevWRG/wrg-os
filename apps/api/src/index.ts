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
import {
  ingestInvoices,
  ingestAccurateWebhook,
  getAging,
  type InvoiceInput,
  type AccurateInvoice,
} from "./repo/ar.js";
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
  runPeopleAnalytics,
} from "./repo/agents.js";
import {
  listCollectionDrafts,
  approveCollectionDraft,
  sendCollectionDraft,
  cancelCollectionDraft,
} from "./repo/collection.js";
import {
  listSalesDocs,
  approveSalesDoc,
  sendSalesDoc,
  cancelSalesDoc,
} from "./repo/salesdoc.js";
import { getProductIntelligence } from "./repo/product.js";
import { listAnnotations } from "./repo/sentiment.js";
import { getNetworkInput, computeNetwork } from "./repo/network.js";
import { listBriefings } from "./repo/executive.js";
import { listCoachingNotes } from "./repo/coaching.js";
import { getLatestCoachingNotes, computePeopleAnalytics } from "./repo/people.js";
import { createVisit, listVisits, visitSummary } from "./repo/visit.js";
import { upsertDailyTodo, listTodos, markTodoReported } from "./repo/todo.js";
import { upsertUser, listUsers, upsertTerritory, listTerritories } from "./repo/master.js";
import {
  upsertHoliday,
  listHolidays,
  createLeave,
  listLeave,
  isOnLeave,
  detectLeave,
  deleteHoliday,
  deleteLeave,
  updateLeave,
} from "./repo/leave.js";
import { recordCompetitor, listCompetitor, competitorSummary } from "./repo/competitor.js";
import {
  defaultRange,
  parseRange,
  reportSummary,
  reportPerOrang,
  reportPerDivisi,
  reportPerCabang,
  reportPerHod,
  reportDailyTrend,
  reportDrilldown,
  reportRemindersPending,
  pushReminderToAm,
  reportCalendar,
  reportCalendarDay,
} from "./repo/plandash.js";
import { salesRange, reportRevenue, reportSalesAr } from "./repo/sales.js";
import { upsertMembers, listMembers, upsertDigests, listDigest, upsertPola, listPola, type MonitorMemberInput, type DigestInput, type PolaInput } from "./repo/monitor.js";
import {
  upsertCustomers,
  upsertBranches,
  upsertItems,
  listMirror,
} from "./repo/accurateMirror.js";
import { recordDelivery, recordEmail, recordAlert, listLogs } from "./repo/logs.js";
import { renderSalesDocHtml, renderBriefingHtml } from "./repo/exportdoc.js";
import { runHodDaily } from "./repo/hodreminder.js";
import {
  createReminder,
  updateReminder,
  deleteReminder,
  listReminders,
  runReminders,
  type ReminderMode,
} from "./repo/reminder.js";
import {
  ingestWaMessages,
  ingestOpenclawMessages,
  type WaMessageInput,
  type OpenclawRecord,
} from "./repo/wa.js";
import { aiBaseUrl, callAi } from "./ai.js";
import { startScheduler, getScheduleStatus } from "./scheduler.js";
import { signJwt, verifyJwt } from "./auth.js";
import { verifyCredentials, createUser, countUsers } from "./repo/users.js";

const app = new Hono();

// Auth enforcement (opsional, default MATI). Saat AUTH_ENABLED=true, semua
// endpoint butuh otorisasi KECUALI: /health, /auth/*, /webhooks/* (punya
// secret sendiri). Diterima: x-service-token (BFF tepercaya) ATAU Bearer JWT.
const authEnabled = (): boolean => (process.env.AUTH_ENABLED ?? "").toLowerCase() === "true";
function authExempt(path: string): boolean {
  return path === "/health" || path.startsWith("/auth/") || path.startsWith("/webhooks/");
}
app.use("*", async (c, next) => {
  if (!authEnabled() || authExempt(c.req.path)) return next();
  const svc = process.env.API_SERVICE_TOKEN;
  if (svc && c.req.header("x-service-token") === svc) return next();
  const authz = c.req.header("authorization") ?? "";
  const token = authz.startsWith("Bearer ") ? authz.slice(7) : "";
  if (token && verifyJwt(token)) return next();
  return c.json({ error: "unauthorized" }, 401);
});

app.get("/health", async (c) => {
  const db = isDbEnabled() ? (await pingDb()) ? "ok" : "down" : "disabled";
  return c.json({ status: "ok", service: "wrg-api", db });
});

// ── Auth/session ──
app.post("/auth/login", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  let body: { email?: string; password?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }
  if (!body.email || !body.password) return c.json({ error: "email & password wajib" }, 400);
  const user = await verifyCredentials(body.email, body.password);
  if (!user) return c.json({ error: "kredensial salah" }, 401);
  const token = signJwt({ sub: user.id, email: user.email, role: user.role, name: user.name, title: user.title });
  return c.json({ token, user });
});

app.get("/auth/me", (c) => {
  const authz = c.req.header("authorization") ?? "";
  const token = authz.startsWith("Bearer ") ? authz.slice(7) : "";
  const payload = token ? verifyJwt(token) : null;
  if (!payload) return c.json({ error: "unauthorized" }, 401);
  return c.json({ user: { id: payload.sub, email: payload.email, role: payload.role, name: payload.name ?? null, title: payload.title ?? null } });
});

// Register ops: butuh x-service-token bila API_SERVICE_TOKEN di-set; atau saat
// belum ada user sama sekali (bootstrap admin pertama).
app.post("/auth/register", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const svc = process.env.API_SERVICE_TOKEN;
  const bootstrap = (await countUsers()) === 0;
  if (svc && c.req.header("x-service-token") !== svc && !bootstrap) {
    return c.json({ error: "forbidden" }, 403);
  }
  let body: { email?: string; password?: string; name?: string; role?: string; title?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }
  if (!body.email || !body.password) return c.json({ error: "email & password wajib" }, 400);
  const user = await createUser(body.email, body.password, body.name, body.role ?? "user", body.title);
  return c.json({ user }, 201);
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

// AR (piutang) per customer / cabang / sales — dari accurate_invoice OPEN.
app.get("/ar/sales", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  return c.json(await reportSalesAr(c.req.query("from") || undefined, c.req.query("to") || undefined));
});

// ── WRG Monitor: direktori member WA (port wrg-monitor) ──
app.get("/monitor/members", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const members = await listMembers();
  return c.json({ count: members.length, members });
});

app.post("/monitor/members", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  let body: { members?: MonitorMemberInput[] };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }
  if (!Array.isArray(body.members) || body.members.length === 0) {
    return c.json({ error: "body.members (array non-kosong) wajib" }, 400);
  }
  return c.json({ upserted: await upsertMembers(body.members) }, 201);
});

app.get("/monitor/rekap", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  return c.json(await listDigest("rekap", c.req.query("date") || undefined));
});

app.get("/monitor/resume", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  return c.json(await listDigest("resume", c.req.query("date") || undefined));
});

app.post("/monitor/digests", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  let body: { digests?: DigestInput[] };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }
  if (!Array.isArray(body.digests) || body.digests.length === 0) {
    return c.json({ error: "body.digests (array non-kosong) wajib" }, 400);
  }
  return c.json({ upserted: await upsertDigests(body.digests) }, 201);
});

app.get("/monitor/pola", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  return c.json(await listPola(c.req.query("jid") || undefined));
});

app.post("/monitor/pola", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  let body: { pola?: PolaInput[] };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }
  if (!Array.isArray(body.pola) || body.pola.length === 0) {
    return c.json({ error: "body.pola (array non-kosong) wajib" }, 400);
  }
  return c.json({ upserted: await upsertPola(body.pola) }, 201);
});

// Webhook Accurate → ar_aging_mv. Menerima invoice Accurate (single | array |
// {d} | {data} | {invoices}). Upsert idempoten by customer_id+invoice_no.
// Jika ACCURATE_WEBHOOK_SECRET di-set, header x-accurate-secret wajib cocok.
app.post("/webhooks/accurate", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const secret = process.env.ACCURATE_WEBHOOK_SECRET;
  if (secret && c.req.header("x-accurate-secret") !== secret) {
    return c.json({ error: "unauthorized" }, 401);
  }
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }
  // Normalisasi ke array objek invoice Accurate.
  let records: AccurateInvoice[];
  if (Array.isArray(body)) records = body as AccurateInvoice[];
  else if (body && typeof body === "object") {
    const b = body as { d?: unknown; data?: unknown; invoices?: unknown };
    if (Array.isArray(b.invoices)) records = b.invoices as AccurateInvoice[];
    else if (Array.isArray(b.data)) records = b.data as AccurateInvoice[];
    else if (b.data && typeof b.data === "object") records = [b.data as AccurateInvoice];
    else if (b.d && typeof b.d === "object") records = [b.d as AccurateInvoice];
    else records = [body as AccurateInvoice]; // single invoice object
  } else {
    return c.json({ error: "payload tidak dikenali" }, 400);
  }
  if (records.length === 0) return c.json({ ingested: 0, skipped: 0 });
  const asof = c.req.query("asof") || undefined;
  return c.json(await ingestAccurateWebhook(records, asof), 201);
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

// Read model dokumen penjualan (status: draft|approved|sent|canceled).
app.get("/sales/docs", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const docs = await listSalesDocs(c.req.query("status") || undefined);
  return c.json({ count: docs.length, docs });
});

// Siklus kirim A6 (aksi manusia, Layer 5): approve → send → (atau cancel).
app.post("/sales/docs/:id/approve", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  let body: { approver_id?: string } = {};
  try {
    body = await c.req.json();
  } catch {
    /* body opsional */
  }
  const r = await approveSalesDoc(c.req.param("id"), body.approver_id);
  return c.json(r, r.ok ? 200 : 400);
});

app.post("/sales/docs/:id/send", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  let body: { to?: string; approver_id?: string } = {};
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }
  if (!body.to) return c.json({ error: "body.to (tujuan) wajib" }, 400);
  const r = await sendSalesDoc(c.req.param("id"), body.to, body.approver_id);
  return c.json(r, r.ok ? 200 : 400);
});

app.post("/sales/docs/:id/cancel", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  let body: { approver_id?: string } = {};
  try {
    body = await c.req.json();
  } catch {
    /* body opsional */
  }
  const r = await cancelSalesDoc(c.req.param("id"), body.approver_id);
  return c.json(r, r.ok ? 200 : 400);
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

// A12 People Analytics — rollup SDM tingkat-organisasi dari coaching_note (D6).
app.post("/agents/a12/run", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  return c.json(await runPeopleAnalytics(), 201);
});

// Read model people analytics (live compute, tanpa audit) untuk UI.
app.get("/people/analytics", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  return c.json(computePeopleAnalytics(await getLatestCoachingNotes()));
});

// ── Visit report AM (geotag + foto-URL; port legacy visit_geo/report_photo) ──
app.post("/visits", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  let body: {
    am_id?: string;
    deal_id?: string;
    customer_name?: string;
    photo_url?: string;
    lat?: number;
    lon?: number;
    visit_timestamp?: string;
    visit_date?: string;
    note?: string;
  };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }
  if (!body.am_id) return c.json({ error: "am_id wajib" }, 400);
  const r = await createVisit({
    am_id: body.am_id,
    deal_id: body.deal_id,
    customer_name: body.customer_name,
    photo_url: body.photo_url,
    lat: body.lat,
    lon: body.lon,
    visit_timestamp: body.visit_timestamp,
    visit_date: body.visit_date,
    note: body.note,
  });
  return c.json(r, 201);
});

// Read model visit (filter geo_status: ok|out_of_bounds|no_geo|date_mismatch).
app.get("/visits", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const visits = await listVisits(c.req.query("status") || undefined);
  return c.json({ count: visits.length, visits });
});

// Brief kepatuhan geotag (per-status + flagged).
app.get("/visits/summary", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  return c.json(await visitSummary());
});

// ── Daily TODO/plan per AM (port legacy sales_todo) ──
app.post("/todos", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  let body: { am_id?: string; am_name?: string; tanggal?: string; items?: string[]; raw_body?: string; is_late_plan?: boolean };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }
  if (!body.am_id || !body.tanggal || !Array.isArray(body.items)) {
    return c.json({ error: "am_id, tanggal (YYYY-MM-DD), items[] wajib" }, 400);
  }
  const r = await upsertDailyTodo({
    am_id: body.am_id,
    am_name: body.am_name,
    tanggal: body.tanggal,
    items: body.items,
    raw_body: body.raw_body,
    is_late_plan: body.is_late_plan,
  });
  return c.json(r, 201);
});

app.get("/todos", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const todos = await listTodos(c.req.query("am_id") || undefined, c.req.query("date") || undefined);
  return c.json({ count: todos.length, todos });
});

// Tandai plan harian sudah di-#REPORT (am_id + tanggal).
app.post("/todos/report", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  let body: { am_id?: string; tanggal?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }
  if (!body.am_id || !body.tanggal) return c.json({ error: "am_id + tanggal wajib" }, 400);
  const r = await markTodoReported(body.am_id, body.tanggal);
  return c.json(r, r.ok ? 200 : 404);
});

// ── Master data CRM: user/AM roster + territory (port legacy master_*) ──
app.post("/master/users", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  let body: {
    am_id?: string; nama?: string; panggilan?: string; wa_number?: string;
    role?: string; posisi?: string; cabang?: string; area?: string;
    aktif?: boolean; wajib_plan_report?: boolean;
  };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }
  if (!body.am_id || !body.nama) return c.json({ error: "am_id + nama wajib" }, 400);
  return c.json(await upsertUser({ am_id: body.am_id, nama: body.nama, panggilan: body.panggilan, wa_number: body.wa_number, role: body.role, posisi: body.posisi, cabang: body.cabang, area: body.area, aktif: body.aktif, wajib_plan_report: body.wajib_plan_report }), 201);
});

app.get("/master/users", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const aktifQ = c.req.query("aktif");
  const users = await listUsers({
    role: c.req.query("role") || undefined,
    aktif: aktifQ === undefined ? undefined : aktifQ === "true",
  });
  return c.json({ count: users.length, users });
});

app.post("/master/territories", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  let body: { am_panggilan?: string; hod_panggilan?: string; cabang?: string; kota?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }
  if (!body.am_panggilan || !body.hod_panggilan || !body.cabang || !body.kota) {
    return c.json({ error: "am_panggilan, hod_panggilan, cabang, kota wajib" }, 400);
  }
  return c.json(await upsertTerritory({ am_panggilan: body.am_panggilan, hod_panggilan: body.hod_panggilan, cabang: body.cabang, kota: body.kota }), 201);
});

app.get("/master/territories", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const territories = await listTerritories();
  return c.json({ count: territories.length, territories });
});

// ── Leave/cuti + holiday (port legacy user_leave + master_holiday) ──
app.post("/holidays", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  let body: { tanggal?: string; keterangan?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }
  if (!body.tanggal || !body.keterangan) return c.json({ error: "tanggal + keterangan wajib" }, 400);
  return c.json(await upsertHoliday(body.tanggal, body.keterangan), 201);
});

app.get("/holidays", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const holidays = await listHolidays();
  return c.json({ count: holidays.length, holidays });
});

app.delete("/holidays/:id", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const r = await deleteHoliday(c.req.param("id"));
  return c.json(r, r.deleted ? 200 : 404);
});

app.post("/leave", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  let body: { am_id?: string; start_date?: string; end_date?: string; jenis?: string; keterangan?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }
  if (!body.am_id || !body.start_date || !body.end_date || !body.jenis) {
    return c.json({ error: "am_id, start_date, end_date, jenis(sakit|cuti|ijin) wajib" }, 400);
  }
  if (!["sakit", "cuti", "ijin"].includes(body.jenis)) {
    return c.json({ error: "jenis harus sakit|cuti|ijin" }, 400);
  }
  return c.json(
    await createLeave({
      am_id: body.am_id,
      start_date: body.start_date,
      end_date: body.end_date,
      jenis: body.jenis as "sakit" | "cuti" | "ijin",
      keterangan: body.keterangan,
    }),
    201,
  );
});

app.get("/leave", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const leave = await listLeave(c.req.query("am_id") || undefined);
  return c.json({ count: leave.length, leave });
});

app.patch("/leave/:id", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  let body: { start_date?: string; end_date?: string; jenis?: string; keterangan?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }
  if (body.jenis && !["sakit", "cuti", "ijin"].includes(body.jenis)) {
    return c.json({ error: "jenis harus sakit|cuti|ijin" }, 400);
  }
  const r = await updateLeave(c.req.param("id"), {
    start_date: body.start_date,
    end_date: body.end_date,
    jenis: body.jenis as "sakit" | "cuti" | "ijin" | undefined,
    keterangan: body.keterangan,
  });
  return c.json(r, r.updated ? 200 : 404);
});

app.delete("/leave/:id", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const r = await deleteLeave(c.req.param("id"));
  return c.json(r, r.deleted ? 200 : 404);
});

// Cek apakah AM sedang cuti/libur pada tanggal tertentu (untuk exempt reminder).
app.get("/leave/check", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const amId = c.req.query("am_id");
  const date = c.req.query("date");
  if (!amId || !date) return c.json({ error: "am_id + date wajib" }, 400);
  return c.json(await isOnLeave(amId, date));
});

// Auto-deteksi cuti dari teks bebas (keyword + tanggal).
app.post("/leave/detect", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  let body: { am_id?: string; text?: string; date?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }
  if (!body.am_id || !body.text) return c.json({ error: "am_id + text wajib" }, 400);
  const r = await detectLeave(body.am_id, body.text, body.date);
  return c.json(r, r.detected ? 201 : 200);
});

// ── Competitor intelligence (port legacy competitor_intel) ──
app.post("/competitor", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  let body: {
    am_id?: string; customer_name?: string; tanggal?: string; vendor?: string;
    produk?: string; produk_kategori?: string; harga_text?: string; harga_numeric?: number; konteks?: string;
  };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }
  if (!body.tanggal || !body.vendor) return c.json({ error: "tanggal + vendor wajib" }, 400);
  return c.json(
    await recordCompetitor({
      am_id: body.am_id, customer_name: body.customer_name, tanggal: body.tanggal,
      vendor: body.vendor, produk: body.produk, produk_kategori: body.produk_kategori,
      harga_text: body.harga_text, harga_numeric: body.harga_numeric, konteks: body.konteks,
    }),
    201,
  );
});

app.get("/competitor", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const items = await listCompetitor(c.req.query("vendor") || undefined);
  return c.json({ count: items.length, items });
});

app.get("/competitor/summary", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const summary = await competitorSummary();
  return c.json({ count: summary.length, summary });
});

// ── Plan & Report dashboard (replikasi WRG-CRM Adminator) ──
app.get("/report/range-default", (c) => c.json(defaultRange()));

app.get("/report/summary", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const { from, to } = parseRange(c.req.query("from"), c.req.query("to"));
  return c.json(await reportSummary(from, to));
});

app.get("/report/per-orang", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const { from, to } = parseRange(c.req.query("from"), c.req.query("to"));
  const rows = await reportPerOrang(from, to);
  return c.json({ from, to, count: rows.length, rows });
});

app.get("/report/per-divisi", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const { from, to } = parseRange(c.req.query("from"), c.req.query("to"));
  return c.json({ from, to, rows: await reportPerDivisi(from, to) });
});

app.get("/report/per-cabang", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const { from, to } = parseRange(c.req.query("from"), c.req.query("to"));
  return c.json({ from, to, rows: await reportPerCabang(from, to) });
});

app.get("/report/per-hod", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const { from, to } = parseRange(c.req.query("from"), c.req.query("to"));
  return c.json({ from, to, rows: await reportPerHod(from, to) });
});

app.get("/report/daily-trend", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const { from, to } = parseRange(c.req.query("from"), c.req.query("to"));
  return c.json({ from, to, days: await reportDailyTrend(from, to) });
});

app.get("/report/drilldown", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const amId = c.req.query("am_id");
  if (!amId) return c.json({ error: "am_id wajib" }, 400);
  const { from, to } = parseRange(c.req.query("from"), c.req.query("to"));
  return c.json({ from, to, detail: await reportDrilldown(amId, from, to) });
});

// Sales Calendar: agregat plan/report per (tanggal, AM) + libur + katalog AM
// untuk filter. from/to = rentang grid kalender (mis. awal–akhir 6 minggu).
app.get("/report/calendar", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const { from, to } = parseRange(c.req.query("from"), c.req.query("to"));
  const amId = c.req.query("am_id") || undefined;
  const cabang = c.req.query("cabang") || undefined;
  return c.json(await reportCalendar(from, to, amId, cabang));
});

// Drilldown harian Sales Calendar: per-AM + daftar plan (customer/hasil).
app.get("/report/calendar/day", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const date = c.req.query("date") || defaultRange().today;
  const amId = c.req.query("am_id") || undefined;
  const cabang = c.req.query("cabang") || undefined;
  return c.json(await reportCalendarDay(date, amId, cabang));
});

// Push WA nudge ke satu AM (dari panel reminder dashboard). Stub di dev.
app.post("/report/reminders/push", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  let body: { am_id?: string; kind?: string; date?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }
  if (!body.am_id) return c.json({ error: "am_id wajib" }, 400);
  const kind = (["am", "todo", "zero"] as const).includes(body.kind as "am" | "todo" | "zero")
    ? (body.kind as "am" | "todo" | "zero")
    : "am";
  const date = body.date || defaultRange().today;
  const r = await pushReminderToAm(body.am_id, kind, date);
  return c.json(r, r.sent ? 200 : 502);
});

app.get("/report/reminders-pending", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const date = c.req.query("date") || defaultRange().today;
  return c.json(await reportRemindersPending(date));
});

// Sales Performance (revenue dari accurate_invoice). Default = year-to-date.
app.get("/sales/revenue", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const { from, to } = salesRange(c.req.query("from"), c.req.query("to"));
  return c.json(await reportRevenue(from, to));
});

// ── Accurate master mirror (port legacy accurate_customer/item/branch) ──
async function accBody<T>(c: Context): Promise<T[] | null> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return null;
  }
  if (Array.isArray(body)) return body as T[];
  const b = body as { records?: unknown; data?: unknown };
  if (Array.isArray(b.records)) return b.records as T[];
  if (Array.isArray(b.data)) return b.data as T[];
  return null;
}

app.post("/accurate/customers", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const recs = await accBody<{ id: number; no?: string; name?: string; branch_id?: number; raw?: unknown }>(c);
  if (!recs) return c.json({ error: "body array / {records|data:[...]} wajib" }, 400);
  return c.json({ upserted: await upsertCustomers(recs) }, 201);
});

app.post("/accurate/branches", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const recs = await accBody<{ id: number; name?: string; suspended?: boolean; raw?: unknown }>(c);
  if (!recs) return c.json({ error: "body array / {records|data:[...]} wajib" }, 400);
  return c.json({ upserted: await upsertBranches(recs) }, 201);
});

app.post("/accurate/items", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const recs = await accBody<{ id: number; no?: string; name?: string; category?: string; unit_price?: number; raw?: unknown }>(c);
  if (!recs) return c.json({ error: "body array / {records|data:[...]} wajib" }, 400);
  return c.json({ upserted: await upsertItems(recs) }, 201);
});

app.get("/accurate/:entity", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const entity = c.req.param("entity");
  if (entity !== "customers" && entity !== "items" && entity !== "branches") {
    return c.json({ error: "entity harus customers|items|branches" }, 400);
  }
  const rows = await listMirror(entity);
  return c.json({ entity, count: rows.length, rows });
});

// ── Log operasional: delivery / email / alert (port legacy *_log) ──
app.post("/logs/delivery", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  let b: Record<string, unknown> = {};
  try { b = await c.req.json(); } catch { return c.json({ error: "invalid JSON body" }, 400); }
  return c.json(await recordDelivery(b as Parameters<typeof recordDelivery>[0]), 201);
});

app.post("/logs/email", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  let b: { kind?: string; subject?: string } = {};
  try { b = await c.req.json(); } catch { return c.json({ error: "invalid JSON body" }, 400); }
  if (!b.kind || !b.subject) return c.json({ error: "kind + subject wajib" }, 400);
  return c.json(await recordEmail(b as Parameters<typeof recordEmail>[0]), 201);
});

app.post("/logs/alert", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  let b: { kind?: string; title?: string } = {};
  try { b = await c.req.json(); } catch { return c.json({ error: "invalid JSON body" }, 400); }
  if (!b.kind || !b.title) return c.json({ error: "kind + title wajib" }, 400);
  return c.json(await recordAlert(b as Parameters<typeof recordAlert>[0]), 201);
});

app.get("/logs/:type", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const type = c.req.param("type");
  if (type !== "delivery" && type !== "email" && type !== "alert") {
    return c.json({ error: "type harus delivery|email|alert" }, 400);
  }
  const rows = await listLogs(type);
  return c.json({ type, count: rows.length, rows });
});

// ── Export dokumen → HTML siap-print (port legacy export_pdf, tanpa lib PDF) ──
app.get("/export/sales-doc/:id", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const html = await renderSalesDocHtml(c.req.param("id"));
  if (!html) return c.json({ error: "dokumen tidak ditemukan" }, 404);
  return c.html(html);
});

app.get("/export/briefing/:id", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const html = await renderBriefingHtml(c.req.param("id"));
  if (!html) return c.json({ error: "briefing tidak ditemukan" }, 404);
  return c.html(html);
});

// HOD daily reminder — rekap kepatuhan plan/report (port cron_hod_daily_reminder).
app.post("/reminders/hod/run", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  let body: { to?: string } = {};
  try {
    body = await c.req.json();
  } catch {
    /* body opsional */
  }
  return c.json(await runHodDaily(body.to), 201);
});

// Read model draft penagihan (status: draft|approved|sent|canceled).
app.get("/ar/collection-drafts", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const status = c.req.query("status") || undefined;
  const drafts = await listCollectionDrafts(status);
  return c.json({ count: drafts.length, drafts });
});

// Siklus kirim A3 (aksi manusia, Layer 5): approve → send → (atau cancel).
app.post("/ar/collection-drafts/:id/approve", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  let body: { approver_id?: string } = {};
  try {
    body = await c.req.json();
  } catch {
    /* body opsional */
  }
  const r = await approveCollectionDraft(c.req.param("id"), body.approver_id);
  return c.json(r, r.ok ? 200 : 400);
});

app.post("/ar/collection-drafts/:id/send", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  let body: { to?: string; approver_id?: string } = {};
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }
  if (!body.to) return c.json({ error: "body.to (tujuan WA) wajib" }, 400);
  const r = await sendCollectionDraft(c.req.param("id"), body.to, body.approver_id);
  return c.json(r, r.ok ? 200 : 400);
});

app.post("/ar/collection-drafts/:id/cancel", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  let body: { approver_id?: string } = {};
  try {
    body = await c.req.json();
  } catch {
    /* body opsional */
  }
  const r = await cancelCollectionDraft(c.req.param("id"), body.approver_id);
  return c.json(r, r.ok ? 200 : 400);
});

// ── CRM reminder AM (port legacy am_reminder) ──
app.post("/reminders", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  let body: { am_id?: string; am_name?: string; reminder_date?: string; note?: string; customer_name?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }
  if (!body.am_id || !body.reminder_date || !body.note) {
    return c.json({ error: "am_id, reminder_date (YYYY-MM-DD), note wajib" }, 400);
  }
  const id = await createReminder({
    am_id: body.am_id,
    am_name: body.am_name,
    reminder_date: body.reminder_date,
    note: body.note,
    customer_name: body.customer_name,
  });
  return c.json({ id }, 201);
});

app.patch("/reminders/:id", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  let body: { am_name?: string; reminder_date?: string; note?: string; customer_name?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }
  const r = await updateReminder(c.req.param("id"), {
    am_name: body.am_name,
    reminder_date: body.reminder_date,
    note: body.note,
    customer_name: body.customer_name,
  });
  return c.json(r, r.updated ? 200 : 404);
});

app.delete("/reminders/:id", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const r = await deleteReminder(c.req.param("id"));
  return c.json(r, r.deleted ? 200 : 404);
});

app.get("/reminders", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const reminders = await listReminders();
  return c.json({ count: reminders.length, reminders });
});

// Fire reminder due untuk mode (h | h-minus-1). Body opsional { to }.
app.post("/reminders/run", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  let body: { mode?: string; to?: string } = {};
  try {
    body = await c.req.json();
  } catch {
    /* body opsional */
  }
  const mode: ReminderMode = body.mode === "h-minus-1" ? "h-minus-1" : "h";
  const r = await runReminders(mode, body.to);
  return c.json(r, r.count > 0 ? 201 : 200);
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

// Webhook gateway WA (openclaw) → wa_message. Menerima record format tap
// openclaw (single | array | {messages:[...]} | {events:[...]}). Idempoten
// (skip duplikat by input_hash). Jika WA_WEBHOOK_SECRET di-set, header
// x-wa-secret wajib cocok.
app.post("/webhooks/wa", async (c) => {
  if (!isDbEnabled()) return c.json({ error: "DATABASE_URL off" }, 503);
  const secret = process.env.WA_WEBHOOK_SECRET;
  if (secret && c.req.header("x-wa-secret") !== secret) {
    return c.json({ error: "unauthorized" }, 401);
  }
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }
  // Normalisasi ke array record openclaw.
  let records: OpenclawRecord[];
  if (Array.isArray(body)) records = body as OpenclawRecord[];
  else if (body && typeof body === "object") {
    const b = body as { messages?: unknown; events?: unknown };
    if (Array.isArray(b.messages)) records = b.messages as OpenclawRecord[];
    else if (Array.isArray(b.events)) records = b.events as OpenclawRecord[];
    else records = [body as OpenclawRecord]; // single record
  } else {
    return c.json({ error: "payload tidak dikenali" }, 400);
  }
  if (records.length === 0) return c.json({ ingested: 0, skipped: 0, groups: [] });
  return c.json(await ingestOpenclawMessages(records), 201);
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
