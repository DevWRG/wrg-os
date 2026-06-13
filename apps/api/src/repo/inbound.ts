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
const REPORT_AUTO_MATCH = 0.7;

interface ReportOutcome {
  n: number;
  matched: number;
  baru: number;
  newItems: string[];
  planExists: boolean;
}

// #REPORT → cocokkan tiap item report vs item #PLAN hari itu (pg_trgm
// GREATEST(similarity, word_similarity(plan,report)) ≥ 0.70 = matched, port
// legacy). Simpan report_data + tandai reported. Return breakdown utk balasan.
async function markReported(
  amId: string,
  amName: string | null,
  tanggal: string,
  items: string[],
  rawBody: string,
): Promise<ReportOutcome> {
  const sql = db();
  const [plan] = await sql`
    SELECT items FROM sales_todo WHERE am_id = ${amId} AND tanggal = ${tanggal}
    ORDER BY submitted_at DESC NULLS LAST LIMIT 1
  `;
  const planItems: string[] = Array.isArray(plan?.items) ? (plan.items as string[]) : [];
  const planArr = planItems.length ? planItems : [""];

  const scored = items.length
    ? await sql`
        SELECT r.item AS task,
          COALESCE((
            SELECT max(greatest(similarity(r.item, p.item), word_similarity(p.item, r.item)))
            FROM unnest(${planArr}::text[]) p(item) WHERE p.item <> ''
          ), 0) AS score
        FROM unnest(${items}::text[]) WITH ORDINALITY r(item, ord)
        ORDER BY r.ord
      `
    : [];
  const rd = scored.map((r) => ({
    task: String(r.task),
    score: Number(r.score),
    matched: Number(r.score) >= REPORT_AUTO_MATCH,
  }));
  const matched = rd.filter((x) => x.matched).length;
  const newItems = rd.filter((x) => !x.matched).map((x) => x.task);

  await sql`
    INSERT INTO sales_todo (am_id, am_name, tanggal, items, raw_body, reported, reported_at, report_data)
    VALUES (${amId}, ${amName}, ${tanggal},
            ${sql.json(items as unknown as Parameters<typeof sql.json>[0])}, ${rawBody},
            true, now(), ${sql.json(rd as unknown as Parameters<typeof sql.json>[0])})
    ON CONFLICT (am_id, tanggal) DO UPDATE SET
      reported = true, reported_at = now(),
      report_data = ${sql.json(rd as unknown as Parameters<typeof sql.json>[0])},
      am_name = COALESCE(EXCLUDED.am_name, sales_todo.am_name)
  `;
  return { n: items.length, matched, baru: newItems.length, newItems, planExists: !!plan };
}

const WD = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MO = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
function fmtTanggalDisplay(tanggal: string): string {
  const d = new Date(`${tanggal.slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return tanggal;
  return `${WD[d.getUTCDay()]}, ${d.getUTCDate()} ${MO[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

function buildReportReply(nama: string, tanggal: string, r: ReportOutcome): string {
  let s = `✅ Report tercatat, ${nama}\n\n📅 ${fmtTanggalDisplay(tanggal)}\n🗒️ ${r.n} tasklist reported\n🎯 Match plan: ${r.matched} ✓`;
  if (r.baru > 0) s += `  ⚠️ Baru : ${r.baru}`;
  if (r.baru > 0) {
    s += `\n━━━━━━━━━━━━━━━━━━━━`;
    for (const it of r.newItems) s += `\n  ⚠️ ${it}`;
  }
  if (!r.planExists) s += `\n⚠️ Tidak ada #PLAN hari ini untuk match.`;
  return s;
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

  // report — cocokkan vs plan + balasan kaya (match/baru)
  const rep = await markReported(am.am_id, am.nama, tanggal, parsed.items, row.body ?? "");
  const reply = await sendViaWaGateway(target, buildReportReply(am.nama, tanggal, rep));
  return finish({ am_id: am.am_id, via: am.via, tanggal, items: rep.n, matched: rep.matched, baru: rep.baru, reply });
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
