import { db } from "../db.js";

// D6 — log operasional (port legacy delivery_log/email_log/alert_log).
const j = (v: unknown) => v as unknown as Parameters<ReturnType<typeof db>["json"]>[0];

export async function recordDelivery(d: {
  source?: string; to_kind?: string; target?: string; text_preview?: string;
  delivered?: boolean; attempts?: number; message_id_out?: string; error?: string;
}): Promise<{ id: string }> {
  const sql = db();
  const r = await sql`
    INSERT INTO delivery_log (source, to_kind, target, text_preview, delivered, attempts, message_id_out, error)
    VALUES (${d.source ?? null}, ${d.to_kind ?? null}, ${d.target ?? null}, ${d.text_preview ?? null},
            ${d.delivered ?? false}, ${d.attempts ?? 1}, ${d.message_id_out ?? null}, ${d.error ?? null})
    RETURNING id`;
  return { id: String(r[0].id) };
}

export async function recordEmail(e: {
  kind: string; recipients?: unknown[]; subject: string; range_from?: string;
  range_to?: string; delivered?: boolean; message_id?: string; error?: string;
}): Promise<{ id: string }> {
  const sql = db();
  const r = await sql`
    INSERT INTO email_log (kind, recipients, subject, range_from, range_to, delivered, message_id, error)
    VALUES (${e.kind}, ${sql.json(j(e.recipients ?? []))}, ${e.subject}, ${e.range_from ?? null},
            ${e.range_to ?? null}, ${e.delivered ?? false}, ${e.message_id ?? null}, ${e.error ?? null})
    RETURNING id`;
  return { id: String(r[0].id) };
}

export async function recordAlert(a: {
  kind: string; level?: string; title: string; body?: string;
  payload?: unknown; channels_delivered?: unknown[];
}): Promise<{ id: string }> {
  const sql = db();
  const r = await sql`
    INSERT INTO alert_log (kind, level, title, body, payload, channels_delivered)
    VALUES (${a.kind}, ${a.level ?? "info"}, ${a.title}, ${a.body ?? null},
            ${sql.json(j(a.payload ?? {}))}, ${sql.json(j(a.channels_delivered ?? []))})
    RETURNING id`;
  return { id: String(r[0].id) };
}

export async function listLogs(type: "delivery" | "email" | "alert", limit = 50) {
  const sql = db();
  const table = type === "delivery" ? sql`delivery_log` : type === "email" ? sql`email_log` : sql`alert_log`;
  return sql`SELECT * FROM ${table} ORDER BY created_at DESC LIMIT ${limit}`;
}
