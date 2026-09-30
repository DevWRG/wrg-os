import { db } from "../db.js";
import { sendViaWaGateway } from "../wasend.js";
import { accurateConfigured, syncAccurateInvoices } from "./accurateSync.js";
import { deriveInvoiceStatus, invoiceDetail, normalizeAccurateDate, type InvoiceStatus } from "./ar.js";
import { fmtRupiah, fmtTanggal } from "./cek.js";
import { joinAmFromSalesman } from "./salesman-am.js";

// F91 Invoice Status Check (#FAKTUR). Dua bagian, satu definisi status
// (deriveInvoiceStatus di ar.ts, juga dipakai dialog detail invoice web):
//
//   1. `#FAKTUR <no_invoice>` → status Open/Paid/Overdue + jatuh tempo + nominal
//      + customer. Siapa pun yang dikenal & aktif boleh (setara #CEK).
//   2. Cron reminder D-7 / D-day / overdue → digest ke Finance
//      (INVOICE_REMINDER_FINANCE_TARGET) + tiap AM (DM master_user.wa_number).
//
// Due date = raw->>'dueDate' dari detail Accurate. SENGAJA bukan
// ar_aging_mv.due_date: mapAccurateInvoice mengisinya dengan transDate kalau
// dueDate kosong, jadi invoice tanpa termin akan tampak overdue palsu.
//
// Mirror invoice hanya disegarkan untuk transDate ≤7 hari (accurate-sync), jadi
// status invoice lama bisa basi (sudah lunas tapi masih OPEN). Sebelum kirim,
// kandidat reminder ditarik ulang satu per satu dari Accurate (read-only).

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
    `Total: ${fmtRupiah(v.total)} · Terbayar: ${fmtRupiah(v.paid)} · Sisa: ${fmtRupiah(v.outstanding)}`,
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

// d7/d0 cukup sekali per invoice; overdue diulang tiap `everyDays` hari selama
// masih outstanding (keputusan user 2026-09-28: sekali + mingguan).
export function reminderDue(stage: ReminderStage, lastSentAt: Date | null, nowMs: number, everyDays: number): boolean {
  if (!lastSentAt) return true;
  if (stage !== "od") return false;
  return nowMs - lastSentAt.getTime() >= everyDays * 86400000 - 3600000; // toleransi 1 jam: jam cron bergeser sedikit
}

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

const STAGE_HEAD: Record<ReminderStage, string> = {
  od: "🔴 *Overdue*",
  d0: "🟠 *Jatuh tempo hari ini*",
  d7: "🟡 *Jatuh tempo ≤7 hari*",
};

export function buildReminderDigest(rows: ReminderRow[], audience: Audience, today: string, amNama?: string): string {
  const head =
    audience === "fin"
      ? `🧾 *Reminder Jatuh Tempo Invoice* — ${fmtTanggal(today)}`
      : `🧾 Halo ${amNama ?? ""}, invoice customer Anda yang perlu ditagih — ${fmtTanggal(today)}`;
  const parts = [head];
  for (const stage of ["od", "d0", "d7"] as ReminderStage[]) {
    const list = rows.filter((r) => r.stage === stage).sort((a, b) => a.days_to_due - b.days_to_due);
    if (!list.length) continue;
    const lines = list.map((r) => {
      const kapan =
        r.days_to_due < 0 ? `lewat ${-r.days_to_due} hari` : r.days_to_due === 0 ? "hari ini" : `${r.days_to_due} hari lagi`;
      const am = audience === "fin" ? ` · AM ${r.am_nama ?? "-"}` : "";
      return `• ${r.number} — ${r.customer_name} — sisa ${fmtRupiah(r.outstanding)} — ${kapan} (${fmtTanggal(r.due_date)})${am}`;
    });
    parts.push(`\n${STAGE_HEAD[stage]} (${list.length})\n${lines.join("\n")}`);
  }
  parts.push("\nDetail: ketik #FAKTUR <nomor>");
  return parts.join("\n");
}

// Invoice OPEN bersisa yang sedang di salah satu tahap reminder. Filter tahap di
// TS (bukan SQL) supaya parsing dueDate memakai normalizeAccurateDate yang sama
// dengan invoiceDetail. Urut yang paling lama tak tersinkron dulu → kalau batas
// re-sync terlampaui, run berikutnya melanjutkan sisanya.
async function loadReminderRows(today: string, ids?: number[]): Promise<ReminderRow[]> {
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
      ${ids ? sql`AND ai.id = ANY(${ids}::bigint[])` : sql``}
    ORDER BY ai.last_synced_at NULLS FIRST, ai.id`;
  const out: ReminderRow[] = [];
  for (const r of rows) {
    const st = deriveInvoiceStatus(
      { status: String(r.status), outstanding: Number(r.outstanding) },
      normalizeAccurateDate(r.due_raw == null ? undefined : String(r.due_raw)),
      today,
    );
    const stage = st.state === "PAID" ? null : reminderStage(st.days_to_due);
    if (!stage || st.due_date == null || st.days_to_due == null) continue;
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

interface Job {
  row: ReminderRow;
  audience: Audience;
  key: string;
}

async function pendingJobs(rows: ReminderRow[], finTarget: string, nowMs: number, everyDays: number): Promise<Job[]> {
  const all: Job[] = [];
  for (const row of rows) {
    if (finTarget) all.push({ row, audience: "fin", key: reminderKey(row.stage, row.id, "fin") });
    if (row.am_wa) all.push({ row, audience: "am", key: reminderKey(row.stage, row.id, "am") });
  }
  if (!all.length) return [];
  const sent = await db()`SELECT key, sent_at FROM notif_state WHERE key = ANY(${all.map((j) => j.key)}::text[])`;
  const last = new Map(sent.map((s) => [String(s.key), s.sent_at ? new Date(s.sent_at as string) : null]));
  return all.filter((j) => reminderDue(j.row.stage, last.get(j.key) ?? null, nowMs, everyDays));
}

export interface InvoiceReminderResult {
  candidates: number;
  resync: { attempted: number; failed: number; deferred: number; skipped?: string };
  messages: { to: string; audience: Audience; invoices: number; sent: boolean; error?: string; payload?: string }[];
  finance_target_missing: boolean;
  dryRun: boolean;
}

export async function runInvoiceReminder(opts: { dryRun?: boolean } = {}): Promise<InvoiceReminderResult> {
  const sql = db();
  const today = wibDate();
  const nowMs = Date.now();
  const finTarget = (process.env.INVOICE_REMINDER_FINANCE_TARGET ?? "").trim();
  const everyDays = Math.max(1, Number(process.env.INVOICE_REMINDER_OVERDUE_EVERY_DAYS) || 7);
  const resyncLimit = Math.max(0, Number(process.env.INVOICE_REMINDER_RESYNC_LIMIT ?? 100) || 0);

  let jobs = await pendingJobs(await loadReminderRows(today), finTarget, nowMs, everyDays);
  const resync: InvoiceReminderResult["resync"] = { attempted: 0, failed: 0, deferred: 0 };

  if (!jobs.length) {
    resync.skipped = "tidak ada kandidat";
  } else if (!accurateConfigured() || resyncLimit === 0) {
    // Tanpa kredensial (dev lokal) / re-sync dimatikan → pakai mirror apa adanya.
    resync.skipped = resyncLimit === 0 ? "INVOICE_REMINDER_RESYNC_LIMIT=0" : "kredensial Accurate tak tersedia";
  } else {
    const ids = [...new Set(jobs.map((j) => j.row.id))];
    const batch = ids.slice(0, resyncLimit);
    resync.deferred = ids.length - batch.length; // dilanjutkan run berikutnya
    for (const id of batch) {
      resync.attempted += 1;
      const r = await syncAccurateInvoices({ invoiceId: id });
      // Gagal tarik ulang → tetap pakai data mirror (paling buruk = sama dengan tanpa re-sync).
      if (!r.ok) resync.failed += 1;
      await new Promise((res) => setTimeout(res, 150));
    }
    jobs = await pendingJobs(await loadReminderRows(today, batch), finTarget, nowMs, everyDays);
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
    const payload = buildReminderDigest(
      g.jobs.map((j) => j.row),
      g.audience,
      today,
      g.amNama,
    );
    if (opts.dryRun) {
      messages.push({ to: g.to, audience: g.audience, invoices: g.jobs.length, sent: false, payload });
      continue;
    }
    const w = await sendViaWaGateway(g.to, payload);
    // w.sent juga true di mode stub & dry-run gateway — hanya kirim sungguhan yang
    // ditandai, supaya reminder tak "hangus" sebelum WA benar-benar aktif.
    const real = w.sent && !w.stub && !w.dryRun;
    if (real) {
      await sql`
        INSERT INTO notif_state (key, signature, count, sent_at)
        SELECT k, ${today}, 1, now() FROM unnest(${g.jobs.map((j) => j.key)}::text[]) AS t(k)
        ON CONFLICT (key) DO UPDATE SET signature = EXCLUDED.signature, count = notif_state.count + 1, sent_at = now()`;
    }
    messages.push({ to: g.to, audience: g.audience, invoices: g.jobs.length, sent: real, error: w.error });
  }

  return {
    candidates: new Set(jobs.map((j) => j.row.id)).size,
    resync,
    messages,
    finance_target_missing: !finTarget,
    dryRun: Boolean(opts.dryRun),
  };
}
