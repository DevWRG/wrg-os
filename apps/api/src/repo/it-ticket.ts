import { db } from "../db.js";
import { sendViaWaGateway } from "../wasend.js";

// F52 — IT Asset & Issue Tracker (OPS). Tiket masalah per aset, SLA dihitung
// saat create. Master aset (`ga_assets`, F132, migrasi 086) DISERAP — bukan
// tabel sendiri lagi, lihat komentar migrasi 087. CRUD aset via /ga-assets
// (repo/ga-asset.ts), file ini cuma tiket.
//
// SLA "24/5" (arahan user, insiden nyata: PC Fakturis 11+ jam offline):
// dihitung hari kerja (Senin-Jumat, skip master_holiday) sbg 24 jam PENUH
// per hari — bukan jam kantor 9-5. Weekend/libur nasional dilewati TOTAL
// (tidak menambah durasi SLA sama sekali), bukan cuma jeda.

const toIsoTs = (x: unknown): string => new Date(x as string | Date).toISOString();

const KRITIS_JAM = Number(process.env.IT_TICKET_SLA_KRITIS_JAM) || 2;
const NORMAL_JAM = Number(process.env.IT_TICKET_SLA_NORMAL_JAM) || 24;

async function isWorkdayDate(dateIso: string): Promise<boolean> {
  const dow = new Date(`${dateIso}T00:00:00Z`).getUTCDay();
  if (dow === 0 || dow === 6) return false;
  const sql = db();
  try {
    const [h] = await sql`SELECT 1 FROM master_holiday WHERE tanggal = ${dateIso} LIMIT 1`;
    return !h;
  } catch {
    return true;
  }
}

// Tambah `jam` jam-kerja ke `start` (WIB), melewati SELURUH hari yang bukan
// hari kerja (bukan cuma menunda ke jam berikutnya di hari itu — tiap hari
// kerja dihitung 24 jam penuh, sesuai "24/5" bukan jam kantor 9-5).
export async function businessHoursFromNow(startMs: number, jam: number): Promise<Date> {
  let remainingMs = jam * 3_600_000;
  let cur = startMs;
  // Batas pengaman: jangan pernah lebih dari 60 iterasi (>60 hari kalender),
  // menghindari infinite loop kalau ada bug tak terduga di isWorkdayDate.
  for (let guard = 0; guard < 60 && remainingMs > 0; guard++) {
    const curWib = new Date(cur + 7 * 3_600_000);
    const dateIso = curWib.toISOString().slice(0, 10);
    const endOfDayWib = Date.UTC(curWib.getUTCFullYear(), curWib.getUTCMonth(), curWib.getUTCDate() + 1);
    const msLeftInDayWib = endOfDayWib - (cur + 7 * 3_600_000);

    if (!(await isWorkdayDate(dateIso))) {
      cur += msLeftInDayWib; // lompat ke 00:00 WIB hari berikutnya, tak mengurangi remainingMs
      continue;
    }
    if (msLeftInDayWib >= remainingMs) {
      cur += remainingMs;
      remainingMs = 0;
    } else {
      remainingMs -= msLeftInDayWib;
      cur += msLeftInDayWib;
    }
  }
  return new Date(cur);
}

export interface ActionResult {
  ok: boolean;
  error?: string;
}

export interface ItTicketRow {
  id: string;
  asset_id: string;
  asset_code: string;
  asset_nama: string;
  is_critical: boolean;
  masalah: string;
  status: string;
  // Nama yang DITAMPILKAN: akun app_user kalau tertaut, kalau tidak nama teks
  // yang diketik (jalur non-karyawan tetap sah — lihat migrasi 087/164).
  reported_by: string | null;
  assigned_to: string | null;
  // Tautan akun; null = memang tak tertaut, bukan "belum diisi".
  reported_by_user_id: string | null;
  assigned_to_user_id: string | null;
  sla_due_at: string;
  sla_overdue: boolean;
  resolved_at: string | null;
  resolved_note: string | null;
  created_at: string;
  updated_at: string;
}

function mapTicketRow(r: Record<string, unknown>): ItTicketRow {
  const slaDueAt = toIsoTs(r.sla_due_at);
  const status = String(r.status);
  return {
    id: String(r.id),
    asset_id: String(r.asset_id),
    asset_code: String(r.asset_code),
    asset_nama: String(r.asset_nama),
    is_critical: Boolean(r.is_critical),
    masalah: String(r.masalah),
    status,
    // Urutan COALESCE: nama akun MENANG atas teks. Teks itu snapshot saat
    // tiket dibuat; kalau orangnya punya akun, nama akun yang sekarang benar
    // (mis. ejaan diperbaiki di /users) — bukan ejaan lama yang diketik.
    reported_by: r.reported_by_user_name
      ? String(r.reported_by_user_name)
      : r.reported_by
        ? String(r.reported_by)
        : null,
    assigned_to: r.assigned_to_user_name
      ? String(r.assigned_to_user_name)
      : r.assigned_to
        ? String(r.assigned_to)
        : null,
    reported_by_user_id: r.reported_by_user_id ? String(r.reported_by_user_id) : null,
    assigned_to_user_id: r.assigned_to_user_id ? String(r.assigned_to_user_id) : null,
    sla_due_at: slaDueAt,
    sla_overdue: status !== "resolved" && new Date(slaDueAt).getTime() < Date.now(),
    resolved_at: r.resolved_at ? toIsoTs(r.resolved_at) : null,
    resolved_note: r.resolved_note ? String(r.resolved_note) : null,
    created_at: toIsoTs(r.created_at),
    updated_at: toIsoTs(r.updated_at),
  };
}

export async function listTickets(statusFilter?: string): Promise<ItTicketRow[]> {
  const sql = db();
  const rows = await sql`
    SELECT t.*, a.asset_code, a.nama AS asset_nama, a.is_critical,
           NULLIF(ru.name, '') AS reported_by_user_name,
           NULLIF(au.name, '') AS assigned_to_user_name
    FROM it_ticket t JOIN ga_assets a ON a.id = t.asset_id
    LEFT JOIN app_user ru ON ru.id = t.reported_by_user_id
    LEFT JOIN app_user au ON au.id = t.assigned_to_user_id
    WHERE ${statusFilter ? sql`t.status = ${statusFilter}` : sql`true`}
    ORDER BY t.created_at DESC
  `;
  return rows.map(mapTicketRow);
}

export interface ItTicketInput {
  asset_id: string;
  masalah: string;
  // Dua jalur yang HIDUP BERSAMA, meniru F139 (reporter_user_id +
  // reporter_name_override): id dipakai kalau orangnya punya akun app_user,
  // teks dipakai kalau tidak (087 sengaja mengizinkan pelapor/PIC di luar HR).
  // Kalau id diisi, teksnya diabaikan — nama diambil dari akun saat dibaca.
  reported_by_user_id?: string | null;
  assigned_to_user_id?: string | null;
  reported_by?: string | null;
  assigned_to?: string | null;
}

export async function createTicket(input: ItTicketInput): Promise<ItTicketRow | ActionResult> {
  const sql = db();
  const masalah = input.masalah.trim();
  if (!masalah) return { ok: false, error: "masalah wajib diisi" };
  const asset = await sql`SELECT id, is_critical FROM ga_assets WHERE id = ${input.asset_id} AND active = true`;
  if (asset.length === 0) return { ok: false, error: "aset tidak ditemukan / nonaktif" };

  // Id akun divalidasi SEBELUM insert supaya pesannya bisa dibaca manusia —
  // tanpa ini FK-nya tetap menolak, tapi lewat error Postgres mentah.
  const userIds = [input.reported_by_user_id, input.assigned_to_user_id].filter(
    (v): v is string => typeof v === "string" && v.trim() !== "",
  );
  if (userIds.length) {
    const found = await sql<{ id: string }[]>`SELECT id::text AS id FROM app_user WHERE id = ANY(${userIds})`;
    const ok = new Set(found.map((r) => r.id));
    const missing = userIds.filter((id) => !ok.has(id));
    if (missing.length) return { ok: false, error: `akun tak ditemukan: ${missing.join(", ")}` };
  }
  // Teks diabaikan kalau id-nya ada — supaya satu tiket tak menyimpan dua
  // versi nama yang bisa bercerita berbeda.
  const reportedText = input.reported_by_user_id ? null : (input.reported_by?.trim() || null);
  const assignedText = input.assigned_to_user_id ? null : (input.assigned_to?.trim() || null);

  const jam = asset[0].is_critical ? KRITIS_JAM : NORMAL_JAM;
  const slaDueAt = await businessHoursFromNow(Date.now(), jam);

  const rows = await sql`
    INSERT INTO it_ticket
      (asset_id, masalah, reported_by, assigned_to, reported_by_user_id, assigned_to_user_id, sla_due_at)
    VALUES (
      ${input.asset_id}, ${masalah}, ${reportedText}, ${assignedText},
      ${input.reported_by_user_id || null}, ${input.assigned_to_user_id || null}, ${slaDueAt.toISOString()}
    )
    RETURNING id
  `;
  const [full] = await sql`
    SELECT t.*, a.asset_code, a.nama AS asset_nama, a.is_critical,
           NULLIF(ru.name, '') AS reported_by_user_name,
           NULLIF(au.name, '') AS assigned_to_user_name
    FROM it_ticket t JOIN ga_assets a ON a.id = t.asset_id
    LEFT JOIN app_user ru ON ru.id = t.reported_by_user_id
    LEFT JOIN app_user au ON au.id = t.assigned_to_user_id
    WHERE t.id = ${rows[0].id}
  `;
  return mapTicketRow(full);
}

export interface ItTicketStatusInput {
  status: "open" | "in_progress" | "resolved";
  assigned_to?: string | null;
  // Alih PIC ke akun app_user. Mengisi ini MENGOSONGKAN `assigned_to` teks
  // (dan sebaliknya) — kalau tidak, satu tiket bisa menyimpan dua nama PIC
  // yang berbeda dan tampilan tergantung urutan COALESCE, bukan kenyataan.
  assigned_to_user_id?: string | null;
  resolved_note?: string | null;
}

export async function updateTicketStatus(id: string, input: ItTicketStatusInput): Promise<ActionResult> {
  const sql = db();
  const rows = await sql`SELECT id, status FROM it_ticket WHERE id = ${id}`;
  if (rows.length === 0) return { ok: false, error: "tiket tidak ditemukan" };
  // resolved bersifat TERMINAL — sekali selesai gak boleh mundur ke
  // open/in_progress. Tanpa guard ini, `resolved_at` (di-set sekali di bawah,
  // gak pernah dikosongkan lagi) jadi basi begitu status ditarik mundur:
  // tiket kelihatan "Baru" tapi tetap punya jejak "sudah pernah selesai" —
  // data kontradiktif. Ditemukan via testing manual jalur tulis (API+UI
  // sama-sama lolos sebelum fix ini).
  if (String(rows[0].status) === "resolved" && input.status !== "resolved") {
    return { ok: false, error: `tiket sudah resolved — tidak bisa diubah ke "${input.status}"` };
  }
  const newUserId = input.assigned_to_user_id?.trim() || null;
  const newText = input.assigned_to?.trim() || null;
  if (newUserId) {
    const found = await sql`SELECT id FROM app_user WHERE id = ${newUserId}`;
    if (found.length === 0) return { ok: false, error: `akun PIC tak ditemukan: ${newUserId}` };
  }
  await sql`
    UPDATE it_ticket SET
      status = ${input.status},
      -- Satu PIC saja: mengeset salah satu jalur mengosongkan jalur lain.
      -- Tak ada yang diset → dua-duanya dibiarkan apa adanya.
      assigned_to = CASE
        WHEN ${newUserId}::uuid IS NOT NULL THEN NULL
        WHEN ${newText}::text IS NOT NULL THEN ${newText}
        ELSE assigned_to END,
      assigned_to_user_id = CASE
        WHEN ${newUserId}::uuid IS NOT NULL THEN ${newUserId}::uuid
        WHEN ${newText}::text IS NOT NULL THEN NULL
        ELSE assigned_to_user_id END,
      resolved_at = CASE WHEN ${input.status} = 'resolved' THEN now() ELSE resolved_at END,
      resolved_note = COALESCE(${input.resolved_note ?? null}, resolved_note),
      updated_at = now()
    WHERE id = ${id}
  `;
  return { ok: true };
}

// ── Cron: alert SLA overdue (tiket belum resolved, sla_due_at terlewati). ──
export async function runItTicketSlaAlerts(): Promise<{ alerts: number }> {
  const sql = db();
  const target = process.env.IT_TICKET_SLA_WA_TARGET || "";
  if (!target) return { alerts: 0 }; // anti broadcast tak sengaja tanpa tujuan jelas

  // Join app_user WAJIB di sini juga, bukan cuma di listTickets: sejak PIC
  // bisa berupa akun (migrasi 164), tiket ber-`assigned_to_user_id` punya
  // kolom teks NULL — tanpa join, pesan WA-nya menulis "PIC: -" untuk tiket
  // yang PIC-nya justru sudah jelas.
  const rows = await sql`
    SELECT t.*, a.asset_code, a.nama AS asset_nama, a.is_critical,
           NULLIF(ru.name, '') AS reported_by_user_name,
           NULLIF(au.name, '') AS assigned_to_user_name
    FROM it_ticket t JOIN ga_assets a ON a.id = t.asset_id
    LEFT JOIN app_user ru ON ru.id = t.reported_by_user_id
    LEFT JOIN app_user au ON au.id = t.assigned_to_user_id
    WHERE t.status <> 'resolved' AND t.sla_due_at < now() AND t.sla_alert_sent_at IS NULL
  `;

  let alerts = 0;
  for (const r of rows) {
    const t = mapTicketRow(r);
    const msg = [
      "🖥️ *SLA Tiket IT Terlewati*",
      `${t.asset_code} — ${t.asset_nama}${t.is_critical ? " (KRITIS)" : ""}`,
      `Masalah: ${t.masalah}`,
      `PIC: ${t.assigned_to ?? "-"}`,
      `Batas SLA: ${t.sla_due_at}`,
    ].join("\n");
    const gw = await sendViaWaGateway(target, msg);
    // gw.sent juga true di mode stub & dry-run — tanpa gerbang ini penanda
    // anti-spam ter-set walau tak ada WA yang benar-benar terkirim, dan
    // alert mati permanen begitu WA_DRY_RUN (default true) dimatikan.
    if (gw.sent && !gw.stub && !gw.dryRun) {
      await sql`UPDATE it_ticket SET sla_alert_sent_at = now() WHERE id = ${t.id}`;
      alerts += 1;
    }
  }
  return { alerts };
}
