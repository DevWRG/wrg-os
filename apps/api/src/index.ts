import { serve } from "@hono/node-server";
import { Hono } from "hono";
import type { Context } from "hono";
import type { EventEnvelope } from "@wrg/types";
import { isEventEnvelope } from "./envelope.js";

const app = new Hono();

app.get("/health", (c) => c.json({ status: "ok", service: "wrg-api" }));

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
  // TODO: route by event.type → persist / publish ke event bus.
  // Scaffold: terima & echo metadata penting.
  return c.json(
    {
      accepted: true,
      event_id: event.event_id,
      type: event.type,
      correlation_id: event.correlation_id,
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

const port = Number(process.env.PORT ?? 4000);
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`wrg-api listening on http://localhost:${info.port}`);
});
