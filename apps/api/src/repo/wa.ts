import { createHash } from "node:crypto";

import { db } from "../db.js";

// D1b — raw store WhatsApp. Feeder ingest pesan mentah (dari gateway WA /
// openclaw) ke wa_message; agen A1 (distillation cascade) membacanya per window.

export interface WaMessageInput {
  group_jid: string;
  group_name?: string | null;
  sender_jid?: string | null;
  sender_name?: string | null;
  message_type?: string | null;
  body?: string | null;
  received_at?: string; // ISO; default now()
}

export async function ingestWaMessages(
  messages: WaMessageInput[],
): Promise<{ ingested: number; groups: string[] }> {
  const sql = db();
  const groups = new Set<string>();
  let ingested = 0;
  for (const m of messages) {
    const inputHash = createHash("sha256")
      .update(`${m.group_jid}|${m.sender_jid ?? ""}|${m.received_at ?? ""}|${m.body ?? ""}`)
      .digest("hex");
    await sql`
      INSERT INTO wa_message
        (group_jid, group_name, sender_jid, sender_name, message_type, body, input_hash, received_at)
      VALUES
        (${m.group_jid}, ${m.group_name ?? null}, ${m.sender_jid ?? null},
         ${m.sender_name ?? null}, ${m.message_type ?? "text"}, ${m.body ?? null},
         ${inputHash}, ${m.received_at ?? sql`now()`})
    `;
    groups.add(m.group_jid);
    ingested += 1;
  }
  return { ingested, groups: [...groups] };
}

export interface WaMessageRow {
  group_jid: string;
  group_name: string | null;
  sender_name: string | null;
  sender_jid: string | null;
  body: string | null;
  message_type: string | null;
  ts_ms: number;
}

// Baca pesan dalam window (mundur N jam dari now), opsional filter satu grup.
export async function getWaMessages(
  windowHours = 5,
  groupJid?: string,
): Promise<WaMessageRow[]> {
  const sql = db();
  const rows = await sql`
    SELECT group_jid, group_name, sender_name, sender_jid, body, message_type,
           (extract(epoch FROM received_at) * 1000)::bigint AS ts_ms
    FROM wa_message
    WHERE received_at >= now() - (${windowHours} || ' hours')::interval
      ${groupJid ? sql`AND group_jid = ${groupJid}` : sql``}
    ORDER BY received_at ASC
  `;
  return rows.map((r) => ({
    group_jid: String(r.group_jid),
    group_name: r.group_name ? String(r.group_name) : null,
    sender_name: r.sender_name ? String(r.sender_name) : null,
    sender_jid: r.sender_jid ? String(r.sender_jid) : null,
    body: r.body ? String(r.body) : null,
    message_type: r.message_type ? String(r.message_type) : null,
    ts_ms: Number(r.ts_ms),
  }));
}
