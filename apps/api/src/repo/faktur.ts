import { db } from "../db.js";
import { sendViaWaGateway } from "../wasend.js";
import { accurateConfigured, syncAccurateInvoices } from "./accurateSync.js";
import { deriveInvoiceStatus, invoiceDetail, normalizeAccurateDate, type InvoiceStatus } from "./ar.js";
import { joinAmFromSalesman } from "./salesman-am.js";

// Di main, cek.ts (#CEK, batch magang) belum ada — dua helper format yang dipakai
// F91 didefinisikan lokal, identik dengan versi cek.ts di dev.
const fmtTanggal = (iso: string | null): string =>
  iso ? new Date(iso).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" }) : "-";
const fmtRupiah = (n: number | null): string | null => (n == null ? null : `Rp${n.toLocaleString("id-ID")}`);

// F91 Invoice Status Check (#FAKTUR). Dua bagian, satu definisi status
// (deriveInvoiceStatus di ar.ts, juga dipakai dialog detail invoice web):
//
//   1. `#FAKTUR <no_invoice>` → status Open/Paid/Overdue + jatuh tempo + nominal
//      + customer. Siapa pun yang dikenal & aktif boleh (setara #CEK).
//   2. Cron reminder harian D-7 / D-day → digest ke Finance
//      (INVOICE_REMINDER_FINANCE_TARGET) + tiap AM (DM master_user.wa_number).
//   3. Rekap overdue MINGGUAN → Finance saja (bukan AM, bukan harian).
//
// Kenapa overdue dipisah (keputusan user 11 Okt 2026): di prod ada ±1.260
// invoice overdue vs ±140 yang jatuh tempo ≤7 hari. Selama overdue ikut antrean
// harian (re-sync maks 100/run, urut paling lama tak tersinkron), D-7/D-day
// selalu kalah antre dan bisa tak pernah terkirim — padahal itu yang paling
// butuh tepat waktu. Digest gabungannya juga bisa ±180 ribu karakter.
//
// Due date = raw->>'dueDate' dari detail Accurate. SENGAJA bukan
// ar_aging_mv.due_date: mapAccurateInvoice mengisinya dengan transDate kalau
// dueDate kosong, jadi invoice tanpa termin akan tampak overdue palsu.
//
// Mirror invoice hanya disegarkan untuk transDate ≤7 hari (accurate-sync), jadi
// status invoice lama bisa basi (sudah lunas tapi masih OPEN). Sebelum kirim,
// kandidat reminder ditarik ulang satu per satu dari Accurate (read-only).

// Sisa tagihan Accurate bisa berpecahan sen (mis. 438.111,942) dan penjumlahan
// float menambah ekor desimal — "Rp13.678.410.511,942" di rekap prod (uji 11 Okt
// 2026). Semua nominal di F91 dibulatkan ke rupiah utuh sebelum diformat.
const rupiah = (n: number): string => fmtRupiah(Math.round(n)) ?? "-";

const wibDate = (): string => new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);

// ── #FAKTUR ──────────────────────────────────────────────────────────────────

export interface FakturView extends InvoiceStatus {
  number: string;
  customer_name: string;
  tanggal: string | null;
  total: number;
  paid: number;
  outstanding: number;
  lunas_at: string | null;
  am: string | null;
  cabang: string | null;
}

// Nomor invoice Accurate tak mengandung spasi → ambil token pertama, supaya
// "#FAKTUR SI.2026.09.00123 tolong dicek" tetap ketemu.
export const parseFakturArg = (arg: string): string => arg.trim().split(/\s+/)[0] ?? "";

export function statusLine(s: InvoiceStatus, lunasAt: string | null = null): string {
  if (s.state === "PAID") return `🟢 LUNAS${lunasAt ? ` (${fmtTanggal(lunasAt)})` : ""}`;
  if (s.state === "OVERDUE") return `🔴 OVERDUE ${-(s.days_to_due ?? 0)} hari`;
  if (s.days_to_due == null) return "🟡 OPEN — jatuh tempo tidak tercatat";
  if (s.days_to_due === 0) return "🟠 OPEN — jatuh tempo HARI INI";
  return `🟡 OPEN — jatuh tempo ${s.days_to_due} hari lagi`;
}

export function formatFakturReply(v: FakturView): string {
  const lines = [
    `🧾 *Faktur ${v.number}*`,
    `Customer: ${v.customer_name}`,
    `Status: ${statusLine(v, v.lunas_at)}`,
    `Tanggal: ${fmtTanggal(v.tanggal)} · Jatuh tempo: ${fmtTanggal(v.due_date)}`,
    `Total: ${rupiah(v.total)} · Terbayar: ${rupiah(v.paid)} · Sisa: ${rupiah(v.outstanding)}`,
    `AM: ${v.am ?? "-"}${v.cabang ? ` (${v.cabang})` : ""}`,
  ];
  if (v.state !== "PAID") {
    lines.push("ℹ️ Status dari mirror Accurate — pembayaran yang baru masuk bisa belum ter-update.");
  }
  return lines.join("\n");
}

export async function buildFakturReply(arg: string): Promise<string> {
  const no = parseFakturArg(arg);
  const r = await invoiceDetail(no);
  if (!r.ok) {
    return `🔎 Faktur "${no}" tidak ditemukan di mirror Accurate. Pastikan nomornya lengkap (mis. SI.2026.09.00123); faktur yang baru terbit tersinkron beberapa kali sehari.`;
  }
  return formatFakturReply(r.invoice);
}

// ── Reminder jatuh tempo ─────────────────────────────────────────────────────

// d7 = 1–7 hari lagi, d0 = hari ini, od = sudah lewat. Rentang (bukan tepat
// H-7) supaya hari yang terlewat (libur, cron mati) tetap tertangkap.
export type ReminderStage = "d7" | "d0" | "od";

export function reminderStage(daysToDue: number | null): ReminderStage | null {
  if (daysToDue == null || daysToDue > 7) return null;
  if (daysToDue > 0) return "d7";
  return daysToDue === 0 ? "d0" : "od";
}

// Reminder HARIAN hanya D-day & D-7, masing-masing sekali per invoice. Overdue
// tak lagi ikut harian — lihat rekap mingguan (runOverdueRecap).
export const DAILY_STAGES: readonly ReminderStage[] = ["d0", "d7"];

// Maks invoice yang DITAMPILKAN per pesan WA. Sisanya disebut jumlahnya saja
// dan TIDAK ditandai terkirim → muncul lagi di run berikutnya.
export const MAX_LINES_PER_MESSAGE = 30;

export type Audience = "fin" | "am";

// Kunci notif_state per invoice × tahap × penerima. Terpisah per penerima supaya
// gagal kirim ke satu AM tak membuat Finance ikut dianggap belum/terkirim.
export const reminderKey = (stage: ReminderStage, invoiceId: number, audience: Audience): string =>
  `f91:${stage}:${invoiceId}:${audience}`;

export interface ReminderRow {
  id: number;
  number: string;
  customer_name: string;
  outstanding: number;
  due_date: string;
  days_to_due: number;
  stage: ReminderStage;
  am_id: string | null;
  am_nama: string | null;
  am_wa: string | null;
}

// Urutan prioritas: D-day dulu, lalu D-7 terdekat. Dipakai untuk memilih batch
// re-sync DAN urutan baris di pesan — yang paling mendesak tak boleh kalah antre.
const STAGE_RANK: Record<ReminderStage, number> = { d0: 0, d7: 1, od: 2 };
export function byUrgency(a: ReminderRow, b: ReminderRow): number {
  return STAGE_RANK[a.stage] - STAGE_RANK[b.stage] || a.days_to_due - b.days_to_due || a.id - b.id;
}

const STAGE_HEAD: Record<ReminderStage, string> = {
  d0: "🟠 *Jatuh tempo hari ini*",
  d7: "🟡 *Jatuh tempo ≤7 hari*",
  od: "🔴 *Overdue*",
};

const kapan = (d: number): string => (d < 0 ? `lewat ${-d} hari` : d === 0 ? "hari ini" : `${d} hari lagi`);

export interface Digest {
  text: string;
  shownIds: number[]; // hanya invoice ini yang boleh ditandai terkirim
}

export function buildReminderDigest(
  rows: ReminderRow[],
  audience: Audience,
  today: string,
  amNama?: string,
  maxLines: number = MAX_LINES_PER_MESSAGE,
): Digest {
  const head =
    audience === "fin"
      ? `🧾 *Reminder Jatuh Tempo Invoice* — ${fmtTanggal(today)}`
      : `🧾 Halo ${amNama ?? ""}, invoice customer Anda yang perlu ditagih — ${fmtTanggal(today)}`;
  const shown = [...rows].sort(byUrgency).slice(0, Math.max(1, maxLines));
  const parts = [head];
  for (const stage of ["d0", "d7", "od"] as ReminderStage[]) {
    const list = shown.filter((r) => r.stage === stage);
    if (!list.length) continue;
    const total = rows.filter((r) => r.stage === stage).length;
    const lines = list.map((r) => {
      const am = audience === "fin" ? ` · AM ${r.am_nama ?? "-"}` : "";
      return `• ${r.number} — ${r.customer_name} — sisa ${rupiah(r.outstanding)} — ${kapan(r.days_to_due)} (${fmtTanggal(r.due_date)})${am}`;
    });
    parts.push(`\n${STAGE_HEAD[stage]} (${total})\n${lines.join("\n")}`);
  }
  const sisa = rows.length - shown.length;
  if (sisa > 0) parts.push(`\n…dan ${sisa} invoice lainnya — dikirim di reminder berikutnya, atau lihat menu AR.`);
  parts.push("\nDetail: ketik #FAKTUR <nomor>");
  return { text: parts.join("\n"), shownIds: shown.map((r) => r.id) };
}

// Invoice OPEN bersisa yang sedang di salah satu `stages`. Filter tahap di TS
// (bukan SQL) supaya parsing dueDate memakai normalizeAccurateDate yang sama
// dengan invoiceDetail.
async function loadReminderRows(today: string, stages: readonly ReminderStage[], ids?: number[]): Promise<ReminderRow[]> {
  const sql = db();
  const rows = await sql`
    SELECT ai.id, ai.number, ai.status, ai.outstanding::float8 AS outstanding, ai.raw->>'dueDate' AS due_raw,
      COALESCE(NULLIF(ac.name,''), NULLIF(ai.raw->'customer'->>'name',''), NULLIF(ai.raw->>'retailWpName',''), 'Customer #'||ai.customer_id::text) AS customer_name,
      mu.am_id, COALESCE(NULLIF(mu.panggilan,''), NULLIF(mu.nama,'')) AS am_nama,
      CASE WHEN mu.aktif IS DISTINCT FROM false THEN NULLIF(btrim(mu.wa_number),'') END AS am_wa
    FROM accurate_invoice ai
    LEFT JOIN accurate_customer ac ON ac.id = ai.customer_id
    LEFT JOIN accurate_salesman acs ON acs.id = ai.salesman_id
    ${joinAmFromSalesman(sql)}
    WHERE ai.status = 'OPEN' AND ai.outstanding > 0 AND ai.raw ? 'dueDate'
      ${ids ? sql`AND ai.id = ANY(${ids}::bigint[])` : sql``}`;
  const out: ReminderRow[] = [];
  for (const r of rows) {
    const st = deriveInvoiceStatus(
      { status: String(r.status), outstanding: Number(r.outstanding) },
      normalizeAccurateDate(r.due_raw == null ? undefined : String(r.due_raw)),
      today,
    );
    const stage = st.state === "PAID" ? null : reminderStage(st.days_to_due);
    if (!stage || !stages.includes(stage) || st.due_date == null || st.days_to_due == null) continue;
    out.push({
      id: Number(r.id),
      number: String(r.number),
      customer_name: String(r.customer_name),
      outstanding: Number(r.outstanding),
      due_date: st.due_date,
      days_to_due: st.days_to_due,
      stage,
      am_id: r.am_id == null ? null : String(r.am_id),
      am_nama: r.am_nama == null ? null : String(r.am_nama),
      am_wa: r.am_wa == null ? null : String(r.am_wa),
    });
  }
  return out;
}

export interface ResyncInfo {
  attempted: number;
  failed: number;
  deferred: number;
  skipped?: string;
}

// Tarik ulang invoice `ids` (sudah urut prioritas) dari Accurate, read-only,
// maks INVOICE_REMINDER_RESYNC_LIMIT. Mirror hanya menyegarkan invoice ≤7 hari,
// jadi tanpa ini invoice yang sudah lunas bisa ikut diingatkan.
async function resyncInvoices(ids: number[]): Promise<{ info: ResyncInfo; batch: number[] | null }> {
  const resyncLimit = Math.max(0, Number(process.env.INVOICE_REMINDER_RESYNC_LIMIT ?? 100) || 0);
  const info: ResyncInfo = { attempted: 0, failed: 0, deferred: 0 };
  if (!ids.length) return { info: { ...info, skipped: "tidak ada kandidat" }, batch: null };
  if (!accurateConfigured() || resyncLimit === 0) {
    // Tanpa kredensial (dev) / re-sync dimatikan → pakai mirror apa adanya.
    return { info: { ...info, skipped: resyncLimit === 0 ? "INVOICE_REMINDER_RESYNC_LIMIT=0" : "kredensial Accurate tak tersedia" }, batch: null };
  }
  const batch = ids.slice(0, resyncLimit);
  info.deferred = ids.length - batch.length;
  for (const id of batch) {
    info.attempted += 1;
    const r = await syncAccurateInvoices({ invoiceId: id });
    if (!r.ok) info.failed += 1; // gagal → pakai data mirror
    await new Promise((res) => setTimeout(res, 150));
  }
  return { info, batch };
}

interface Job {
  row: ReminderRow;
  audience: Audience;
  key: string;
}

async function pendingJobs(rows: ReminderRow[], finTarget: string): Promise<Job[]> {
  const all: Job[] = [];
  for (const row of rows) {
    if (finTarget) all.push({ row, audience: "fin", key: reminderKey(row.stage, row.id, "fin") });
    if (row.am_wa) all.push({ row, audience: "am", key: reminderKey(row.stage, row.id, "am") });
  }
  if (!all.length) return [];
  const sent = await db()`SELECT key FROM notif_state WHERE key = ANY(${all.map((j) => j.key)}::text[])`;
  const done = new Set(sent.map((s) => String(s.key)));
  return all.filter((j) => !done.has(j.key)); // D-7 & D-day: sekali per invoice × penerima
}

// Kirim sungguhan saja yang dihitung — stub & dry-run gateway juga sent=true.
const terkirimSungguhan = (w: { sent: boolean; stub: boolean; dryRun?: boolean }): boolean => w.sent && !w.stub && !w.dryRun;

async function tandaiTerkirim(keys: string[], signature: string): Promise<void> {
  if (!keys.length) return;
  await db()`
    INSERT INTO notif_state (key, signature, count, sent_at)
    SELECT k, ${signature}, 1, now() FROM unnest(${keys}::text[]) AS t(k)
    ON CONFLICT (key) DO UPDATE SET signature = EXCLUDED.signature, count = notif_state.count + 1, sent_at = now()`;
}

export interface InvoiceReminderResult {
  candidates: number;
  resync: ResyncInfo;
  messages: { to: string; audience: Audience; invoices: number; shown: number; sent: boolean; error?: string; payload?: string }[];
  finance_target_missing: boolean;
  dryRun: boolean;
}

export async function runInvoiceReminder(opts: { dryRun?: boolean } = {}): Promise<InvoiceReminderResult> {
  const today = wibDate();
  const finTarget = (process.env.INVOICE_REMINDER_FINANCE_TARGET ?? "").trim();

  let jobs = await pendingJobs((await loadReminderRows(today, DAILY_STAGES)).sort(byUrgency), finTarget);
  const ids = [...new Set(jobs.map((j) => j.row.id))]; // urutan prioritas terjaga
  const { info: resync, batch } = await resyncInvoices(ids);
  if (batch) {
    // Hanya batch yang sudah dicek ulang yang dikirim; sisanya run berikutnya.
    jobs = await pendingJobs((await loadReminderRows(today, DAILY_STAGES, batch)).sort(byUrgency), finTarget);
  }

  // Satu digest per penerima (Finance, tiap AM) — bukan satu pesan per invoice.
  const groups = new Map<string, { audience: Audience; to: string; amNama?: string; jobs: Job[] }>();
  for (const j of jobs) {
    const to = j.audience === "fin" ? finTarget : (j.row.am_wa as string);
    const gk = `${j.audience}:${to}`;
    const g = groups.get(gk) ?? { audience: j.audience, to, amNama: j.row.am_nama ?? undefined, jobs: [] };
    g.jobs.push(j);
    groups.set(gk, g);
  }

  const messages: InvoiceReminderResult["messages"] = [];
  for (const g of groups.values()) {
    const d = buildReminderDigest(g.jobs.map((j) => j.row), g.audience, today, g.amNama);
    const shown = new Set(d.shownIds);
    const base = { to: g.to, audience: g.audience, invoices: g.jobs.length, shown: shown.size };
    if (opts.dryRun) {
      messages.push({ ...base, sent: false, payload: d.text });
      continue;
    }
    const w = await sendViaWaGateway(g.to, d.text);
    const real = terkirimSungguhan(w);
    if (real) await tandaiTerkirim(g.jobs.filter((j) => shown.has(j.row.id)).map((j) => j.key), today);
    messages.push({ ...base, sent: real, error: w.error });
  }

  return {
    candidates: new Set(jobs.map((j) => j.row.id)).size,
    resync,
    messages,
    finance_target_missing: !finTarget,
    dryRun: Boolean(opts.dryRun),
  };
}

// ── Rekap overdue mingguan (Finance) ─────────────────────────────────────────

export const AGING_BUCKETS = [
  { label: "1–30 hari", min: 1, max: 30 },
  { label: "31–60 hari", min: 31, max: 60 },
  { label: "61–90 hari", min: 61, max: 90 },
  { label: ">90 hari", min: 91, max: Infinity },
] as const;

// Minggu ISO (mis. "2026-W41") dari tanggal WIB "YYYY-MM-DD" — kunci dedupe:
// cron dicek tiap hari kerja, rekap terkirim sekali di hari kerja PERTAMA minggu
// itu (Senin libur → Selasa), bukan hilang seminggu.
export function isoWeek(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7)); // Kamis minggu ini menentukan tahunnya
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((d.getTime() - yearStart) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export const overdueRecapKey = (week: string): string => `f91:odrecap:${week}:fin`;

// Pure — `rows` = invoice overdue (stage od). Ringkasan per umur + N terbesar.
export function buildOverdueRecap(rows: ReminderRow[], today: string, resynced: number, topN: number = MAX_LINES_PER_MESSAGE): string {
  const total = rows.reduce((a, r) => a + r.outstanding, 0);
  const parts = [`🔴 *Rekap Overdue Mingguan* — ${fmtTanggal(today)}`, `${rows.length} invoice · sisa ${rupiah(total)}`, ""];
  for (const b of AGING_BUCKETS) {
    const list = rows.filter((r) => -r.days_to_due >= b.min && -r.days_to_due <= b.max);
    if (list.length) parts.push(`• ${b.label}: ${list.length} invoice · ${rupiah(list.reduce((a, r) => a + r.outstanding, 0))}`);
  }
  const top = [...rows].sort((a, b) => b.outstanding - a.outstanding || a.id - b.id).slice(0, topN);
  if (top.length) {
    parts.push("", `*${top.length} sisa terbesar:*`);
    for (const r of top) {
      parts.push(`• ${r.number} — ${r.customer_name} — ${rupiah(r.outstanding)} — lewat ${-r.days_to_due} hari · AM ${r.am_nama ?? "-"}`);
    }
  }
  parts.push(
    "",
    `ℹ️ Angka dari mirror Accurate; ${resynced} invoice terbesar sudah dicek ulang ke Accurate, sisanya bisa ada yang sudah lunas.`,
    "Detail: menu AR atau #FAKTUR <nomor>",
  );
  return parts.join("\n");
}

export interface OverdueRecapResult {
  week: string;
  invoices: number;
  resync: ResyncInfo;
  sent: boolean;
  skipped?: string;
  error?: string;
  payload?: string;
  dryRun: boolean;
}

export async function runOverdueRecap(opts: { dryRun?: boolean } = {}): Promise<OverdueRecapResult> {
  const today = wibDate();
  const week = isoWeek(today);
  const finTarget = (process.env.INVOICE_REMINDER_FINANCE_TARGET ?? "").trim();
  const base = { week, dryRun: Boolean(opts.dryRun) };
  const empty: ResyncInfo = { attempted: 0, failed: 0, deferred: 0 };
  if (!finTarget) return { ...base, invoices: 0, resync: empty, sent: false, skipped: "INVOICE_REMINDER_FINANCE_TARGET kosong" };
  if (!opts.dryRun) {
    const [done] = await db()`SELECT 1 FROM notif_state WHERE key = ${overdueRecapKey(week)}`;
    if (done) return { ...base, invoices: 0, resync: empty, sent: false, skipped: `sudah terkirim minggu ${week}` };
  }

  // Cek ulang yang PALING BERPENGARUH (sisa terbesar) — yang tampil di daftar.
  let rows = await loadReminderRows(today, ["od"]);
  const prioritas = [...rows].sort((a, b) => b.outstanding - a.outstanding).map((r) => r.id);
  const { info: resync, batch } = await resyncInvoices(prioritas);
  if (batch) rows = await loadReminderRows(today, ["od"]); // status batch sudah segar
  if (!rows.length) return { ...base, invoices: 0, resync, sent: false, skipped: "tidak ada invoice overdue" };

  const text = buildOverdueRecap(rows, today, resync.attempted - resync.failed);
  if (opts.dryRun) return { ...base, invoices: rows.length, resync, sent: false, payload: text };
  const w = await sendViaWaGateway(finTarget, text);
  const real = terkirimSungguhan(w);
  if (real) await tandaiTerkirim([overdueRecapKey(week)], today);
  return { ...base, invoices: rows.length, resync, sent: real, error: w.error };
}
