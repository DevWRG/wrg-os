import { db } from "../db.js";
import { detectDaily, parseDaily } from "../parsers/dailyplan.js";
import { sendViaWaGateway, type WaSendResult } from "../wasend.js";
import { resolveSender } from "./master.js";
import { upsertDailyTodo } from "./todo.js";

// Pemrosesan inbound WA (#PLAN/#REPORT/#LEADS/#UPDATE) — pengganti legacy
// wrg-inbound.sh. Format NYATA tim (lihat parsers/dailyplan.ts): #plan/#report
// + nama + daftar bernomor (TODO harian). Alur: resolve pengirim → parse →
// sales_todo → balas grup.
//
// GATED: hanya jalan bila WA_INBOUND_PROCESS=true. Balasan via sendViaWaGateway
// → patuh WA_DRY_RUN. Idempoten: wa_message.processed_at. Pengirim tak dikenal →
// SILENT (tak balas) supaya tak spam non-AM/pesan bot di grup campuran.

export type InboundKind = "plan" | "report" | "leads" | "update" | "none";

const LEADS_UPDATE_LINE = /^\s*#\s*(leads|update)\b/i;

export function detectKind(body: string | null): InboundKind {
  const daily = detectDaily(body); // line-anchored #plan/#report
  if (daily) return daily;
  if (body) {
    for (const line of body.split(/\r?\n/)) {
      const m = line.match(LEADS_UPDATE_LINE);
      if (m) return m[1].toLowerCase() as "leads" | "update";
    }
  }
  return "none";
}

export function isInboundEnabled(): boolean {
  return (process.env.WA_INBOUND_PROCESS ?? "false").toLowerCase() === "true";
}

const wibDate = (): string => new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);

function allowedGroups(): string[] {
  return (process.env.WA_INBOUND_GROUPS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}
function groupAllowed(jid: string): boolean {
  const g = allowedGroups();
  return g.length === 0 || g.includes(jid);
}

export interface WaRow {
  id: string;
  group_jid: string;
  sender_jid: string | null;
  sender_name: string | null;
  body: string | null;
  message_type: string | null;
  message_id: string | null;
  received_at: string;
}

// #REPORT → tandai sales_todo hari itu reported + simpan report_data. Buat baris
// bila plan hari itu belum ada (report tanpa plan).
async function markReported(
  amId: string,
  amName: string | null,
  tanggal: string,
  items: string[],
  rawBody: string,
): Promise<void> {
  const sql = db();
  await sql`
    INSERT INTO sales_todo (am_id, am_name, tanggal, items, raw_body, reported, reported_at, report_data)
    VALUES (${amId}, ${amName}, ${tanggal},
            ${sql.json(items as unknown as Parameters<typeof sql.json>[0])}, ${rawBody},
            true, now(), ${sql.json({ items } as unknown as Parameters<typeof sql.json>[0])})
    ON CONFLICT (am_id, tanggal) DO UPDATE SET
      reported = true, reported_at = now(),
      report_data = ${sql.json({ items } as unknown as Parameters<typeof sql.json>[0])},
      am_name = COALESCE(EXCLUDED.am_name, sales_todo.am_name)
  `;
}

// Proses SATU pesan; selalu tandai processed_at (idempoten). Pengirim tak dikenal
// / non-submission → SILENT.
export async function processInboundMessage(row: WaRow): Promise<Record<string, unknown>> {
  const sql = db();
  const kind = detectKind(row.body);
  const finish = async (result: Record<string, unknown>): Promise<Record<string, unknown>> => {
    await sql`
      UPDATE wa_message SET processed_at = now(), processed_kind = ${kind},
        processed_result = ${sql.json(result as unknown as Parameters<typeof sql.json>[0])}
      WHERE id = ${row.id}
    `;
    return { id: row.id, kind, ...result };
  };

  if (kind === "none") return finish({ skipped: "no-hashtag" });
  const target = row.group_jid;

  // #LEADS/#UPDATE — tanpa body-name; resolve by phone/pushname saja.
  if (kind === "leads" || kind === "update") {
    const amx = await resolveSender({ senderJid: row.sender_jid, pushname: row.sender_name });
    if (!amx) return finish({ skipped: "unknown-sender", sender_name: row.sender_name });
    const reply = await sendViaWaGateway(target, `ℹ️ #${kind.toUpperCase()} belum tersedia di wrg-os (menyusul).`);
    return finish({ note: "not-implemented", via: amx.via, reply });
  }

  // #PLAN/#REPORT — parse DULU (body-name dibutuhkan untuk resolusi Tier-A).
  const parsed = parseDaily(row.body ?? "");
  const am = await resolveSender({
    bodyName: parsed?.name ?? null,
    senderJid: row.sender_jid,
    pushname: row.sender_name,
  });
  // Pengirim tak dikenal / nonaktif → SILENT (tak balas).
  if (!am) return finish({ skipped: "unknown-sender", sender_name: row.sender_name });
  if (!am.aktif) return finish({ skipped: "inactive", am_id: am.am_id });

  if (!parsed || parsed.itemCount === 0) {
    // submission terdeteksi tapi tak ada item → kemungkinan salah format (hint).
    const reply = await sendViaWaGateway(
      target,
      `⚠️ ${kind === "plan" ? "Plan" : "Report"} terdeteksi tapi item kosong, ${am.nama}. Pakai daftar bernomor (1. 2. 3. …).`,
    );
    return finish({ error: "empty-items", via: am.via, reply });
  }
  const tanggal = parsed.tanggal ?? wibDate();

  if (kind === "plan") {
    const r = await upsertDailyTodo({
      am_id: am.am_id,
      am_name: am.nama,
      tanggal,
      items: parsed.items,
      raw_body: row.body ?? undefined,
      role: am.role,
      submitted_at: row.received_at,
    });
    const reply = await sendViaWaGateway(
      target,
      `✅ Plan tercatat, ${am.nama} — ${r.total_items} item — ${tanggal}${r.is_late_plan ? " (telat)" : ""}`,
    );
    return finish({ am_id: am.am_id, via: am.via, tanggal, total_items: r.total_items, todo_id: r.id, reply });
  }

  // report
  await markReported(am.am_id, am.nama, tanggal, parsed.items, row.body ?? "");
  const reply = await sendViaWaGateway(
    target,
    `✅ Report tercatat, ${am.nama} — ${parsed.itemCount} item — ${tanggal}`,
  );
  return finish({ am_id: am.am_id, via: am.via, tanggal, items: parsed.itemCount, reply });
}

// Proses batch pesan wa_message yang belum diproses & mengandung hashtag.
export async function processUnprocessed(
  limit = 50,
): Promise<{ enabled: boolean; processed: number; replied: number; results: Record<string, unknown>[] }> {
  if (!isInboundEnabled()) {
    return { enabled: false, processed: 0, replied: 0, results: [] };
  }
  const sql = db();
  const rows = await sql`
    SELECT id::text, group_jid, sender_jid, sender_name, body, message_type, message_id, received_at::text
    FROM wa_message
    WHERE processed_at IS NULL AND body ~* '#\\s*(plan|report|leads|update)'
    ORDER BY received_at ASC LIMIT ${limit}
  `;
  const results: Record<string, unknown>[] = [];
  let processed = 0;
  let replied = 0;
  for (const r of rows) {
    if (!groupAllowed(String(r.group_jid))) {
      await sql`UPDATE wa_message SET processed_at = now(), processed_kind = 'group-skip' WHERE id = ${r.id}`;
      continue;
    }
    const out = await processInboundMessage(r as unknown as WaRow);
    results.push(out);
    processed += 1;
    const reply = out.reply as WaSendResult | undefined;
    if (reply?.sent) replied += 1;
  }
  return { enabled: true, processed, replied, results };
}
