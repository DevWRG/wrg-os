import { db } from "../db.js";

// D1b — anotasi sentiment/entity (A8). Membaca wa_message yang belum dianotasi
// dalam satu window, lalu menyimpan hasil ekstraksi ke message_annotation.

export interface MessageToAnnotate {
  id: string;
  group_jid: string;
  sender_name: string | null;
  body: string;
}

// Pesan dalam window yang BELUM punya anotasi (idempoten antar-run).
export async function getMessagesToAnnotate(
  windowHours = 24,
  groupJid?: string,
  limit = 50,
): Promise<MessageToAnnotate[]> {
  const sql = db();
  const rows = await sql`
    SELECT w.id, w.group_jid, w.sender_name, w.body
    FROM wa_message w
    WHERE w.received_at >= now() - (${windowHours} || ' hours')::interval
      AND coalesce(w.body, '') <> ''
      ${groupJid ? sql`AND w.group_jid = ${groupJid}` : sql``}
      AND NOT EXISTS (
        SELECT 1 FROM message_annotation a WHERE a.wa_message_id = w.id
      )
    ORDER BY w.received_at ASC
    LIMIT ${limit}
  `;
  return rows.map((r) => ({
    id: String(r.id),
    group_jid: String(r.group_jid),
    sender_name: r.sender_name ? String(r.sender_name) : null,
    body: String(r.body ?? ""),
  }));
}

export interface AnnotationInput {
  wa_message_id: string;
  group_jid: string;
  sender_name: string | null;
  sentiment: string;
  sentiment_score: number;
  entities: { type: string; value: string }[];
  model_used?: string | null;
}

export async function insertAnnotation(a: AnnotationInput): Promise<string> {
  const sql = db();
  const rows = await sql`
    INSERT INTO message_annotation
      (wa_message_id, group_jid, sender_name, sentiment, sentiment_score, entities, generated_by, model_used)
    VALUES
      (${a.wa_message_id}, ${a.group_jid}, ${a.sender_name ?? null}, ${a.sentiment},
       ${a.sentiment_score}, ${sql.json(a.entities as unknown as Parameters<typeof sql.json>[0])},
       'A8', ${a.model_used ?? null})
    RETURNING id
  `;
  return rows[0].id as string;
}

export interface AnnotationRow {
  id: string;
  group_jid: string;
  sender_name: string | null;
  sentiment: string;
  sentiment_score: number;
  entities: { type: string; value: string }[];
  model_used: string | null;
  created_at: string;
}

export async function listAnnotations(
  sentiment?: string,
  limit = 50,
): Promise<AnnotationRow[]> {
  const sql = db();
  const rows = await sql`
    SELECT id, group_jid, sender_name, sentiment, sentiment_score, entities, model_used, created_at::text
    FROM message_annotation
    WHERE ${sentiment ? sql`sentiment = ${sentiment}` : sql`true`}
    ORDER BY created_at DESC
    LIMIT ${limit}
  `;
  return rows.map((r) => ({
    id: String(r.id),
    group_jid: String(r.group_jid),
    sender_name: r.sender_name ? String(r.sender_name) : null,
    sentiment: String(r.sentiment),
    sentiment_score: Number(r.sentiment_score),
    entities: Array.isArray(r.entities) ? (r.entities as { type: string; value: string }[]) : [],
    model_used: r.model_used ? String(r.model_used) : null,
    created_at: String(r.created_at),
  }));
}
