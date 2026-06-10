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
import { upsertDealsFromPlan, logReportToDeals } from "./repo/deal.js";

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

app.post("/daily-summary", (c) => forwardToAi(c, "/daily-summary"));
app.post("/rekap", (c) => forwardToAi(c, "/rekap"));
app.post("/resume", (c) => forwardToAi(c, "/resume"));

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
  try {
    const items = await logReportToDeals(body.am_id, parsed.items, body.to_stage);
    return c.json({ mode: parsed.mode, tanggal: parsed.tanggal, errors: parsed.errors, persisted: true, items }, 201);
  } catch (e) {
    return c.json({ error: "gagal persist report", detail: String(e) }, 500);
  }
});

const port = Number(process.env.PORT ?? 4000);
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`wrg-api listening on http://localhost:${info.port}`);
});
