import { db } from "../db.js";
import { sendViaWaGateway } from "../wasend.js";

// F20 — E-Catalog/LPSE Compliance Tracker. Standalone dari dev, tak sentuh
// Accurate/CRM-core/HR (lihat 095_lpse_tender_tracker.sql). Status 3-step
// manual via web (blueprint: Hashtag "-", tak ada ingestion WA sama sekali).

const toIsoTs = (x: unknown): string => new Date(x as string | Date).toISOString();
const toIsoTsOrNull = (x: unknown): string | null => (x == null ? null : toIsoTs(x));

export interface ActionResult {
  ok: boolean;
  error?: string;
}

export interface LpseTenderRow {
  id: string;
  tender_no: string | null;
  judul: string;
  instansi: string;
  platform: string;
  pic_employee_id: string | null;
  pic_nama: string | null;
  dept: string | null;
  dept_label: string | null;
  status: string;
  pesan_masuk_at: string;
  barang_dikirim_at: string | null;
  selesai_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

function mapTenderRow(r: Record<string, unknown>): LpseTenderRow {
  return {
    id: String(r.id),
    tender_no: r.tender_no ? String(r.tender_no) : null,
    judul: String(r.judul),
    instansi: String(r.instansi),
    platform: String(r.platform),
    pic_employee_id: r.pic_employee_id ? String(r.pic_employee_id) : null,
    pic_nama: r.pic_nama ? String(r.pic_nama) : null,
    dept: r.dept ? String(r.dept) : null,
    dept_label: r.dept_label ? String(r.dept_label) : null,
    status: String(r.status),
    pesan_masuk_at: toIsoTs(r.pesan_masuk_at),
    barang_dikirim_at: toIsoTsOrNull(r.barang_dikirim_at),
    selesai_at: toIsoTsOrNull(r.selesai_at),
    notes: r.notes ? String(r.notes) : null,
    created_at: toIsoTs(r.created_at),
    updated_at: toIsoTs(r.updated_at),
  };
}

export interface LpseTenderListFilter {
  status?: string;
}

export async function listTenders(filter: LpseTenderListFilter = {}): Promise<LpseTenderRow[]> {
  const sql = db();
  const rows = await sql`
    SELECT t.*, e.nama AS pic_nama, d.label AS dept_label
    FROM lpse_tender t
    LEFT JOIN employee e ON e.id = t.pic_employee_id
    LEFT JOIN department d ON d.key = t.dept
    WHERE ${filter.status ? sql`t.status = ${filter.status}` : sql`true`}
    ORDER BY t.created_at DESC
  `;
  return rows.map(mapTenderRow);
}

export async function getTender(id: string): Promise<LpseTenderRow | null> {
  const sql = db();
  const rows = await sql`
    SELECT t.*, e.nama AS pic_nama, d.label AS dept_label
    FROM lpse_tender t
    LEFT JOIN employee e ON e.id = t.pic_employee_id
    LEFT JOIN department d ON d.key = t.dept
    WHERE t.id = ${id}
  `;
  return rows.length ? mapTenderRow(rows[0]) : null;
}

export interface CreateTenderInput {
  tender_no?: string | null;
  judul: string;
  instansi: string;
  platform?: string;
  pic_employee_id?: string | null;
  dept?: string | null;
  notes?: string | null;
  created_by_user_id?: string | null;
}

export async function createTender(input: CreateTenderInput): Promise<LpseTenderRow | ActionResult> {
  const sql = db();
  const judul = input.judul.trim();
  const instansi = input.instansi.trim();
  if (!judul || !instansi) return { ok: false, error: "judul & instansi wajib" };
  const platform = input.platform ?? "lpse";
  if (!["lpse", "e_catalog"].includes(platform)) return { ok: false, error: "platform harus lpse atau e_catalog" };

  if (input.pic_employee_id) {
    const [pic] = await sql`SELECT 1 FROM employee WHERE id = ${input.pic_employee_id}`;
    if (!pic) return { ok: false, error: "pic_employee_id tidak ditemukan" };
  }

  const rows = await sql`
    INSERT INTO lpse_tender (tender_no, judul, instansi, platform, pic_employee_id, dept, notes, created_by_user_id)
    VALUES (
      ${input.tender_no ?? null}, ${judul}, ${instansi}, ${platform},
      ${input.pic_employee_id ?? null}, ${input.dept ?? "penawaran"}, ${input.notes ?? null},
      ${input.created_by_user_id ?? null}
    )
    RETURNING id
  `;
  return (await getTender(String(rows[0].id))) as LpseTenderRow;
}

// ── State machine — forward-only, pesan_masuk -> barang_dikirim -> selesai.
// Tak ada status batal/gagal (blueprint tak menyebutnya, lihat plan F20).
const TRANSITIONS: Record<string, string[]> = {
  pesan_masuk: ["barang_dikirim"],
  barang_dikirim: ["selesai"],
  selesai: [],
};

export async function advanceStatus(
  id: string,
  toStatus: string,
  opts: { changed_by_user_id?: string | null; note?: string | null } = {},
): Promise<ActionResult> {
  const sql = db();
  const [row] = await sql`SELECT status FROM lpse_tender WHERE id = ${id}`;
  if (!row) return { ok: false, error: "tender tidak ditemukan" };
  const fromStatus = String(row.status);
  const allowed = TRANSITIONS[fromStatus] ?? [];
  if (!allowed.includes(toStatus)) {
    return { ok: false, error: `transisi "${fromStatus}" -> "${toStatus}" tidak diizinkan` };
  }

  // reminder_sent_at direset tiap naik status supaya status berikutnya
  // punya jam macet sendiri (pola sama F38 alert_tier_terkirim).
  if (toStatus === "barang_dikirim") {
    await sql`
      UPDATE lpse_tender SET status = ${toStatus}, barang_dikirim_at = now(), reminder_sent_at = NULL, updated_at = now()
      WHERE id = ${id}
    `;
  } else if (toStatus === "selesai") {
    await sql`
      UPDATE lpse_tender SET status = ${toStatus}, selesai_at = now(), reminder_sent_at = NULL, updated_at = now()
      WHERE id = ${id}
    `;
  } else {
    await sql`UPDATE lpse_tender SET status = ${toStatus}, reminder_sent_at = NULL, updated_at = now() WHERE id = ${id}`;
  }

  await sql`
    INSERT INTO lpse_tender_status_log (tender_id, from_status, to_status, changed_by_user_id, note)
    VALUES (${id}, ${fromStatus}, ${toStatus}, ${opts.changed_by_user_id ?? null}, ${opts.note ?? null})
  `;
  return { ok: true };
}

export interface LpseTenderTimelineEntry {
  from_status: string;
  to_status: string;
  actor_name: string | null;
  note: string | null;
  at: string;
}

export async function getTenderTimeline(tenderId: string): Promise<LpseTenderTimelineEntry[]> {
  const sql = db();
  const rows = await sql`
    SELECT sl.from_status, sl.to_status, sl.note, sl.created_at, u.name AS actor_name
    FROM lpse_tender_status_log sl
    LEFT JOIN app_user u ON u.id = sl.changed_by_user_id
    WHERE sl.tender_id = ${tenderId}
    ORDER BY sl.created_at ASC
  `;
  return rows.map((r) => ({
    from_status: String(r.from_status),
    to_status: String(r.to_status),
    actor_name: r.actor_name ? String(r.actor_name) : null,
    note: r.note ? String(r.note) : null,
    at: toIsoTs(r.created_at),
  }));
}

// ── Cron: reminder kalau tender macet > N hari di status berjalan (belum
// selesai). Target WA PIC saja — skip diam-diam kalau PIC/WA kosong (bukan
// fallback ke siapa pun), pola sama runGaHelpdeskOverdueAlert.
export async function runLpseTenderReminder(): Promise<{ alerts: number }> {
  const sql = db();
  const days = Number(process.env.LPSE_TENDER_REMINDER_DAYS ?? 3) || 3;
  const rows = await sql`
    SELECT t.*, e.nama AS pic_nama, e.whatsapp AS pic_wa, d.label AS dept_label
    FROM lpse_tender t
    LEFT JOIN employee e ON e.id = t.pic_employee_id
    LEFT JOIN department d ON d.key = t.dept
    WHERE t.status <> 'selesai'
      AND t.reminder_sent_at IS NULL
      AND (CASE t.status WHEN 'pesan_masuk' THEN t.pesan_masuk_at ELSE t.barang_dikirim_at END) < now() - (${days} || ' days')::interval
  `;
  if (!rows.length) return { alerts: 0 };

  let alerts = 0;
  for (const r of rows) {
    const t = mapTenderRow(r);
    const wa = r.pic_wa ? String(r.pic_wa) : null;
    if (!wa) continue; // anti-broadcast tak sengaja tanpa PIC/WA jelas

    const stepLabel = t.status === "pesan_masuk" ? "pesan masuk" : "barang dikirim";
    const msg = [
      "📋 *Reminder Tender LPSE/E-Catalog Macet*",
      `${t.judul} — ${t.instansi}`,
      `Status "${stepLabel}" sudah ${days}+ hari belum lanjut.`,
      t.tender_no ? `No. Tender: ${t.tender_no}` : null,
    ]
      .filter(Boolean)
      .join("\n");

    const gw = await sendViaWaGateway(wa, msg);
    // gw.sent juga true di mode stub & dry-run — penanda anti-spam HANYA
    // ditulis kalau benar-benar terkirim, pola sama F38/F45/F139.
    if (gw.sent && !gw.stub && !gw.dryRun) {
      await sql`UPDATE lpse_tender SET reminder_sent_at = now() WHERE id = ${t.id}`;
      alerts += 1;
    }
  }
  return { alerts };
}
