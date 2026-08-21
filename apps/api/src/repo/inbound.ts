import { db } from "../db.js";
import { detectDaily, parseDaily, stripInvisible } from "../parsers/dailyplan.js";
import { parseAmPlan, parseAmReport, bersihkanNamaCustomer } from "../parsers/am.js";
import { sendViaWaGateway, type WaSendResult } from "../wasend.js";
import { handleSalesAnalyticsQuery } from "./inbound-sales-analytics.js";
import { detectCek, handleCekQuery } from "./inbound-cek.js";
import { resolveSender } from "./master.js";
import { upsertDailyTodo, computeIsLate } from "./todo.js";
import { createReminder } from "./reminder.js";
import { buildCekReply } from "./cek.js";
import { ingestKlaim, type DocKlaimRow } from "./doc-klaim.js";
import { createTicket, isKnownTeknisiSender } from "./serviceticket.js";
import {
  findBySjNumber,
  markKirim,
  markBast,
  markBukti,
} from "./shipment-tracking.js";
import { matchTeknisiByName, createTeknisiReport } from "./readinessboard.js";
import { createTicket as createGaTicket, listCategories as listGaTicketCategories } from "./ga-helpdesk.js";
import { listStockBranch } from "./stock-branch.js";


// Role yang pakai alur AM per-customer (sales_plan/activity_log + foto), bukan todo.
const AM_ROLES = new Set(["AM", "Teknisi"]);
const isAmRole = (role?: string | null) => AM_ROLES.has((role ?? "").trim());

// Pemrosesan inbound WA (#PLAN/#REPORT/#LEADS/#UPDATE) — pengganti legacy
// wrg-inbound.sh. Format NYATA tim (lihat parsers/dailyplan.ts): #plan/#report
// + nama + daftar bernomor (TODO harian). Alur: resolve pengirim → parse →
// sales_todo → balas grup.
//
// GATED: hanya jalan bila WA_INBOUND_PROCESS=true. Balasan via sendViaWaGateway
// → patuh WA_DRY_RUN. Idempoten: wa_message.processed_at. Pengirim tak dikenal →
// SILENT (tak balas) supaya tak spam non-AM/pesan bot di grup campuran.
//
// F8 — #install/#servis/#training/#kalibrasi: laporan lapangan Teknisi, di
// grup YANG SAMA dgn #plan/#report Teknisi (bukan grup baru) — makanya TIDAK
// ada env-gate baru, cukup nebeng groupAllowed()/WA_INBOUND_GROUPS existing.
// Identitas pengirim di-match ke teknisi_capacity (F8, self-contained) via
// matchTeknisiByName, BUKAN resolveSender/master_user.

export type InboundKind = "plan" | "report" | "leads" | "update" | "sales" | "cek" | "klaim" | "kirim" | "bast" | "bukti" | "install" | "servis" | "training" | "kalibrasi" | "helpdesk" | "stok" | "none";

const LEADS_UPDATE_LINE = /^\s*#\s*(leads|update)\b/i;
const SALES_LINE = /^\s*#\s*sales\b/i;
const CEK_LINE = /^\s*#\s*cek\b/i;
const KLAIM_LINE = /^\s*#\s*klaim\b/i;
// F12/F93 — hashtag SHIPPING dari kurir: "#KIRIM SJ-2026-001" / "#BAST
// SJ-2026-001" / "#BUKTI SJ-2026-001" (caption foto atau teks biasa). TTF
// sengaja tak ada hashtag (diabaikan per arahan Direktur rapat 2026-07-30 —
// lihat docs/features/F12-*.md). #BUKTI (F93) — foto bukti terima + scan
// tanda tangan, SETELAH bast (lihat docs/features/F93-*.md).
const SHIPPING_LINE = /^\s*#\s*(kirim|bast|bukti)\b\s*(.*)$/i;
const READINESS_LINE = /^\s*#\s*(install|servis|training|kalibrasi)\b/i;
// F139 — HANYA #HELPDESK diaktifkan (brief sebut #TICKET juga, sengaja
// didiamkan dulu, bukan dihapus dari brief — lihat docs/features/F139-*.md).
const HELPDESK_LINE = /^\s*#\s*helpdesk\b/i;
const STOK_LINE = /^\s*#\s*stok\b/i;

export function detectKind(body: string | null): InboundKind {
  const daily = detectDaily(body); // line-anchored #plan/#report (sudah strip invisible)
  if (daily) return daily;
  if (body) {
    for (const line of stripInvisible(body).split(/\r?\n/)) {
      const m = line.match(LEADS_UPDATE_LINE);
      if (m) return m[1].toLowerCase() as "leads" | "update";
      if (SALES_LINE.test(line)) return "sales";
      // #CEK menangkap KEDUA varian (nomor dokumen F4 & CUSTOMER QW3) —
      // pemisahannya di handler, bukan di detektor.
      if (CEK_LINE.test(line)) return "cek";
      if (KLAIM_LINE.test(line)) return "klaim";
      const s = line.match(SHIPPING_LINE);
      if (s) return s[1].toLowerCase() as "kirim" | "bast" | "bukti";
      const r = line.match(READINESS_LINE);
      if (r) return r[1].toLowerCase() as "install" | "servis" | "training" | "kalibrasi";
      if (HELPDESK_LINE.test(line)) return "helpdesk";
      if (STOK_LINE.test(line)) return "stok";
    }
  }
  return "none";
}

// Ambil No. SJ dari baris hashtag #KIRIM/#BAST — token pertama setelah hashtag.
function extractSjNumber(body: string | null): string | null {
  if (!body) return null;
  for (const line of stripInvisible(body).split(/\r?\n/)) {
    const m = line.match(SHIPPING_LINE);
    if (m && m[2].trim()) return m[2].trim().split(/\s+/)[0];
  }
  return null;
}

export function isInboundEnabled(): boolean {
  return (process.env.WA_INBOUND_PROCESS ?? "false").toLowerCase() === "true";
}

const wibDate = (): string => new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);

function allowedGroups(): string[] {
  return (process.env.WA_INBOUND_GROUPS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}
// F26 — grup komplain customer (Service Ticket Triage), gated env terpisah dari
// WA_INBOUND_GROUPS krn bukan grup AM. Kosong-by-default (grup belum ada) →
// jid === "" tak pernah cocok jid asli, no-op aman.
function complaintGroupJid(): string {
  return process.env.F26_COMPLAINT_GROUP_JID?.trim() || "";
}
function groupAllowed(jid: string): boolean {
  const g = allowedGroups();
  return g.length === 0 || g.includes(jid) || jid === complaintGroupJid();
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
  media_path?: string | null;
  geo_lat?: number | null;
  geo_lon?: number | null;
  geo_ts?: string | null;
  geo_address?: string | null;
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

function progressBar(filled: number, total: number): string {
  if (total <= 0) return "";
  const f = Math.max(0, Math.min(total, filled));
  return "▓".repeat(f) + "░".repeat(total - f);
}

// Balasan #REPORT AM — selaras format legacy "Kapten" (EOD + progress + foto pending).
// Diekspor untuk diuji tanpa DB (repo/inbound-reply.test.ts).
export function buildAmReportReply(
  nama: string,
  tanggal: string,
  n: number,
  res: { matched: number; unmatched: number; unmatchedNames?: string[] },
  planTotal: number,
  reported: number,
  pendingPhoto: string[],
): string {
  let s = `✅ Report EOD tercatat, ${nama}\n\n📅 ${fmtTanggalDisplay(tanggal)}\n🗒️ ${n} customer reported`;
  if (planTotal > 0) s += `\n📊 ${reported}/${planTotal} customer selesai  ${progressBar(reported, planTotal)}`;
  s += `\n🎯 Match plan: ${res.matched}✓`;
  if (res.unmatched > 0) s += ` ${res.unmatched}⚠️`;
  // Nama customer yang tak match SELALU disebut. Tanpa ini AM cuma melihat
  // "1⚠️" dan tak punya cara tahu customer mana yang gagal dicocokkan —
  // datanya sudah ada di unmatchedNames, dulu hanya tidak dicetak.
  const namesTakMatch = res.unmatchedNames ?? [];
  if (namesTakMatch.length > 0) {
    s += `\n\n⚠️ *Di luar #PLAN hari ini (${namesTakMatch.length} customer):*\n${namesTakMatch.join(", ")}`;
    s += "\n\nKalau memang dikunjungi, kirim ulang #PLAN lengkap (semua customer hari ini) lalu #REPORT lagi — biar terhitung selesai.";
  }
  if (pendingPhoto.length > 0) {
    s += `\n\n⚠️ *Foto visit belum ada (${pendingPhoto.length} customer):*\n${pendingPhoto.join(", ")}`;
    s += "\n\nKirim foto Geo-Tagging Camera per customer dgn caption `Nama Customer` — fuzzy match auto-pair ke pending.";
  } else {
    s += `\n✅ Semua foto visit lengkap.`;
  }
  return s;
}

/**
 * Tempelkan foto pesan `#REPORT` ke baris aktivitas yang LAHIR dari pesan itu.
 *
 * processInboundMessage() hanya menjalankan photoFollowup() saat
 * `kind === "none"` — yaitu foto TANPA caption berhashtag. Padahal banyak AM
 * melapor dengan foto ber-caption `#Report / Cust : X / Hasil : …`; pesan itu
 * dirutekan ke jalur laporan, dan fotonya sendiri TIDAK PERNAH terpasang.
 *
 * Akibatnya di produksi: dari 1.250 baris activity_log yang berasal dari foto
 * ber-caption #Report, 1.235 (98,8%) `photo_path`-nya NULL dan 1.242
 * `photo_geotag`-nya NULL — padahal OCR sudah mengekstrak koordinatnya ke
 * `wa_message.geo_lat`. Sidqi 589/589 (100%), Vicky 174/174, Firman 124/124.
 * Dua akibat yang terlihat: kolom Geotag di kartu kunjungan nol untuk AM yang
 * fotonya justru lengkap, dan bot menagih "Foto visit belum ada" untuk foto
 * yang baru saja dikirim AM.
 *
 * Dipasang SEBELUM daftar `pending` foto dihitung, supaya balasan tidak lagi
 * menagih foto yang sudah menempel.
 */
async function tempelFotoLaporan(row: WaRow, tanggal: string): Promise<Record<string, unknown> | null> {
  if (!String(row.message_type ?? "").toLowerCase().startsWith("image") || !row.media_path) return null;
  const sql = db();
  const hasGeo = row.geo_lat != null && row.geo_lon != null;
  // Jam overlay tetap dipakai walau koordinatnya gagal terbaca OCR — aplikasi
  // kamera Luri/Iqbal sering kehilangan digit koordinat tapi jamnya utuh. Tanpa
  // ini visit_timestamp mereka selalu null dan date_mismatch tak pernah jalan.
  const g = parseGeoTs(row.geo_ts);
  const adaGeo = hasGeo || g.dt != null;
  const geo = adaGeo
    ? { lat: row.geo_lat ?? null, lon: row.geo_lon ?? null, ts: row.geo_ts ?? null, address: row.geo_address ?? null }
    : null;
  const rows = await sql<{ id: string; plan_id: string | null }[]>`
    UPDATE activity_log SET photo_path = ${row.media_path},
      photo_geotag = ${geo ? sql.json(geo as unknown as Parameters<typeof sql.json>[0]) : null}
    WHERE message_id = ${row.message_id} AND photo_path IS NULL
    RETURNING id, plan_id`;
  if (rows.length === 0) return { foto: "tak-ada-baris" };
  let plan = 0;
  if (adaGeo) {
    for (const r of rows) {
      if (!r.plan_id) continue;
      await sql`
        UPDATE sales_plan
           SET visit_lat = COALESCE(${row.geo_lat ?? null}::numeric, visit_lat),
               visit_lon = COALESCE(${row.geo_lon ?? null}::numeric, visit_lon),
               visit_timestamp = COALESCE(${g.dt}::timestamptz, visit_timestamp),
               visit_date_mismatch = COALESCE(${g.iso ? g.iso !== tanggal : null}::boolean, visit_date_mismatch)
         WHERE id = ${Number(r.plan_id)}`;
      plan += 1;
    }
  }
  return { foto_terpasang: rows.length, geo: hasGeo, jam: g.dt != null, plan_geo_diperbarui: plan };
}

// ── Alur AM per-customer ──
// #PLAN AM → sales_plan (per customer). Re-submit: hapus plan belum-direport
// hari itu lalu insert ulang (preserve yg sudah reported). seq lanjut dari max.
async function insertSalesPlan(
  amId: string,
  tanggal: string,
  customers: { customer: string; tujuan: string; goal: string }[],
  role: string | null | undefined,
  submittedAt: string | Date,
): Promise<{ count: number; late: boolean }> {
  const sql = db();
  const late = computeIsLate(tanggal, role, submittedAt);
  await sql`DELETE FROM sales_plan WHERE am_id = ${amId} AND tanggal = ${tanggal} AND reported = false`;
  const [{ maxseq }] = await sql`SELECT COALESCE(max(seq), 0) AS maxseq FROM sales_plan WHERE am_id = ${amId} AND tanggal = ${tanggal}`;
  let seq = Number(maxseq);
  for (const c of customers) {
    seq += 1;
    await sql`
      INSERT INTO sales_plan (am_id, tanggal, customer_name, tujuan, goal, seq, is_late_plan, submitted_at)
      VALUES (${amId}, ${tanggal}, ${c.customer}, ${c.tujuan || null}, ${c.goal || null}, ${seq}, ${late}, ${new Date(submittedAt)})
    `;
  }
  return { count: customers.length, late };
}

// Ambang fuzzy resolusi Account: lebih ketat dari match plan (0.3) karena hasilnya
// nempel permanen ke Account 360 (F62) & feed NPK/insentif, sementara salah-match
// plan cuma mempengaruhi status reported hari itu.
const ACCOUNT_MATCH = 0.45;

// customer_name bebas-teks → account_id (mirror Accurate) + opportunity_id (deal
// terbuka milik AM tsb). Best-effort: gagal resolve = NULL, bukan error — #REPORT
// tak boleh ditolak cuma karena nama faskes belum ada di mirror.
async function resolveActivityLinks(
  amId: string,
  customer: string,
): Promise<{ accountId: number | null; opportunityId: string | null }> {
  const sql = db();
  const [acc] = await sql`
    SELECT id, similarity(COALESCE(NULLIF(name,''), raw->>'name', ''), ${customer}) AS score
    FROM accurate_customer
    WHERE similarity(COALESCE(NULLIF(name,''), raw->>'name', ''), ${customer}) >= ${ACCOUNT_MATCH}
    ORDER BY score DESC, id LIMIT 1
  `;
  const accountId = acc ? Number(acc.id) : null;

  // Deal terbuka (belum Closing-*) milik AM ini: match by account_id, fallback
  // fuzzy facility_name. Terbaru duluan — aktivitas biasanya untuk deal berjalan.
  const [deal] = await sql`
    SELECT deal_id FROM deal
    WHERE am_id = ${amId}
      AND stage NOT IN ('Closing-Won', 'Closing-Lost')
      AND (
        (${accountId}::bigint IS NOT NULL AND account_id = ${accountId})
        OR similarity(COALESCE(NULLIF(facility_name,''), customer_name, ''), ${customer}) >= ${ACCOUNT_MATCH}
      )
    ORDER BY stage_entered_at DESC NULLS LAST, updated_at DESC
    LIMIT 1
  `;
  return { accountId, opportunityId: deal ? String(deal.deal_id) : null };
}

// #REPORT AM → activity_log (per customer) + fuzzy-match ke sales_plan hari itu
// (pg_trgm > 0.3) → set plan_id + tandai plan reported. is_unmatched bila tak match.
// Sekalian resolve Account/Opportunity + simpan tipe aktivitas (F16 CRM Fase 1).
async function insertAmActivities(
  amId: string,
  tanggal: string,
  items: { customer: string; hasil: string; next_action: string; activity_type?: string | null }[],
  messageId: string | null,
): Promise<{ matched: number; unmatched: number; unmatchedNames: string[]; linked: number }> {
  const sql = db();
  let matched = 0;
  let linked = 0;
  const unmatchedNames: string[] = [];
  for (const it of items) {
    // Cocokkan pakai nama yang sudah dibuang prefiks "Cust :"; yang DISIMPAN
    // tetap apa adanya dari AM (jejak mentah tetap di wa_message.body).
    const namaBersih = bersihkanNamaCustomer(it.customer);
    const cands = await sql`
      SELECT id, similarity(customer_name, ${namaBersih}) AS score
      FROM sales_plan WHERE am_id = ${amId} AND tanggal = ${tanggal}
        AND similarity(customer_name, ${namaBersih}) > 0.3
      ORDER BY score DESC LIMIT 1
    `;
    const planId = cands[0] ? Number(cands[0].id) : null;
    const score = cands[0] ? Number(cands[0].score) : null;
    const links = await resolveActivityLinks(amId, namaBersih).catch(() => ({ accountId: null, opportunityId: null }));
    if (links.accountId !== null) linked += 1;
    // Default 'Fisik' bila AM tak menyebut tipe: #REPORT AM = laporan kunjungan
    // harian (bukan kanal lain) — mempertahankan makna baris lama.
    const actType = it.activity_type ?? "Fisik";
    const rows = await sql`
      INSERT INTO activity_log
        (am_id, plan_id, tanggal, customer_name, hasil, next_action, source, is_unmatched, match_score, message_id,
         activity_type, account_id, opportunity_id)
      VALUES
        (${amId}, ${planId}, ${tanggal}, ${it.customer}, ${it.hasil || null}, ${it.next_action || null},
         'wa-inbound', ${planId === null}, ${score}, ${messageId},
         ${actType}, ${links.accountId}, ${links.opportunityId})
      RETURNING id
    `;
    if (planId !== null) {
      matched += 1;
      await sql`UPDATE sales_plan SET reported = true, reported_at = now(), activity_id = ${Number(rows[0].id)} WHERE id = ${planId} AND reported = false`;
    } else {
      unmatchedNames.push(it.customer);
    }
  }
  return { matched, unmatched: unmatchedNames.length, unmatchedNames, linked };
}

// ── Foto-followup (Fase 3) ──
const PHOTO_MATCH = 0.3, PHOTO_DUP = 0.5, PHOTO_SILENT = 0.2;

// Cooldown anti-spam balasan foto (in-memory; apps/api single-process via pm2).
// Foto visit sering dikirim BERURUTAN (bukan barengan) → debounce pending_photos
// di bawah sering lihat 0 → tiap foto bales. Tahan balasan kalau baru aja balas
// utk AM yg sama < 90 dtk → cukup 1 balasan ringkas per burst.
const PHOTO_REPLY_COOLDOWN_MS = 90_000;
const lastPhotoReplyAt = new Map<string, number>();

function parseGeoTs(ts?: string | null): { iso: string | null; dt: string | null } {
  if (!ts) return { iso: null, dt: null };
  const m = ts.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ ,]+(\d{1,2}):(\d{2}))?/);
  if (!m) return { iso: null, dt: null };
  const iso = `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  const dt = m[4] != null ? `${iso}T${m[4].padStart(2, "0")}:${m[5]}:00+07:00` : `${iso}T00:00:00+07:00`;
  return { iso, dt };
}

// Foto (caption=nama customer, geo dari OCR) → match ke activity_log customer
// hari itu (≥0.30) → tempel photo_path+geotag + update sales_plan.visit_*.
async function photoFollowup(row: WaRow, am: { am_id: string; nama: string }): Promise<Record<string, unknown>> {
  const sql = db();
  let caption = (row.body ?? "").trim();
  if (caption === "<media:image>") caption = "";
  if (!caption) return { skipped: "no-caption" };
  // Dulu LIMIT 1: hanya baris ber-skor tertinggi dalam jendela 7 hari yang
  // dilihat, TANPA peduli baris itu sudah berfoto. Kalau ternyata sudah, foto
  // baru dibuang sebagai "already-saved" — padahal baris HARI INI untuk faskes
  // yang sama masih kosong. AM yang mengunjungi faskes yang sama berulang
  // paling dirugikan: 209 foto ditolak, 134 di antaranya punya slot kosong di
  // hari yang sama (Angga 41 · Yugo 39 · Iqbal 34 · Luri 28 · Irul 26).
  // Sekarang beberapa kandidat diambil, dan slot KOSONG diutamakan.
  const cands = await sql<{ id: string; customer_name: string; plan_id: string | null; tanggal: string; photo_path: string | null; score: string }[]>`
    SELECT id, customer_name, plan_id, tanggal::text AS tanggal, photo_path,
           similarity(customer_name, ${caption}) AS score
    FROM activity_log
    WHERE am_id = ${am.am_id} AND tanggal >= (CURRENT_DATE - 7)
      AND similarity(customer_name, ${caption}) >= ${PHOTO_SILENT}
    ORDER BY score DESC LIMIT 8
  `;
  // Slot kosong yang layak: lulus ambang match, belum berfoto. Di antara itu,
  // yang tanggalnya SAMA dengan hari foto dikirim diutamakan — foto yang baru
  // dikirim hampir selalu milik kunjungan hari itu; baru kemudian skor.
  const hariFoto = String(row.received_at ?? "").slice(0, 10);
  const kosong = cands
    .filter((c) => !c.photo_path && Number(c.score) >= PHOTO_MATCH)
    .sort((a, b) =>
      (b.tanggal === hariFoto ? 1 : 0) - (a.tanggal === hariFoto ? 1 : 0) ||
      Number(b.score) - Number(a.score));
  const top = kosong[0] ?? cands[0];
  if (!top) return { skipped: "no-match-silent", caption };
  const score = Number(top.score);
  if (score < PHOTO_MATCH) {
    const reply = await sendViaWaGateway(row.group_jid, `⚠️ Foto "${caption}" tak cocok ke customer manapun, ${am.nama}.`);
    return { error: "weak-match", score, reply };
  }
  if (top.photo_path && score >= PHOTO_DUP) {
    const reply = await sendViaWaGateway(row.group_jid, `ℹ️ Foto ${top.customer_name} sudah tersimpan, ${am.nama}.`);
    return { note: "already-saved", reply };
  }
  const hasGeo = row.geo_lat != null && row.geo_lon != null;
  const g = parseGeoTs(row.geo_ts); // jam dipakai walau koordinat gagal — lihat tempelFotoLaporan
  const adaGeo = hasGeo || g.dt != null;
  const geo = adaGeo
    ? { lat: row.geo_lat ?? null, lon: row.geo_lon ?? null, ts: row.geo_ts ?? null, address: row.geo_address ?? null }
    : null;
  await sql`
    UPDATE activity_log SET photo_path = ${row.media_path ?? null},
      photo_geotag = ${geo ? sql.json(geo as unknown as Parameters<typeof sql.json>[0]) : null}
    WHERE id = ${top.id}
  `;
  let mismatch = false;
  if (top.plan_id && adaGeo) {
    mismatch = g.iso ? g.iso !== String(top.tanggal) : false;
    await sql`
      UPDATE sales_plan
         SET visit_lat = COALESCE(${row.geo_lat ?? null}::numeric, visit_lat),
             visit_lon = COALESCE(${row.geo_lon ?? null}::numeric, visit_lon),
             visit_timestamp = COALESCE(${g.dt}::timestamptz, visit_timestamp),
             visit_date_mismatch = COALESCE(${g.iso ? g.iso !== String(top.tanggal) : null}::boolean, visit_date_mismatch)
       WHERE id = ${top.plan_id}
    `;
  }
  // Debounce: kalau masih ada foto lain dari AM/grup yg sama BELUM diproses,
  // tahan balasan — cuma foto TERAKHIR batch yg reply (hindari spam saat foto
  // dikirim barengan). Baris ini sendiri sudah ter-claim (processed_at di-set
  // oleh processUnprocessed sebelum proses) → tak terhitung.
  const [{ pending_photos }] = await sql`
    SELECT count(*)::int AS pending_photos FROM wa_message
    WHERE processed_at IS NULL AND message_type ~* '^image' AND media_path IS NOT NULL
      AND sender_jid = ${row.sender_jid} AND group_jid = ${row.group_jid}
  `;
  if (Number(pending_photos) > 0) {
    return { matched: top.customer_name, score, geo: hasGeo, deferred: true };
  }
  // Foto terakhir batch → 1 reply ringkas. "Sisa" hanya customer asli (ke-match
  // plan, plan_id NOT NULL) — buang baris hasil-parse-jelek tanpa plan_id.
  const remain = await sql`
    SELECT customer_name FROM activity_log
    WHERE am_id = ${am.am_id} AND tanggal = ${String(top.tanggal)} AND photo_path IS NULL AND plan_id IS NOT NULL ORDER BY id
  `;
  const [{ no_geo }] = await sql`
    SELECT count(*)::int AS no_geo FROM activity_log
    WHERE am_id = ${am.am_id} AND tanggal = ${String(top.tanggal)} AND photo_path IS NOT NULL AND photo_geotag IS NULL
  `;
  let msg = `✅ Foto tersimpan, ${am.nama}.${mismatch ? " ⚠️ tanggal foto ≠ tanggal plan." : ""}`;
  if (remain.length > 0) {
    msg += `\nSisa ${remain.length} customer belum ada foto:\n• ${remain.map((r) => String(r.customer_name)).join("\n• ")}`;
  } else {
    msg += `\n✅ Semua foto visit lengkap.`;
  }
  if (Number(no_geo) > 0) {
    msg += `\n⚠️ ${no_geo} foto tanpa geotag — pakai Geo-Tagging Camera supaya koordinat ke-burn di pixel.`;
  }
  // Cooldown per-AM: foto burst yg datang berurutan jangan bales berkali-kali.
  const cdKey = am.am_id;
  const nowMs = Date.now();
  if (nowMs - (lastPhotoReplyAt.get(cdKey) ?? 0) < PHOTO_REPLY_COOLDOWN_MS) {
    return { matched: top.customer_name, score, geo: hasGeo, remaining: remain.length, suppressed: "reply-cooldown" };
  }
  lastPhotoReplyAt.set(cdKey, nowMs);
  const reply = await sendViaWaGateway(row.group_jid, msg);
  return { matched: top.customer_name, score, geo: hasGeo, remaining: remain.length, no_geo: Number(no_geo), reply };
}

// ── #STOK (F2 Stock Quick-Check) ──
// Total (accurate_item.quantity, via listStockBranch) = live, disegarkan
// cron accurate-stock-sync tiap 5 menit (scheduler.ts). Stok per-cabang
// (item_stock_branch, F37) TIDAK ada puller otomatis — murni hasil import
// CSV manual, jadi tanggal "data per ..." ditampilkan apa adanya (JUJUR
// soal freshness, bukan diklaim real-time yang tak benar).
async function buildStokReply(amId: string, query: string): Promise<string> {
  const sql = db();
  const [am] = await sql`SELECT cabang FROM master_user WHERE am_id = ${amId}`;
  const cabang = am?.cabang ? String(am.cabang) : null;

  let warehouseKode: string | null = null;
  let warehouseLabel: string | null = null;
  if (cabang) {
    const [wh] = await sql`SELECT kode, cabang FROM warehouse WHERE jenis = 'cabang' AND cabang ILIKE ${cabang} LIMIT 1`;
    if (wh) {
      warehouseKode = String(wh.kode);
      warehouseLabel = String(wh.cabang);
    }
  }

  const { rows } = await listStockBranch({ q: query, limit: 5 });
  if (rows.length === 0) return `📦 Barang "${query}" tidak ditemukan.`;
  if (rows.length > 1) {
    return `🔍 Ada ${rows.length} barang cocok "${query}", sebutkan lebih spesifik:\n${rows.map((r) => `• ${r.name} (${r.no})`).join("\n")}`;
  }

  const r = rows[0];
  const unit = r.unit ? ` ${r.unit}` : "";
  const lines = [
    `📦 *${r.name}* (${r.no})`,
    r.total != null ? `Total (semua cabang): ${r.total}${unit} — live, update otomatis tiap 5 menit` : "Total: belum sinkron dari Accurate",
  ];
  if (!warehouseKode) {
    lines.push("⚠️ Cabang kamu belum terpetakan ke gudang manapun.");
  } else {
    const qty = r.per_gudang[warehouseKode];
    if (qty == null) {
      lines.push(`Cabang ${warehouseLabel}: belum ada data stok cabang ini.`);
    } else {
      const tgl = r.terakhir_update
        ? new Date(r.terakhir_update).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" })
        : null;
      lines.push(`Cabang ${warehouseLabel}: ${qty}${unit}${tgl ? ` (data per ${tgl})` : ""}`);
    }
  }
  return lines.join("\n");
}

// Proses SATU pesan; selalu tandai processed_at (idempoten). Pengirim tak dikenal
// / non-submission → SILENT.
export async function processInboundMessage(row: WaRow): Promise<Record<string, unknown>> {
  const sql = db();
  const kind = detectKind(row.body);
  const finish = async (result: Record<string, unknown>, kindOverride?: string): Promise<Record<string, unknown>> => {
    const k = kindOverride ?? kind;
    await sql`
      UPDATE wa_message SET processed_at = now(), processed_kind = ${k},
        processed_result = ${sql.json(result as unknown as Parameters<typeof sql.json>[0])}
      WHERE id = ${row.id}
    `;
    return { id: row.id, kind: k, ...result };
  };

  // F26 — grup komplain customer (Service Ticket Triage): dicek SEBELUM
  // detectKind hashtag-based krn komplain biasa tanpa hashtag. Gated
  // F26_COMPLAINT_GROUP_JID kosong-by-default (no-op selama grup belum ada).
  const cg = complaintGroupJid();
  if (cg && row.group_jid === cg) {
    if (await isKnownTeknisiSender(row.sender_name)) return finish({ skipped: "teknisi-chatter" }, "complaint");
    if (!row.body?.trim()) return finish({ skipped: "empty-body" }, "complaint");
    const ticket = await createTicket({
      source: "wa",
      complaint_text: row.body,
      customer_name: row.sender_name,
      group_jid: row.group_jid,
      wa_message_id: row.message_id,
    });
    return finish(
      { ticket_id: ticket.id, severity: ticket.severity, assigned: ticket.assigned_teknisi_name },
      "complaint",
    );
  }

  // F8 — laporan lapangan Teknisi (#install/#servis/#training/#kalibrasi).
  // Grup SAMA dgn #plan/#report Teknisi (bukan grup baru) — cukup nebeng
  // groupAllowed()/WA_INBOUND_GROUPS existing. Identitas via matchTeknisiByName
  // (teknisi_capacity F8, self-contained), BUKAN resolveSender/master_user.
  if (kind === "install" || kind === "servis" || kind === "training" || kind === "kalibrasi") {
    const teknisi = await matchTeknisiByName(row.sender_name);
    if (!teknisi) return finish({ skipped: "unknown-sender", sender_name: row.sender_name });
    if (!row.body?.trim()) return finish({ skipped: "empty-body" });
    const report = await createTeknisiReport({
      teknisi_id: teknisi.id,
      report_type: kind,
      body: row.body,
      source: "wa",
      group_jid: row.group_jid,
      wa_message_id: row.message_id,
    });
    const reply = await sendViaWaGateway(row.group_jid, `✅ Laporan #${kind.toUpperCase()} tercatat — ${teknisi.nama}.`);
    return finish({ report_id: report.id, teknisi: teknisi.nama, reply });
  }

  if (kind === "none") {
    // Foto tanpa hashtag (caption = customer) → foto-followup ke activity_log.
    if (String(row.message_type ?? "").toLowerCase().startsWith("image") && row.media_path) {
      const amp = await resolveSender({ senderJid: row.sender_jid, groupJid: row.group_jid, pushname: row.sender_name });
      if (!amp) return finish({ skipped: "unknown-sender" }, "photo");
      // Foto AM cuma divalidasi di grup AM (The ALLIANCE). Di grup lain (mis. AM
      // forward surat/dokumen ke grup diskusi) → skip diam, jangan balas "tak cocok".
      const AM_PHOTO_GROUP = process.env.COMPLIANCE_AM_GROUP || process.env.REMINDER_WA_TARGET || "";
      if (String(amp.role ?? "").toUpperCase() === "AM" && AM_PHOTO_GROUP && row.group_jid !== AM_PHOTO_GROUP) {
        return finish({ skipped: "am-photo-non-alliance", am_id: amp.am_id }, "photo");
      }
      await sql`UPDATE master_user SET last_active_group = ${row.group_jid}, last_active_at = now() WHERE am_id = ${amp.am_id}`;
      const r = await photoFollowup(row, amp);
      return finish({ via: amp.via, ...r }, "photo");
    }
    return finish({ skipped: "no-hashtag" });
  }
  const target = row.group_jid;

  // #LEADS/#UPDATE — tanpa body-name; resolve by phone/pushname saja.
  if (kind === "leads" || kind === "update") {
    const amx = await resolveSender({ senderJid: row.sender_jid, groupJid: row.group_jid, pushname: row.sender_name });
    if (!amx) return finish({ skipped: "unknown-sender", sender_name: row.sender_name });
    const reply = await sendViaWaGateway(target, `ℹ️ #${kind.toUpperCase()} belum tersedia di wrg-os (menyusul).`);
    return finish({ note: "not-implemented", via: amx.via, reply });
  }

  // #HELPDESK — buat ga_tickets langsung (F139). Reporter TIDAK di-resolve ke
  // app_user (tak ada roster/fuzzy-match yg reliable utk sender WA umum di
  // luar AM/Teknisi) — pakai reporter_name_override = pushname WA apa adanya,
  // pola hybrid PIC yang justru dirancang utk kasus begini. ASUMSI rancangan,
  // gampang direvisi kalau ada spek resolusi identitas yg lebih pasti nanti.
  if (kind === "helpdesk") {
    const text = stripInvisible(row.body ?? "").replace(HELPDESK_LINE, "").trim();
    if (!text) {
      const reply = await sendViaWaGateway(target, "⚠️ #HELPDESK terdeteksi tapi teks kosong. Format: #HELPDESK <deskripsi kendala>");
      return finish({ error: "empty-body", reply });
    }
    const categories = await listGaTicketCategories(true);
    const fallbackCategory = categories.find((c) => c.code === "UMUM") ?? categories[0];
    if (!fallbackCategory) {
      const reply = await sendViaWaGateway(target, "⚠️ #HELPDESK gagal — belum ada kategori tiket aktif.");
      return finish({ error: "no-category", reply });
    }
    const r = await createGaTicket({
      title: text.slice(0, 60),
      description: text,
      category_id: fallbackCategory.id,
      reporter_name_override: row.sender_name?.trim() || "WA (tak dikenal)",
    });
    if (!("ticket_no" in r)) {
      const reply = await sendViaWaGateway(target, `⚠️ #HELPDESK gagal dicatat: ${r.error}`);
      return finish({ error: r.error, reply });
    }
    const reply = await sendViaWaGateway(target, `✅ Tiket ${r.ticket_no} dibuat (${fallbackCategory.nama}), status: open.`);
    return finish({ ticket_id: r.id, ticket_no: r.ticket_no, reply });
  }

  // #SALES — query analitik on-demand. Resolve pengirim (by phone/pushname),
  // scope AM→self via role, jawab teks ringkas.
  if (kind === "sales") {
    const ams = await resolveSender({ senderJid: row.sender_jid, groupJid: row.group_jid, pushname: row.sender_name });
    if (!ams) return finish({ skipped: "unknown-sender", sender_name: row.sender_name });
    let text: string;
    try {
      text = await handleSalesAnalyticsQuery(row.body ?? "", { am_id: ams.am_id, nama: ams.nama ?? null, role: ams.role ?? null });
    } catch (e) {
      text = `⚠️ Query #SALES gagal diproses: ${(e as Error).message}`;
    }
    const reply = await sendViaWaGateway(target, text);
    return finish({ kind: "sales", via: ams.via, reply });
  }

  // #CEK — SATU command, dua varian (F4 SXR + QW3). Pengirim WAJIB dikenal:
  // balasan berisi data komersial (customer, nominal, status) yang gak boleh
  // keluar ke pengirim tak dikenal.
  //   · `#CEK CUSTOMER <nama>`  → QW3: ringkasan pre-delivery SO/SJ/TTF per
  //                               customer (fuzzy nama, inbound-cek.ts).
  //   · `#CEK <nomor dokumen>`  → F4 : cross-ref SO↔SJ↔Faktur by nomor (cek.ts).
  // Varian CUSTOMER dicek DULU — kalau tidak, "CUSTOMER RSUD X" ikut kebaca
  // sebagai nomor dokumen dan selalu balas "tidak ditemukan".
  if (kind === "cek") {
    const ck = await resolveSender({ senderJid: row.sender_jid, groupJid: row.group_jid, pushname: row.sender_name });
    if (!ck) return finish({ skipped: "unknown-sender", sender_name: row.sender_name });
    if (detectCek(row.body ?? "")) {
      let text: string;
      try {
        text = await handleCekQuery(row.body ?? "");
      } catch (e) {
        text = `⚠️ Query #CEK gagal diproses: ${(e as Error).message}`;
      }
      const reply = await sendViaWaGateway(target, text);
      return finish({ kind: "cek", cek_mode: "customer", via: ck.via, reply });
    }
    const query = (row.body ?? "").replace(CEK_LINE, "").trim();
    if (!query) {
      const reply = await sendViaWaGateway(
        target,
        `⚠️ Isi nomor dokumen atau nama customer setelah #CEK, ${ck.nama}. Contoh: #CEK SO-00123 — atau #CEK CUSTOMER RSUD Kota`,
      );
      return finish({ error: "empty-query", via: ck.via, reply });
    }
    const text = await buildCekReply(query);
    const reply = await sendViaWaGateway(target, text);
    return finish({ kind: "cek", cek_mode: "dokumen", via: ck.via, reply });
  }

  // #KLAIM — DOC #KLAIM Fase A. Sender BEBAS teks (tak butuh roster, pola
  // sama kurir F12/F93) — klaim bisa datang dari siapa pun, bukan cuma AM.
  // Wajib foto; #KLAIM tanpa foto dibalas error jelas (bukan silent-skip).
  if (kind === "klaim") {
    if (!(String(row.message_type ?? "").toLowerCase().startsWith("image") && row.media_path)) {
      const reply = await sendViaWaGateway(target, "⚠️ #KLAIM wajib disertai foto dokumen (invoice/faktur/struk).");
      return finish({ error: "no-photo", reply });
    }
    const caption = (row.body ?? "").replace(KLAIM_LINE, "").trim() || null;
    const result = await ingestKlaim({
      wa_message_id: row.id,
      sender_jid: row.sender_jid,
      sender_name: row.sender_name,
      media_path: row.media_path,
      caption,
    });
    if ("ok" in result && result.ok === false) {
      const reply = await sendViaWaGateway(target, `⚠️ Gagal proses #KLAIM: ${result.error}`);
      return finish({ error: result.error, reply });
    }
    const k = result as DocKlaimRow;
    const msg = k.ocr_dry_run
      ? `📥 Foto #KLAIM tersimpan. OCR belum aktif (mode dry-run) — akan ditindaklanjuti manual.`
      : [
          "✅ #KLAIM diterima, foto tersimpan.",
          k.nomor_dokumen ? `No. Dokumen: ${k.nomor_dokumen}` : null,
          k.tanggal_dokumen ? `Tanggal: ${k.tanggal_dokumen}` : null,
          k.nominal ? `Nominal: ${k.nominal}` : null,
          k.pihak ? `Pihak: ${k.pihak}` : null,
          "Akan ditindaklanjuti tim terkait.",
        ]
          .filter(Boolean)
          .join("\n");
    const reply = await sendViaWaGateway(target, msg);
    return finish({ klaim_id: k.id, ocr_dry_run: k.ocr_dry_run, reply });
  }

  // F12 — #KIRIM/#BAST (SHIPPING): match by sj_number, TANPA gate sender —
  // kurir tak punya roster master data (self-contained, sama filosofi F22).
  if (kind === "kirim" || kind === "bast" || kind === "bukti") {
    const sj = extractSjNumber(row.body);
    if (!sj) {
      const reply = await sendViaWaGateway(
        target,
        `⚠️ Format #${kind.toUpperCase()} tak lengkap — sertakan No. SJ, mis. "#${kind.toUpperCase()} SJ-2026-001".`,
      );
      return finish({ error: "missing-sj-number", reply });
    }
    const shipment = await findBySjNumber(sj);
    if (!shipment) {
      const reply = await sendViaWaGateway(target, `⚠️ SJ "${sj}" tidak ditemukan di tracking pengiriman.`);
      return finish({ error: "sj-not-found", sj, reply });
    }
    const photoPath = String(row.message_type ?? "").toLowerCase().startsWith("image") ? (row.media_path ?? null) : null;
    // Foto ber-geotag (OCR check_photo_geotag.py, sama infra "Geo-Tagging
    // Camera" AM) → row.geo_lat/geo_lon terisi. #KIRIM capture titik AWAL,
    // #BAST capture titik CUSTOMER — dipakai hitung distance_km/eta_days
    // OTOMATIS di markBast() begitu keduanya ada (arahan Direktur 2026-07-30).
    // #BUKTI (F93, SETELAH bast) — foto bukti terima + scan tanda tangan,
    // TANPA geo (bukan titik baru, cuma audit trail tambahan).
    const geo = { lat: row.geo_lat ?? null, lon: row.geo_lon ?? null };
    const action =
      kind === "kirim"
        ? await markKirim(shipment.id, { photo_path: photoPath, by: row.sender_name, ...geo })
        : kind === "bast"
          ? await markBast(shipment.id, { photo_path: photoPath, by: row.sender_name, ...geo })
          : await markBukti(shipment.id, { photo_path: photoPath, by: row.sender_name });
    const labelDone = kind === "kirim" ? "DIKIRIM" : kind === "bast" ? "BAST/SELESAI" : "BUKTI TERSIMPAN";
    const replyMsg = action.ok
      ? `✅ SJ ${shipment.sj_number} (${shipment.customer_name}) ditandai *${labelDone}*.`
      : `⚠️ Gagal update SJ ${shipment.sj_number}: ${action.error}`;
    const reply = await sendViaWaGateway(target, replyMsg);
    return finish({ shipment_id: shipment.id, sj, ok: action.ok, error: action.error, reply });
  }

  // #STOK — cek stok cepat (F2 SQC). Sender WAJIB dikenal (perlu cabang AM
  // buat cari gudang-nya) — beda dari #KLAIM yang sengaja terbuka.
  if (kind === "stok") {
    const st = await resolveSender({ senderJid: row.sender_jid, groupJid: row.group_jid, pushname: row.sender_name });
    if (!st) return finish({ skipped: "unknown-sender", sender_name: row.sender_name });
    const query = (row.body ?? "").replace(STOK_LINE, "").trim();
    if (!query) {
      const reply = await sendViaWaGateway(target, `⚠️ Isi nama/kode barang setelah #STOK, ${st.nama}. Contoh: #STOK Rapid Test Antigen`);
      return finish({ error: "empty-query", via: st.via, reply });
    }
    const text = await buildStokReply(st.am_id, query);
    const reply = await sendViaWaGateway(target, text);
    return finish({ kind: "stok", via: st.via, reply });
  }

  // #PLAN/#REPORT — parse DULU (body-name dibutuhkan untuk resolusi Tier-A).
  const parsed = parseDaily(row.body ?? "");
  const am = await resolveSender({
    bodyName: parsed?.name ?? null,
    senderJid: row.sender_jid,
    groupJid: row.group_jid,
    pushname: row.sender_name,
  });
  // Pengirim tak dikenal / nonaktif → SILENT (tak balas).
  if (!am) return finish({ skipped: "unknown-sender", sender_name: row.sender_name });
  if (!am.aktif) return finish({ skipped: "inactive", am_id: am.am_id });
  // Track grup terakhir submit (untuk compliance reminder per-grup).
  await sql`UPDATE master_user SET last_active_group = ${row.group_jid}, last_active_at = now() WHERE am_id = ${am.am_id}`;

  if (!parsed || parsed.itemCount === 0) {
    // submission terdeteksi tapi tak ada item → kemungkinan salah format (hint).
    const reply = await sendViaWaGateway(
      target,
      `⚠️ ${kind === "plan" ? "Plan" : "Report"} terdeteksi tapi item kosong, ${am.nama}. Pakai daftar bernomor (1. 2. 3. …).`,
    );
    return finish({ error: "empty-items", via: am.via, reply });
  }
  const tanggal = parsed.tanggal ?? wibDate();

  const amFlow = isAmRole(am.role);

  if (kind === "plan") {
    if (amFlow) {
      const ap = parseAmPlan(row.body ?? "");
      if (ap.customers.length === 0) {
        const reply = await sendViaWaGateway(target, `⚠️ Plan AM tak terbaca, ${am.nama}. Format: 1. Customer | tujuan | goal`);
        return finish({ error: "am-plan-empty", via: am.via, reply });
      }
      const tgl = ap.tanggal ?? wibDate();
      const r = await insertSalesPlan(am.am_id, tgl, ap.customers, am.role, row.received_at);
      const reply = await sendViaWaGateway(
        target,
        `✅ Plan tercatat, ${am.nama}\n\n📅 ${fmtTanggalDisplay(tgl)}\n🗒️ ${r.count} customer visit${r.late ? "\n⚠️ telat (lewat batas)" : ""}`,
      );
      return finish({ am_id: am.am_id, via: am.via, mode: "am", tanggal: tgl, customers: r.count, reply });
    }
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
  if (amFlow) {
    const ar = parseAmReport(row.body ?? "");
    if (ar.items.length === 0) {
      const reply = await sendViaWaGateway(
        target,
        `⚠️ Report AM tak terbaca, ${am.nama}.\nFormat: \`Customer — hasil — next step\` (boleh tambah \`— tipe\`: Fisik/Telepon/WA/Demo/Presentasi/Follow-up)\natau: 1. Customer / hasil: … / next: …`,
      );
      return finish({ error: "am-report-empty", via: am.via, reply });
    }
    const tgl = ar.tanggal ?? wibDate();
    const res = await insertAmActivities(am.am_id, tgl, ar.items, row.message_id);
    // Foto yang datang BERSAMA laporan ini dipasang sekarang — sebelum daftar
    // `pend` dihitung, supaya balasan tak menagih foto yang sudah ada.
    const foto = await tempelFotoLaporan(row, tgl);
    const [tot] = await sql`
      SELECT count(*)::int AS plan_total, count(*) FILTER (WHERE reported)::int AS reported
      FROM sales_plan WHERE am_id = ${am.am_id} AND tanggal = ${tgl}
    `;
    const pend = await sql`
      SELECT customer_name FROM activity_log
      WHERE am_id = ${am.am_id} AND tanggal = ${tgl} AND photo_path IS NULL AND plan_id IS NOT NULL ORDER BY id
    `;
    const pendingNames = pend.map((p) => String(p.customer_name));
    // note: TGL ket → am_reminder (fired H-1/H oleh scheduler reminder-h/h-1).
    let reminders = 0;
    for (const nt of ar.notes) {
      if (!nt.reminder_date || !nt.keterangan) continue;
      await createReminder({
        am_id: am.am_id,
        am_name: am.nama,
        reminder_date: nt.reminder_date,
        note: nt.keterangan,
        customer_name: nt.customer ?? undefined,
      });
      reminders += 1;
    }
    let body = buildAmReportReply(am.nama, tgl, ar.items.length, res, Number(tot.plan_total), Number(tot.reported), pendingNames);
    if (reminders > 0) body += `\n\n📌 ${reminders} reminder dijadwalkan.`;
    const reply = await sendViaWaGateway(target, body);
    return finish({ am_id: am.am_id, via: am.via, mode: "am", tanggal: tgl, matched: res.matched, unmatched: res.unmatched, linked: res.linked, reminders, reply, ...(foto ?? {}) });
  }
  // report todo — cocokkan vs plan + balasan kaya (match/baru)
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
    SELECT id::text, group_jid, sender_jid, sender_name, body, message_type, message_id, received_at::text,
           media_path, geo_lat, geo_lon, geo_ts, geo_address
    FROM wa_message
    WHERE processed_at IS NULL
      AND (body ~* '#\\s*(plan|report|leads|update|sales|cek|klaim|kirim|bast|install|servis|training|kalibrasi|helpdesk|stok)'
           OR (message_type ~* '^image' AND media_path IS NOT NULL)
           OR (${complaintGroupJid()} <> '' AND group_jid = ${complaintGroupJid()}))
    ORDER BY received_at ASC LIMIT ${limit}
  `;
  const results: Record<string, unknown>[] = [];
  let processed = 0;
  let replied = 0;
  for (const r of rows) {
    // Klaim atomik sebelum proses: cegah dua invocation konkuren (mis. webhook
    // ke-deliver 2× / overlap webhook+cron) memproses & MEMBALAS baris yang
    // sama. UPDATE …WHERE processed_at IS NULL mengunci baris; hanya pemenang
    // yg dapat RETURNING, yg kalah skip → tidak ada double-reply.
    const claim = await sql`
      UPDATE wa_message SET processed_at = now()
      WHERE id = ${r.id} AND processed_at IS NULL
      RETURNING id
    `;
    if (claim.length === 0) continue;
    if (!groupAllowed(String(r.group_jid))) {
      await sql`UPDATE wa_message SET processed_kind = 'group-skip' WHERE id = ${r.id}`;
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
