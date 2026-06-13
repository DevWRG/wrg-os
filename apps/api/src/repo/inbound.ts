import { db } from "../db.js";
import { parsePlan } from "../parsers/plan.js";
import { parseReport } from "../parsers/report.js";
import { sendViaWaGateway, type WaSendResult } from "../wasend.js";
import { resolveAmByWa } from "./master.js";
import { upsertDailyTodo } from "./todo.js";
import { upsertDealsFromPlan, logReportToDeals } from "./deal.js";

// Pemrosesan inbound WA (#PLAN/#REPORT/#LEADS/#UPDATE) — pengganti legacy
// wrg-inbound.sh. Alur: resolve pengirim → parse → persist (sales_plan /
// sales_todo / activity_log + deal) → balas grup via gateway WA.
//
// GATED: hanya jalan bila WA_INBOUND_PROCESS=true. Balasan lewat sendViaWaGateway
// → patuh WA_DRY_RUN (default dry-run, tidak kirim live). Idempoten: tiap
// wa_message ditandai processed_at setelah diproses (tak diproses ulang).
//
// Belum diport (butuh infra/metadata gateway): geotag foto, OCR caption, link
// foto→visit, handler #LEADS/#UPDATE (saat ini dibalas "belum tersedia").

export type InboundKind = "plan" | "report" | "leads" | "update" | "none";

const HASHTAG = /#(plan|report|leads|update)\b/i;

export function detectKind(body: string | null): InboundKind {
  if (!body) return "none";
  const m = body.match(HASHTAG);
  return m ? (m[1].toLowerCase() as InboundKind) : "none";
}

export function isInboundEnabled(): boolean {
  return (process.env.WA_INBOUND_PROCESS ?? "false").toLowerCase() === "true";
}

const wibNow = (): Date => new Date(Date.now() + 7 * 3600 * 1000);
const wibDate = (): string => wibNow().toISOString().slice(0, 10);
const wibWall = (): string => wibNow().toISOString().slice(0, 16); // YYYY-MM-DDTHH:MM

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

// ── writer: sales_plan (satu baris per customer, seq per am/tanggal) ──
async function insertSalesPlan(
  amId: string,
  tanggal: string,
  customers: { customer: string; tujuan: string; goal: string }[],
  isLate: boolean,
): Promise<number[]> {
  const sql = db();
  const [{ maxseq }] = await sql`
    SELECT COALESCE(max(seq), 0) AS maxseq FROM sales_plan WHERE am_id = ${amId} AND tanggal = ${tanggal}
  `;
  let seq = Number(maxseq);
  const ids: number[] = [];
  for (const c of customers) {
    seq += 1;
    const rows = await sql`
      INSERT INTO sales_plan (am_id, tanggal, customer_name, tujuan, goal, seq, is_late_plan, submitted_at)
      VALUES (${amId}, ${tanggal}, ${c.customer}, ${c.tujuan || null}, ${c.goal || null},
              ${seq}, ${isLate}, now())
      RETURNING id
    `;
    ids.push(Number(rows[0].id));
  }
  return ids;
}

// ── writer: activity_log (satu baris per item report) + tandai plan reported ──
async function insertActivities(
  amId: string,
  tanggal: string,
  items: { customer: string; hasil: string; next_action: string }[],
  messageId: string | null,
): Promise<{ matched: number; ids: number[] }> {
  const sql = db();
  const ids: number[] = [];
  let matched = 0;
  for (const it of items) {
    // Fuzzy-match ke sales_plan customer hari itu (pg_trgm; sama spt logReportToDeals).
    const cands = await sql`
      SELECT id, similarity(customer_name, ${it.customer}) AS score
      FROM sales_plan
      WHERE am_id = ${amId} AND tanggal = ${tanggal}
        AND similarity(customer_name, ${it.customer}) > 0.3
      ORDER BY score DESC LIMIT 1
    `;
    const planId = cands[0] ? Number(cands[0].id) : null;
    const score = cands[0] ? Number(cands[0].score) : null;
    const rows = await sql`
      INSERT INTO activity_log
        (am_id, plan_id, tanggal, customer_name, hasil, next_action, source, is_unmatched, match_score, message_id)
      VALUES
        (${amId}, ${planId}, ${tanggal}, ${it.customer}, ${it.hasil || null}, ${it.next_action || null},
         'wa-inbound', ${planId === null}, ${score}, ${messageId})
      RETURNING id
    `;
    const actId = Number(rows[0].id);
    ids.push(actId);
    if (planId !== null) {
      matched += 1;
      await sql`
        UPDATE sales_plan SET reported = true, reported_at = now(), activity_id = ${actId}
        WHERE id = ${planId} AND reported = false
      `;
    }
  }
  return { matched, ids };
}

function senderWaFromJid(jid: string | null): string {
  if (!jid) return "";
  return jid.split("@")[0].split(":")[0];
}

// Proses SATU pesan; selalu tandai processed_at (idempoten). Mengembalikan ringkasan.
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

  const am = await resolveAmByWa(senderWaFromJid(row.sender_jid));
  const target = row.group_jid;
  if (!am) {
    const reply = await sendViaWaGateway(target, "❌ Nomor kamu belum terdaftar di sistem WRG OS. Hubungi admin.");
    return finish({ error: "unknown-sender", reply });
  }
  if (!am.aktif) {
    const reply = await sendViaWaGateway(target, "❌ Akun kamu sedang nonaktif. Hubungi admin.");
    return finish({ error: "inactive", reply });
  }

  if (kind === "leads" || kind === "update") {
    const reply = await sendViaWaGateway(target, `ℹ️ #${kind.toUpperCase()} belum tersedia di wrg-os (menyusul).`);
    return finish({ note: "not-implemented", reply });
  }

  if (kind === "plan") {
    const parsed = parsePlan(row.body ?? "", { now: wibWall() });
    if (parsed.errors.length > 0 || parsed.customers.length === 0) {
      const reply = await sendViaWaGateway(
        target,
        `⚠️ Plan gagal diproses: ${parsed.errors.join("; ") || "format tidak dikenali"}`,
      );
      return finish({ error: "parse", errors: parsed.errors, reply });
    }
    const tanggal = parsed.tanggal ?? wibDate();
    const planIds = await insertSalesPlan(am.am_id, tanggal, parsed.customers, parsed.is_late ?? false);
    await upsertDailyTodo({
      am_id: am.am_id,
      am_name: am.nama,
      tanggal,
      items: parsed.customers.map((c) => `${c.customer} — ${c.tujuan}`.trim()),
      raw_body: row.body ?? undefined,
      is_late_plan: parsed.is_late ?? undefined,
    });
    let deals = 0;
    try {
      deals = (await upsertDealsFromPlan(am.am_id, parsed.customers)).length;
    } catch {
      /* pipeline deal opsional — tak fatal utk pencatatan plan */
    }
    const reply = await sendViaWaGateway(
      target,
      `✅ Plan tercatat, ${am.nama} — ${parsed.customers.length} customer — ${tanggal}`,
    );
    return finish({ am_id: am.am_id, tanggal, plan_ids: planIds, deals, reply });
  }

  // kind === "report"
  const parsed = parseReport(row.body ?? "");
  if (parsed.errors.length > 0 || parsed.items.length === 0) {
    const reply = await sendViaWaGateway(
      target,
      `⚠️ Report gagal diproses: ${parsed.errors.join("; ") || "format tidak dikenali"}`,
    );
    return finish({ error: "parse", errors: parsed.errors, reply });
  }
  const tanggal = parsed.tanggal ?? wibDate();
  const act = await insertActivities(am.am_id, tanggal, parsed.items, row.message_id);
  try {
    await logReportToDeals(am.am_id, parsed.items);
  } catch {
    /* pipeline deal opsional */
  }
  const reply = await sendViaWaGateway(
    target,
    `✅ Report tercatat, ${am.nama} — ${parsed.items.length} item (${act.matched} match ke plan) — ${tanggal}`,
  );
  return finish({ am_id: am.am_id, tanggal, activity_ids: act.ids, matched: act.matched, reply });
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
    WHERE processed_at IS NULL AND body ~* '#(plan|report|leads|update)'
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
