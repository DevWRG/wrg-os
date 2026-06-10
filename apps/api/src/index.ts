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
import { insertRekap, insertResume } from "./repo/digest.js";
import { getDashboardStats } from "./repo/stats.js";

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

// Tier AI/data: forward ke services/ai (FastAPI). api = orkestrator domain;
// nanti di-enrich (query DB utk rows) sebelum call ai — sekarang passthrough.
const aiBaseUrl = (): string => process.env.AI_URL ?? "http://localhost:8000";

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

// Call services/ai dan parse JSON (untuk endpoint yang perlu persist hasilnya).
async function callAi(
  aiPath: string,
  body: unknown,
): Promise<{ status: number; data: Record<string, unknown> }> {
  const res = await fetch(`${aiBaseUrl()}${aiPath}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: (await res.json()) as Record<string, unknown> };
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
});
