import { db } from "../db.js";
import { sendViaWaGateway } from "../wasend.js";

// F139 — GA Helpdesk Ticket System (Ticketing Kendala Operasional). Standalone
// dari dev (state machine disederhanakan dari source gais atas pilihan user —
// lihat 092_ga_helpdesk_ticket_system.sql). SLA kalender biasa (BUKAN 24/5
// businessHoursFromNow F52 — brief F139 tak sebut 24/5 sama sekali).

const toIsoTs = (x: unknown): string => new Date(x as string | Date).toISOString();
const toIsoTsOrNull = (x: unknown): string | null => (x == null ? null : toIsoTs(x));

export interface ActionResult {
  ok: boolean;
  error?: string;
}

// ───────────────────────── Kategori ─────────────────────────

export interface GaTicketCategoryRow {
  id: string;
  code: string;
  nama: string;
  icon: string | null;
  default_sla_hours: number;
  default_priority: string;
  active: boolean;
}

function mapCategoryRow(r: Record<string, unknown>): GaTicketCategoryRow {
  return {
    id: String(r.id),
    code: String(r.code),
    nama: String(r.nama),
    icon: r.icon ? String(r.icon) : null,
    default_sla_hours: Number(r.default_sla_hours),
    default_priority: String(r.default_priority),
    active: Boolean(r.active),
  };
}

export async function listCategories(activeOnly = false): Promise<GaTicketCategoryRow[]> {
  const sql = db();
  const rows = await sql`
    SELECT * FROM ga_ticket_categories WHERE ${activeOnly ? sql`active = true` : sql`true`} ORDER BY nama
  `;
  return rows.map(mapCategoryRow);
}

export interface CreateCategoryInput {
  code: string;
  nama: string;
  icon?: string | null;
  default_sla_hours?: number;
  default_priority?: string;
}

export async function createCategory(input: CreateCategoryInput): Promise<GaTicketCategoryRow | ActionResult> {
  const sql = db();
  const code = input.code.trim().toUpperCase();
  const nama = input.nama.trim();
  if (!code || !nama) return { ok: false, error: "code & nama wajib" };
  const existing = await sql`SELECT 1 FROM ga_ticket_categories WHERE code = ${code}`;
  if (existing.length) return { ok: false, error: `code "${code}" sudah dipakai` };
  const rows = await sql`
    INSERT INTO ga_ticket_categories (code, nama, icon, default_sla_hours, default_priority)
    VALUES (${code}, ${nama}, ${input.icon ?? null}, ${input.default_sla_hours ?? 24}, ${input.default_priority ?? "medium"})
    RETURNING *
  `;
  return mapCategoryRow(rows[0]);
}

export interface UpdateCategoryInput {
  nama?: string;
  icon?: string | null;
  default_sla_hours?: number;
  default_priority?: string;
}

export async function updateCategory(id: string, input: UpdateCategoryInput): Promise<GaTicketCategoryRow | ActionResult> {
  const sql = db();
  const current = await sql`SELECT * FROM ga_ticket_categories WHERE id = ${id}`;
  if (!current.length) return { ok: false, error: "kategori tidak ditemukan" };
  const nama = input.nama ?? String(current[0].nama);
  const icon = input.icon !== undefined ? input.icon : (current[0].icon as string | null);
  const slaHours = input.default_sla_hours ?? Number(current[0].default_sla_hours);
  const priority = input.default_priority ?? String(current[0].default_priority);
  const rows = await sql`
    UPDATE ga_ticket_categories
    SET nama = ${nama}, icon = ${icon}, default_sla_hours = ${slaHours}, default_priority = ${priority}, updated_at = now()
    WHERE id = ${id}
    RETURNING *
  `;
  return mapCategoryRow(rows[0]);
}

export async function deactivateCategory(id: string): Promise<ActionResult> {
  const sql = db();
  const rows = await sql`UPDATE ga_ticket_categories SET active = false, updated_at = now() WHERE id = ${id} RETURNING id`;
  if (!rows.length) return { ok: false, error: "kategori tidak ditemukan" };
  return { ok: true };
}

// ───────────────────────── Tiket ─────────────────────────

export interface GaTicketRow {
  id: string;
  ticket_no: string;
  title: string;
  description: string | null;
  category_id: string;
  category_nama: string;
  category_icon: string | null;
  priority: string;
  reporter_user_id: string | null;
  reporter_name: string | null;
  assignee_user_id: string | null;
  assignee_name: string | null;
  location: string | null;
  sla_due_at: string;
  sla_overdue: boolean;
  status: string;
  opened_at: string;
  started_at: string | null;
  completed_at: string | null;
  closed_at: string | null;
  rating: number | null;
  rating_comment: string | null;
  created_at: string;
  updated_at: string;
}

function mapTicketRow(r: Record<string, unknown>): GaTicketRow {
  const slaDueAt = toIsoTs(r.sla_due_at);
  const status = String(r.status);
  return {
    id: String(r.id),
    ticket_no: String(r.ticket_no),
    title: String(r.title),
    description: r.description ? String(r.description) : null,
    category_id: String(r.category_id),
    category_nama: String(r.category_nama),
    category_icon: r.category_icon ? String(r.category_icon) : null,
    priority: String(r.priority),
    reporter_user_id: r.reporter_user_id ? String(r.reporter_user_id) : null,
    reporter_name: r.reporter_name_override ? String(r.reporter_name_override) : r.reporter_user_name ? String(r.reporter_user_name) : null,
    assignee_user_id: r.assignee_user_id ? String(r.assignee_user_id) : null,
    assignee_name: r.assignee_name_override ? String(r.assignee_name_override) : r.assignee_user_name ? String(r.assignee_user_name) : null,
    location: r.location ? String(r.location) : null,
    sla_due_at: slaDueAt,
    sla_overdue: !["completed", "closed", "cancelled"].includes(status) && new Date(slaDueAt).getTime() < Date.now(),
    status,
    opened_at: toIsoTs(r.opened_at),
    started_at: toIsoTsOrNull(r.started_at),
    completed_at: toIsoTsOrNull(r.completed_at),
    closed_at: toIsoTsOrNull(r.closed_at),
    rating: r.rating == null ? null : Number(r.rating),
    rating_comment: r.rating_comment ? String(r.rating_comment) : null,
    created_at: toIsoTs(r.created_at),
    updated_at: toIsoTs(r.updated_at),
  };
}

async function generateTicketNo(): Promise<string> {
  const sql = db();
  const [row] = await sql`
    SELECT 'TKT-' || TO_CHAR(NOW(), 'YYYY') || '-' ||
           LPAD((COALESCE(MAX(SUBSTRING(ticket_no FROM 10)::int), 0) + 1)::text, 5, '0') AS next_no
    FROM ga_tickets
    WHERE ticket_no LIKE 'TKT-' || TO_CHAR(NOW(), 'YYYY') || '-%'
  `;
  return String(row.next_no);
}

export interface GaTicketListFilter {
  status?: string;
  overdue?: boolean;
}

export async function listTickets(filter: GaTicketListFilter = {}): Promise<GaTicketRow[]> {
  const sql = db();
  const rows = await sql`
    SELECT t.*, c.nama AS category_nama, c.icon AS category_icon,
      ru.name AS reporter_user_name, au.name AS assignee_user_name
    FROM ga_tickets t
    JOIN ga_ticket_categories c ON c.id = t.category_id
    LEFT JOIN app_user ru ON ru.id = t.reporter_user_id
    LEFT JOIN app_user au ON au.id = t.assignee_user_id
    WHERE ${filter.status ? sql`t.status = ${filter.status}` : sql`true`}
      AND ${filter.overdue ? sql`t.sla_due_at < now() AND t.status NOT IN ('completed','closed','cancelled')` : sql`true`}
    ORDER BY t.created_at DESC
  `;
  return rows.map(mapTicketRow);
}

export async function getTicket(id: string): Promise<GaTicketRow | null> {
  const sql = db();
  const rows = await sql`
    SELECT t.*, c.nama AS category_nama, c.icon AS category_icon,
      ru.name AS reporter_user_name, au.name AS assignee_user_name
    FROM ga_tickets t
    JOIN ga_ticket_categories c ON c.id = t.category_id
    LEFT JOIN app_user ru ON ru.id = t.reporter_user_id
    LEFT JOIN app_user au ON au.id = t.assignee_user_id
    WHERE t.id = ${id}
  `;
  return rows.length ? mapTicketRow(rows[0]) : null;
}

export interface CreateTicketInput {
  title: string;
  description?: string | null;
  category_id: string;
  priority?: string | null; // override kategori
  reporter_user_id?: string | null;
  reporter_name_override?: string | null;
  location?: string | null;
  sla_hours_override?: number | null;
}

export async function createTicket(input: CreateTicketInput): Promise<GaTicketRow | ActionResult> {
  const sql = db();
  const title = input.title.trim();
  if (!title) return { ok: false, error: "title wajib" };
  if (!input.reporter_user_id && !input.reporter_name_override?.trim()) {
    return { ok: false, error: "reporter wajib (pilih user atau isi nama)" };
  }
  const [cat] = await sql`SELECT * FROM ga_ticket_categories WHERE id = ${input.category_id} AND active = true`;
  if (!cat) return { ok: false, error: "kategori tidak ditemukan / nonaktif" };

  const priority = input.priority ?? String(cat.default_priority);
  const slaHours = input.sla_hours_override ?? Number(cat.default_sla_hours);
  const slaDueAt = new Date(Date.now() + slaHours * 3_600_000);
  const ticketNo = await generateTicketNo();

  const rows = await sql`
    INSERT INTO ga_tickets (
      ticket_no, title, description, category_id, priority,
      reporter_user_id, reporter_name_override, location, sla_hours_override, sla_due_at
    ) VALUES (
      ${ticketNo}, ${title}, ${input.description ?? null}, ${input.category_id}, ${priority},
      ${input.reporter_user_id ?? null}, ${input.reporter_name_override ?? null}, ${input.location ?? null},
      ${input.sla_hours_override ?? null}, ${slaDueAt.toISOString()}
    )
    RETURNING id
  `;
  return (await getTicket(String(rows[0].id))) as GaTicketRow;
}

export interface AssignTicketInput {
  assignee_user_id?: string | null;
  assignee_name_override?: string | null;
}

export async function assignTicket(id: string, input: AssignTicketInput): Promise<ActionResult> {
  const sql = db();
  if (!input.assignee_user_id && !input.assignee_name_override?.trim()) {
    return { ok: false, error: "assignee wajib (pilih user atau isi nama)" };
  }
  const rows = await sql`
    UPDATE ga_tickets SET assignee_user_id = ${input.assignee_user_id ?? null},
      assignee_name_override = ${input.assignee_name_override ?? null}, updated_at = now()
    WHERE id = ${id}
    RETURNING id
  `;
  if (!rows.length) return { ok: false, error: "tiket tidak ditemukan" };
  return { ok: true };
}

// ── State machine ── open -> in_progress -> waiting <-> in_progress -> completed -> closed; cancelled dari open/in_progress/waiting.
const TRANSITIONS: Record<string, string[]> = {
  open: ["in_progress", "cancelled"],
  in_progress: ["waiting", "completed", "cancelled"],
  waiting: ["in_progress", "cancelled"],
  completed: ["closed"],
  closed: [],
  cancelled: [],
};

export async function transitionTicket(
  id: string,
  toStatus: string,
  opts: { changed_by_user_id?: string | null; note?: string | null } = {},
): Promise<ActionResult> {
  const sql = db();
  const [row] = await sql`SELECT status FROM ga_tickets WHERE id = ${id}`;
  if (!row) return { ok: false, error: "tiket tidak ditemukan" };
  const fromStatus = String(row.status);
  const allowed = TRANSITIONS[fromStatus] ?? [];
  if (!allowed.includes(toStatus)) {
    return { ok: false, error: `transisi "${fromStatus}" -> "${toStatus}" tidak diizinkan` };
  }

  // sql`` (fragment kosong) TETAP truthy sbg object — jangan pakai trik
  // "stageTs ? sql`, ${stageTs}` : sql``", cabang if/else lengkap lebih aman.
  if (toStatus === "in_progress" && fromStatus === "open") {
    await sql`UPDATE ga_tickets SET status = ${toStatus}, started_at = COALESCE(started_at, now()), updated_at = now() WHERE id = ${id}`;
  } else if (toStatus === "completed") {
    await sql`UPDATE ga_tickets SET status = ${toStatus}, completed_at = now(), updated_at = now() WHERE id = ${id}`;
  } else if (toStatus === "closed") {
    await sql`UPDATE ga_tickets SET status = ${toStatus}, closed_at = now(), updated_at = now() WHERE id = ${id}`;
  } else {
    await sql`UPDATE ga_tickets SET status = ${toStatus}, updated_at = now() WHERE id = ${id}`;
  }
  await sql`
    INSERT INTO ga_ticket_status_log (ticket_id, from_status, to_status, changed_by_user_id, note)
    VALUES (${id}, ${fromStatus}, ${toStatus}, ${opts.changed_by_user_id ?? null}, ${opts.note ?? null})
  `;
  return { ok: true };
}

export async function rateTicket(id: string, rating: number, comment?: string | null): Promise<ActionResult> {
  const sql = db();
  if (!(rating >= 1 && rating <= 5)) return { ok: false, error: "rating harus 1-5" };
  const [row] = await sql`SELECT status FROM ga_tickets WHERE id = ${id}`;
  if (!row) return { ok: false, error: "tiket tidak ditemukan" };
  if (!["completed", "closed"].includes(String(row.status))) {
    return { ok: false, error: "rating hanya bisa diisi setelah tiket completed/closed" };
  }
  await sql`UPDATE ga_tickets SET rating = ${rating}, rating_comment = ${comment ?? null}, updated_at = now() WHERE id = ${id}`;
  return { ok: true };
}

// ───────────────────────── Comments + timeline ─────────────────────────

export interface GaTicketCommentRow {
  id: string;
  comment: string;
  is_internal: boolean;
  created_by_name: string | null;
  created_at: string;
}

export async function addComment(
  ticketId: string,
  input: { comment: string; is_internal?: boolean; created_by_user_id?: string | null },
): Promise<GaTicketCommentRow | ActionResult> {
  const sql = db();
  const comment = input.comment.trim();
  if (!comment) return { ok: false, error: "comment wajib" };
  const ticket = await sql`SELECT id FROM ga_tickets WHERE id = ${ticketId}`;
  if (!ticket.length) return { ok: false, error: "tiket tidak ditemukan" };
  const rows = await sql`
    INSERT INTO ga_ticket_comments (ticket_id, comment, is_internal, created_by_user_id)
    VALUES (${ticketId}, ${comment}, ${input.is_internal ?? false}, ${input.created_by_user_id ?? null})
    RETURNING id, comment, is_internal, created_at
  `;
  const [u] = input.created_by_user_id ? await sql`SELECT name FROM app_user WHERE id = ${input.created_by_user_id}` : [null];
  return {
    id: String(rows[0].id),
    comment: String(rows[0].comment),
    is_internal: Boolean(rows[0].is_internal),
    created_by_name: u ? String(u.name) : null,
    created_at: toIsoTs(rows[0].created_at),
  };
}

export interface TicketTimelineEntry {
  kind: "status" | "comment";
  at: string;
  actor_name: string | null;
  from_status?: string;
  to_status?: string;
  note?: string | null;
  comment?: string;
  is_internal?: boolean;
}

// Timeline progres (arahan Direktur) — union status_log + comments, urut waktu.
export async function getTicketTimeline(ticketId: string): Promise<TicketTimelineEntry[]> {
  const sql = db();
  const rows = await sql`
    SELECT 'status' AS kind, sl.created_at AS at, u.name AS actor_name,
      sl.from_status, sl.to_status, sl.note, NULL::text AS comment, NULL::boolean AS is_internal
    FROM ga_ticket_status_log sl LEFT JOIN app_user u ON u.id = sl.changed_by_user_id
    WHERE sl.ticket_id = ${ticketId}
    UNION ALL
    SELECT 'comment' AS kind, c.created_at AS at, u.name AS actor_name,
      NULL::text, NULL::text, NULL::text, c.comment, c.is_internal
    FROM ga_ticket_comments c LEFT JOIN app_user u ON u.id = c.created_by_user_id
    WHERE c.ticket_id = ${ticketId}
    ORDER BY at ASC
  `;
  return rows.map((r) => ({
    kind: r.kind as "status" | "comment",
    at: toIsoTs(r.at),
    actor_name: r.actor_name ? String(r.actor_name) : null,
    from_status: r.from_status ? String(r.from_status) : undefined,
    to_status: r.to_status ? String(r.to_status) : undefined,
    note: r.note ? String(r.note) : undefined,
    comment: r.comment ? String(r.comment) : undefined,
    is_internal: r.is_internal == null ? undefined : Boolean(r.is_internal),
  }));
}

// ── Cron: alert overdue -> assignee + fixed Husni (RACI brief: 1 HoD utk seluruh proses). ──
export async function runGaHelpdeskOverdueAlert(): Promise<{ alerts: number }> {
  const sql = db();
  const rows = await sql`
    SELECT t.*, c.nama AS category_nama, c.icon AS category_icon,
      ru.name AS reporter_user_name, au.name AS assignee_user_name
    FROM ga_tickets t
    JOIN ga_ticket_categories c ON c.id = t.category_id
    LEFT JOIN app_user ru ON ru.id = t.reporter_user_id
    LEFT JOIN app_user au ON au.id = t.assignee_user_id
    WHERE t.status NOT IN ('completed','closed','cancelled') AND t.sla_due_at < now() AND t.sla_alert_sent_at IS NULL
  `;
  if (!rows.length) return { alerts: 0 };

  const [husni] = await sql`SELECT wa_number FROM app_user WHERE hod_key = 'husni' AND wa_number IS NOT NULL LIMIT 1`;
  const husniWa = husni?.wa_number ? String(husni.wa_number) : null;

  let alerts = 0;
  for (const r of rows) {
    const t = mapTicketRow(r);
    const assigneeWa = r.assignee_user_id ? await sql`SELECT wa_number FROM app_user WHERE id = ${r.assignee_user_id}` : null;
    const targets = [assigneeWa?.[0]?.wa_number ? String(assigneeWa[0].wa_number) : null, husniWa].filter(
      (x): x is string => !!x,
    );
    if (!targets.length) continue; // anti broadcast tak sengaja tanpa tujuan jelas

    const msg = [
      "🎫 *SLA Tiket Helpdesk Terlewati*",
      `${t.ticket_no} — ${t.title}`,
      `Kategori: ${t.category_nama} (${t.priority})`,
      `Assignee: ${t.assignee_name ?? "-"}`,
      `Batas SLA: ${t.sla_due_at}`,
    ].join("\n");

    let anySent = false;
    for (const target of new Set(targets)) {
      const gw = await sendViaWaGateway(target, msg);
      // gw.sent juga true di mode stub & dry-run — penanda anti-spam HANYA
      // ditulis kalau benar-benar terkirim, pola sama F52/F38.
      if (gw.sent && !gw.stub && !gw.dryRun) anySent = true;
    }
    if (anySent) {
      await sql`UPDATE ga_tickets SET sla_alert_sent_at = now() WHERE id = ${t.id}`;
      alerts += 1;
    }
  }
  return { alerts };
}

// ── BSC feed (pola runGaMaintenanceBscFeed, F137) ──
export async function runGaHelpdeskBscFeed(): Promise<{ upserted: boolean; achievement_pct: number | null }> {
  const sql = db();
  const period = new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 7); // WIB 'YYYY-MM'

  const [kpiRow] = await sql`SELECT id FROM kpi WHERE employee_id = 'dito' AND name = 'SLA compliance % (Helpdesk Tiket)'`;
  if (!kpiRow) return { upserted: false, achievement_pct: null };

  const [stats] = await sql`
    SELECT
      count(*) AS total,
      count(*) FILTER (WHERE status IN ('completed','closed') AND completed_at <= sla_due_at) AS on_time
    FROM ga_tickets
    WHERE created_at >= date_trunc('month', (${period} || '-01')::date)
      AND created_at < date_trunc('month', (${period} || '-01')::date) + interval '1 month'
  `;
  const total = Number(stats.total);
  const onTime = Number(stats.on_time);
  const pct = total === 0 ? 100 : Math.min(120, Math.round((onTime / total) * 100));

  await sql`
    INSERT INTO kpi_measurement (kpi_id, period, achievement_pct)
    VALUES (${kpiRow.id}, ${period}, ${pct})
    ON CONFLICT (kpi_id, period) DO UPDATE SET achievement_pct = EXCLUDED.achievement_pct, updated_at = now()
  `;
  return { upserted: true, achievement_pct: pct };
}
