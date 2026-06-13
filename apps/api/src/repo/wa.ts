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
  media_path?: string | null;
  geo_lat?: number | null;
  geo_lon?: number | null;
  geo_ts?: string | null;
  geo_address?: string | null;
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

// ── WA gateway (openclaw) webhook adapter ──
// Bentuk record mengikuti tap monitor openclaw (lihat legacy/monitor
// reapply-patch.sh): satu objek per pesan inbound.
export interface OpenclawRecord {
  ts?: string; // ISO
  ts_ms?: number;
  chat_type?: string; // "group" | "direct"
  group_jid?: string | null;
  sender?: string | null; // inbound.from (jid asal chat)
  sender_name?: string | null; // pushName
  body?: string | null;
  media_type?: string | null;
  message_id?: string | null;
  fromMe?: boolean;
  // diisi wa-bridge (host) via OCR check_photo_geotag.py utk pesan media image
  media_path?: string | null;
  geo_lat?: number | null;
  geo_lon?: number | null;
  geo_ts?: string | null;
  geo_address?: string | null;
}

function mapOpenclaw(rec: OpenclawRecord): {
  input: WaMessageInput;
  hash: string;
  messageId: string | null;
} | null {
  // Tentukan jid chat: group_jid untuk grup, sender untuk direct.
  const chatJid = rec.group_jid || rec.sender || null;
  const body = rec.body ?? null;
  const media = rec.media_type ?? null;
  // Lewati pesan keluar & yang tak punya konten (tanpa body & tanpa media).
  if (rec.fromMe) return null;
  if (!chatJid) return null;
  if (!body && !media) return null;

  const receivedAt =
    rec.ts ??
    (typeof rec.ts_ms === "number" ? new Date(rec.ts_ms).toISOString() : undefined);

  const input: WaMessageInput = {
    group_jid: String(chatJid),
    group_name: null,
    sender_jid: rec.sender ?? null,
    sender_name: rec.sender_name ?? null,
    message_type: media ?? "text",
    body,
    received_at: receivedAt,
    media_path: rec.media_path ?? null,
    geo_lat: typeof rec.geo_lat === "number" ? rec.geo_lat : null,
    geo_lon: typeof rec.geo_lon === "number" ? rec.geo_lon : null,
    geo_ts: rec.geo_ts ?? null,
    geo_address: rec.geo_address ?? null,
  };
  // Hash stabil → idempoten terhadap retry webhook (pakai message_id bila ada).
  const basis =
    rec.message_id ??
    `${input.group_jid}|${input.sender_jid ?? ""}|${receivedAt ?? ""}|${body ?? ""}`;
  const hash = createHash("sha256").update(`wa:${basis}`).digest("hex");
  return { input, hash, messageId: rec.message_id ?? null };
}

// Ingest record openclaw → wa_message, idempoten by input_hash (skip duplikat).
export async function ingestOpenclawMessages(
  records: OpenclawRecord[],
): Promise<{ ingested: number; skipped: number; groups: string[] }> {
  const sql = db();
  const groups = new Set<string>();
  let ingested = 0;
  let skipped = 0;
  for (const rec of records) {
    const mapped = mapOpenclaw(rec);
    if (!mapped) {
      skipped += 1;
      continue;
    }
    const { input, hash, messageId } = mapped;
    const exists = await sql`SELECT 1 FROM wa_message WHERE input_hash = ${hash} LIMIT 1`;
    if (exists.length > 0) {
      skipped += 1;
      continue;
    }
    await sql`
      INSERT INTO wa_message
        (group_jid, group_name, sender_jid, sender_name, message_type, body, input_hash, received_at, message_id,
         media_path, geo_lat, geo_lon, geo_ts, geo_address)
      VALUES
        (${input.group_jid}, ${input.group_name ?? null}, ${input.sender_jid ?? null},
         ${input.sender_name ?? null}, ${input.message_type ?? "text"}, ${input.body ?? null},
         ${hash}, ${input.received_at ?? sql`now()`}, ${messageId},
         ${input.media_path ?? null}, ${input.geo_lat ?? null}, ${input.geo_lon ?? null},
         ${input.geo_ts ?? null}, ${input.geo_address ?? null})
    `;
    groups.add(input.group_jid);
    ingested += 1;
  }
  return { ingested, skipped, groups: [...groups] };
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
