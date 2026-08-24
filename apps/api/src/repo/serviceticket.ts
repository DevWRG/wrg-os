import { db } from "../db.js";
import { callAi, aiDryRun } from "../ai.js";
import { sendViaWaGateway } from "../wasend.js";

// postgres.js parse kolom timestamptz jadi objek Date — String(dateObj) hasilnya
// verbose ("Wed Aug 05 2026 …"), bukan ISO. new Date(x).toISOString() aman
// dipanggil baik x sudah Date maupun masih string dari driver.
const toIsoTs = (x: unknown): string => new Date(x as string | Date).toISOString();

// F26 — Service Ticket Triage (AFTERSALES). LLM classify komplain customer
// (severity + area) → auto-assign teknisi (area match, least-loaded) → ETA.
// Self-contained: teknisi_roster/service_ticket TIDAK FK ke installation_unit
// (F22) atau domain lain — lihat 135_service_ticket_triage.sql.
//
// teknisi_roster READ-ONLY dari sisi app — data di-seed via
// scripts/db/seed-dev-full.sql (tidak ada create/edit di F26 ini, per
// keputusan "pakai seed dulu" — lihat plan).

export interface Teknisi {
  id: string;
  nama: string;
  wa_number: string | null;
  area: string[];
  aktif: boolean;
  created_at: string;
}

function mapTeknisi(r: Record<string, unknown>): Teknisi {
  return {
    id: String(r.id),
    nama: String(r.nama),
    wa_number: r.wa_number ? String(r.wa_number) : null,
    area: Array.isArray(r.area) ? (r.area as string[]) : [],
    aktif: Boolean(r.aktif),
    created_at: String(r.created_at),
  };
}

export async function listTeknisi(aktifOnly = false): Promise<Teknisi[]> {
  const sql = db();
  const rows = await sql`
    SELECT * FROM teknisi_roster WHERE ${aktifOnly ? sql`aktif = TRUE` : sql`true`} ORDER BY nama
  `;
  return rows.map(mapTeknisi);
}

interface AssignedTeknisi {
  id: string;
  nama: string;
  wa_number: string | null;
  areaMatched: boolean; // false = area diberikan tapi tak match siapa pun (fallback dipakai)
}

// Auto-assign: coba match area dulu (case-insensitive — LLM/manual bisa beda
// kapitalisasi/spasi dari yang tersimpan di roster). Kalau area diisi tapi TAK
// match teknisi manapun (atau area kosong), FALLBACK ke teknisi aktif mana pun
// yang paling sedikit beban — jangan pernah dibiarkan unassigned kalau ada
// teknisi aktif tersedia. `areaMatched=false` menandai fallback ini dipakai,
// dipakai caller utk set needs_review (area asli mungkin salah/typo, perlu
// dicek admin) — beda dgn kondisi "area kosong dari awal" yang normal/aman.
async function assignTeknisi(area: string | null): Promise<AssignedTeknisi | null> {
  const sql = db();

  if (area) {
    const matched = await sql`
      SELECT tr.id, tr.nama, tr.wa_number,
        (SELECT COUNT(*) FROM service_ticket st WHERE st.assigned_teknisi_id = tr.id AND st.status = 'open') AS load
      FROM teknisi_roster tr
      WHERE tr.aktif = TRUE AND EXISTS (SELECT 1 FROM unnest(tr.area) a WHERE a ILIKE ${area})
      ORDER BY load ASC, tr.created_at ASC
      LIMIT 1
    `;
    if (matched.length) {
      return {
        id: String(matched[0].id),
        nama: String(matched[0].nama),
        wa_number: matched[0].wa_number ? String(matched[0].wa_number) : null,
        areaMatched: true,
      };
    }
  }

  // Fallback: area kosong, ATAU area diisi tapi tak match siapa pun.
  const rows = await sql`
    SELECT tr.id, tr.nama, tr.wa_number,
      (SELECT COUNT(*) FROM service_ticket st WHERE st.assigned_teknisi_id = tr.id AND st.status = 'open') AS load
    FROM teknisi_roster tr
    WHERE tr.aktif = TRUE
    ORDER BY load ASC, tr.created_at ASC
    LIMIT 1
  `;
  return rows.length
    ? {
        id: String(rows[0].id),
        nama: String(rows[0].nama),
        wa_number: rows[0].wa_number ? String(rows[0].wa_number) : null,
        areaMatched: !area, // area kosong dari awal → bukan mismatch, jangan flag review
      }
    : null;
}

// ETA per severity, jam configurable via env TICKET_ETA_HOURS_<SEVERITY> tanpa ubah kode.
function etaHours(severity: string): number {
  const envKey = `TICKET_ETA_HOURS_${severity.toUpperCase()}`;
  const defaults: Record<string, number> = { kritis: 2, tinggi: 4, sedang: 24, rendah: 72 };
  const override = process.env[envKey];
  return override ? Number(override) : (defaults[severity] ?? 24);
}

const SEVERITY_LABEL: Record<string, string> = {
  kritis: "🔴 KRITIS", tinggi: "🟠 Tinggi", sedang: "🟡 Sedang", rendah: "🟢 Rendah",
};

function formatEta(etaAt: Date): string {
  return etaAt.toLocaleString("id-ID", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" }) + " WIB";
}

export interface CreateTicketInput {
  complaint_text: string;
  customer_name?: string | null;
  area?: string | null; // override manual (form) — kalau kosong, dipakai hasil LLM
  source?: "manual" | "wa";
  group_jid?: string | null;
  wa_message_id?: string | null;
}

export interface TicketRow {
  id: string;
  source: string;
  customer_name: string | null;
  group_jid: string | null;
  wa_message_id: string | null;
  complaint_text: string;
  area: string | null;
  severity: string;
  eta_at: string | null;
  assigned_teknisi_id: string | null;
  assigned_teknisi_name: string | null;
  needs_review: boolean;
  model_used: string | null;
  status: string;
  resolved_at: string | null;
  resolved_note: string | null;
  created_at: string;
  updated_at: string;
}

function mapTicket(r: Record<string, unknown>): TicketRow {
  return {
    id: String(r.id),
    source: String(r.source),
    customer_name: r.customer_name ? String(r.customer_name) : null,
    group_jid: r.group_jid ? String(r.group_jid) : null,
    wa_message_id: r.wa_message_id ? String(r.wa_message_id) : null,
    complaint_text: String(r.complaint_text),
    area: r.area ? String(r.area) : null,
    severity: String(r.severity),
    eta_at: r.eta_at ? toIsoTs(r.eta_at) : null,
    assigned_teknisi_id: r.assigned_teknisi_id ? String(r.assigned_teknisi_id) : null,
    assigned_teknisi_name: r.assigned_teknisi_name ? String(r.assigned_teknisi_name) : null,
    needs_review: Boolean(r.needs_review),
    model_used: r.model_used ? String(r.model_used) : null,
    status: String(r.status),
    resolved_at: r.resolved_at ? toIsoTs(r.resolved_at) : null,
    resolved_note: r.resolved_note ? String(r.resolved_note) : null,
    created_at: toIsoTs(r.created_at),
    updated_at: toIsoTs(r.updated_at),
  };
}

export async function createTicket(input: CreateTicketInput): Promise<TicketRow> {
  const sql = db();

  // Idempotensi jalur WA: pesan yang sudah pernah bikin ticket → return existing.
  if (input.wa_message_id) {
    const existing = await sql`SELECT * FROM service_ticket WHERE wa_message_id = ${input.wa_message_id}`;
    if (existing.length) return mapTicket(existing[0]);
  }

  // 1. Klasifikasi via services/ai (severity + area kalau input.area kosong)
  const { status, data } = await callAi("/triage-ticket", { complaint_text: input.complaint_text, dry_run: aiDryRun() });
  const llmFailed = status >= 400;
  const severityUncertain = !llmFailed && Boolean(data.severity_uncertain);
  const severity = llmFailed ? "sedang" : String(data.severity ?? "sedang");
  const area = input.area || (llmFailed ? null : ((data.area as string | null) ?? null));
  const modelUsed = llmFailed ? "error" : String(data.model ?? "");

  // 2. Auto-assign teknisi (selalu dapat teknisi kalau ada yang aktif — lihat
  // assignTeknisi: fallback ke least-loaded kalau area tak match siapa pun).
  const teknisi = await assignTeknisi(area);
  const needsReview =
    llmFailed || modelUsed === "dry-run-fallback" || severityUncertain || !teknisi || !teknisi.areaMatched;
  const etaAt = new Date(Date.now() + etaHours(severity) * 3600 * 1000);

  const rows = await sql`
    INSERT INTO service_ticket
      (source, customer_name, group_jid, wa_message_id, complaint_text, area, severity,
       eta_at, assigned_teknisi_id, assigned_teknisi_name, needs_review, model_used)
    VALUES (
      ${input.source ?? "manual"}, ${input.customer_name ?? null}, ${input.group_jid ?? null},
      ${input.wa_message_id ?? null}, ${input.complaint_text}, ${area}, ${severity},
      ${etaAt}, ${teknisi?.id ?? null}, ${teknisi?.nama ?? null}, ${needsReview}, ${modelUsed}
    )
    RETURNING *
  `;
  const ticket = mapTicket(rows[0]);

  // 3. Notify teknisi via WA (kalau ketemu & punya nomor)
  if (teknisi?.wa_number) {
    const msg = [
      `${SEVERITY_LABEL[severity] ?? severity} — Tiket servis baru`,
      ticket.customer_name ? `Customer: ${ticket.customer_name}` : null,
      `Komplain: ${ticket.complaint_text}`,
      `ETA respon: ${formatEta(etaAt)}`,
    ].filter(Boolean).join("\n");
    await sendViaWaGateway(teknisi.wa_number, msg);
  }

  // 4. Ack ke grup WA (kalau dari jalur WA & ada group_jid)
  if (input.source === "wa" && input.group_jid) {
    const ackMsg = [
      `${SEVERITY_LABEL[severity] ?? severity} — komplain diterima ✅`,
      `Teknisi: ${teknisi?.nama ?? "menunggu ditugaskan admin"}`,
      `Estimasi respon: ${formatEta(etaAt)}`,
    ].join("\n");
    await sendViaWaGateway(input.group_jid, ackMsg);
  }

  return ticket;
}

export async function listTickets(status?: string): Promise<TicketRow[]> {
  const sql = db();
  const rows = await sql`
    SELECT * FROM service_ticket WHERE ${status ? sql`status = ${status}` : sql`true`} ORDER BY created_at DESC
  `;
  return rows.map(mapTicket);
}

export async function getTicketById(id: string): Promise<TicketRow | null> {
  const sql = db();
  const rows = await sql`SELECT * FROM service_ticket WHERE id = ${id}`;
  return rows.length ? mapTicket(rows[0]) : null;
}

export async function resolveTicket(id: string, note?: string): Promise<{ ok: boolean; error?: string }> {
  const sql = db();
  const rows = await sql`
    UPDATE service_ticket
    SET status = 'resolved', resolved_at = now(), resolved_note = ${note ?? null}, updated_at = now()
    WHERE id = ${id} AND status = 'open'
    RETURNING id
  `;
  if (rows.length === 0) {
    const exists = await sql`SELECT status FROM service_ticket WHERE id = ${id}`;
    if (exists.length === 0) return { ok: false, error: "ticket tidak ditemukan" };
    return { ok: false, error: "ticket sudah resolved" };
  }
  return { ok: true };
}

// Dipanggil dari inbound.ts — cek apakah pengirim (by pushname) adalah teknisi
// terdaftar (best-effort, sender_name di grup WA tidak reliable — lihat plan).
export async function isKnownTeknisiSender(senderName: string | null): Promise<boolean> {
  if (!senderName?.trim()) return false;
  const sql = db();
  const rows = await sql`SELECT 1 FROM teknisi_roster WHERE aktif = TRUE AND nama ILIKE ${`%${senderName.trim()}%`} LIMIT 1`;
  return rows.length > 0;
}
