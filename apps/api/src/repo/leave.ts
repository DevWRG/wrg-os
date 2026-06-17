import { db } from "../db.js";

// D1 — leave/cuti + holiday (port legacy user_leave + master_holiday +
// detect_leave). isOnLeave(am, date) = ada cuti yang mencakup tanggal ATAU
// tanggal libur nasional → dipakai mengecualikan AM dari reminder plan/report.

type Jenis = "sakit" | "cuti" | "ijin";

export async function upsertHoliday(tanggal: string, keterangan: string): Promise<{ id: string }> {
  const sql = db();
  const rows = await sql`
    INSERT INTO master_holiday (tanggal, keterangan) VALUES (${tanggal}, ${keterangan})
    ON CONFLICT (tanggal) DO UPDATE SET keterangan = EXCLUDED.keterangan
    RETURNING id
  `;
  return { id: String(rows[0].id) };
}

export async function listHolidays(): Promise<{ id: string; tanggal: string; keterangan: string }[]> {
  const sql = db();
  const rows = await sql`SELECT id, tanggal::text, keterangan FROM master_holiday ORDER BY tanggal`;
  return rows.map((r) => ({ id: String(r.id), tanggal: String(r.tanggal), keterangan: String(r.keterangan) }));
}

export async function deleteHoliday(id: string): Promise<{ deleted: number }> {
  const sql = db();
  const rows = await sql`DELETE FROM master_holiday WHERE id = ${id} RETURNING id`;
  return { deleted: rows.length };
}

export async function deleteLeave(id: string): Promise<{ deleted: number }> {
  const sql = db();
  const rows = await sql`DELETE FROM user_leave WHERE id = ${id} RETURNING id`;
  return { deleted: rows.length };
}

export async function updateLeave(
  id: string,
  fields: { start_date?: string; end_date?: string; jenis?: Jenis; keterangan?: string },
): Promise<{ updated: number }> {
  const sql = db();
  const rows = await sql`
    UPDATE user_leave SET
      start_date = COALESCE(${fields.start_date ?? null}, start_date),
      end_date   = COALESCE(${fields.end_date ?? null}, end_date),
      jenis      = COALESCE(${fields.jenis ?? null}, jenis),
      keterangan = ${fields.keterangan ?? null}
    WHERE id = ${id}
    RETURNING id
  `;
  return { updated: rows.length };
}

export async function createLeave(opts: {
  am_id: string;
  start_date: string;
  end_date: string;
  jenis: Jenis;
  keterangan?: string;
  source?: string;
}): Promise<{ id: string }> {
  const sql = db();
  const rows = await sql`
    INSERT INTO user_leave (am_id, start_date, end_date, jenis, keterangan, source)
    VALUES (${opts.am_id}, ${opts.start_date}, ${opts.end_date}, ${opts.jenis},
            ${opts.keterangan ?? null}, ${opts.source ?? "manual"})
    RETURNING id
  `;
  return { id: String(rows[0].id) };
}

export async function listLeave(amId?: string, limit = 100) {
  const sql = db();
  const rows = await sql`
    SELECT id, am_id, start_date::text, end_date::text, jenis, keterangan, source, created_at::text
    FROM user_leave
    WHERE ${amId ? sql`am_id = ${amId}` : sql`true`}
    ORDER BY start_date DESC
    LIMIT ${limit}
  `;
  return rows.map((r) => ({
    id: String(r.id),
    am_id: String(r.am_id),
    start_date: String(r.start_date),
    end_date: String(r.end_date),
    jenis: String(r.jenis),
    keterangan: r.keterangan ? String(r.keterangan) : null,
    source: String(r.source),
  }));
}

// Pending leave hasil detect-leave (HRD group) yg belum diputus — buat dikelola
// dari dashboard (selain via balasan WA approver).
export async function listPendingLeave() {
  const sql = db();
  const rows = await sql`
    SELECT id, am_id, nama, jenis, start_date::text AS start_date, end_date::text AS end_date,
           source_message_id, status, created_at::text AS created_at
    FROM leave_pending WHERE status = 'pending' ORDER BY created_at DESC
  `;
  return rows.map((r) => ({
    id: Number(r.id),
    am_id: String(r.am_id),
    nama: String(r.nama),
    jenis: String(r.jenis),
    start_date: String(r.start_date),
    end_date: String(r.end_date),
    source_message_id: r.source_message_id ? String(r.source_message_id) : null,
    status: String(r.status),
    created_at: String(r.created_at),
  }));
}

// Approve/reject pending dari dashboard. Approve → insert user_leave (idempoten,
// anti-overlap) + tandai approved. Selaras handleApproval (jalur WA approver).
export async function decidePendingLeave(
  id: number,
  approve: boolean,
  decidedBy = "dashboard",
): Promise<{ ok: boolean; status?: string; nama?: string; error?: string }> {
  const sql = db();
  const [p] = await sql`SELECT * FROM leave_pending WHERE id = ${id} AND status = 'pending'`;
  if (!p) return { ok: false, error: "not-found-or-decided" };
  if (approve) {
    await sql`
      INSERT INTO user_leave (am_id, start_date, end_date, jenis, keterangan, source)
      SELECT ${p.am_id}, ${p.start_date}, ${p.end_date}, ${p.jenis}, 'Approved via dashboard', 'detect_leave'
      WHERE NOT EXISTS (
        SELECT 1 FROM user_leave WHERE am_id = ${p.am_id}
          AND daterange(start_date, end_date, '[]') && daterange(${p.start_date}, ${p.end_date}, '[]')
      )
    `;
    await sql`UPDATE leave_pending SET status='approved', decided_at=now(), decided_by=${decidedBy} WHERE id=${id}`;
    return { ok: true, status: "approved", nama: String(p.nama) };
  }
  await sql`UPDATE leave_pending SET status='rejected', decided_at=now(), decided_by=${decidedBy} WHERE id=${id}`;
  return { ok: true, status: "rejected", nama: String(p.nama) };
}

export async function isOnLeave(
  amId: string,
  date: string,
): Promise<{ on_leave: boolean; reason: string | null }> {
  const sql = db();
  const [lv] = await sql`
    SELECT jenis, keterangan FROM user_leave
    WHERE am_id = ${amId} AND ${date} BETWEEN start_date AND end_date
    LIMIT 1
  `;
  if (lv) return { on_leave: true, reason: `${lv.jenis}${lv.keterangan ? `: ${lv.keterangan}` : ""}` };
  const [h] = await sql`SELECT keterangan FROM master_holiday WHERE tanggal = ${date}`;
  if (h) return { on_leave: true, reason: `libur: ${h.keterangan}` };
  return { on_leave: false, reason: null };
}

// Deteksi cuti dari teks bebas (port detect_leave keyword). Cocokkan jenis +
// tanggal (ISO atau dd/mm[/yyyy], rentang dipisah "-"/"sd"/"s/d"); kalau tak
// ada tanggal → default refDate (hari ini). Buat leave source='auto'.
const JENIS_KW: { re: RegExp; jenis: Jenis }[] = [
  { re: /\bsakit\b/i, jenis: "sakit" },
  { re: /\b(izin|ijin)\b/i, jenis: "ijin" },
  { re: /\bcuti\b/i, jenis: "cuti" },
];

function toIso(d: string, year: number): string | null {
  const iso = d.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dm = d.match(/^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?$/);
  if (dm) {
    const dd = dm[1].padStart(2, "0");
    const mm = dm[2].padStart(2, "0");
    const yy = dm[3] ? (dm[3].length === 2 ? `20${dm[3]}` : dm[3]) : String(year);
    return `${yy}-${mm}-${dd}`;
  }
  return null;
}

export async function detectLeave(
  amId: string,
  text: string,
  refDate?: string,
): Promise<{ detected: boolean; id?: string; jenis?: Jenis; start_date?: string; end_date?: string }> {
  const matched = JENIS_KW.find((k) => k.re.test(text));
  if (!matched) return { detected: false };
  const ref = refDate ?? new Date().toISOString().slice(0, 10);
  const year = Number(ref.slice(0, 4));
  const dates = (text.match(/\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b/g) ?? [])
    .map((d) => toIso(d, year))
    .filter((d): d is string => !!d)
    .sort();
  const start_date = dates[0] ?? ref;
  const end_date = dates[dates.length - 1] ?? start_date;
  const { id } = await createLeave({
    am_id: amId,
    start_date,
    end_date,
    jenis: matched.jenis,
    keterangan: text.slice(0, 200),
    source: "auto",
  });
  return { detected: true, id, jenis: matched.jenis, start_date, end_date };
}
