import { db } from "../db.js";

// Replikasi metrik dashboard Plan & Report WRG-CRM (port wrg_queries.py).
// Sumber: sales_plan (AM), sales_todo (+report_data, non-AM), activity_log,
// master_user, master_territory, master_holiday. KPI yang ditampilkan adalah
// gabungan komponen plan (AM) + todo (non-AM); pemecahan komponen dipertahankan
// supaya per-orang bisa branch sesuai role (AM pakai plan, non-AM pakai todo).

// Rentang default = Senin minggu berjalan → min(Minggu, hari ini).
export function defaultRange(): { from: string; to: string; today: string } {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const dow = now.getUTCDay(); // 0=Min..6=Sab
  const monOffset = dow === 0 ? -6 : 1 - dow;
  const mon = new Date(now);
  mon.setUTCDate(now.getUTCDate() + monOffset);
  const sun = new Date(mon);
  sun.setUTCDate(mon.getUTCDate() + 6);
  const from = mon.toISOString().slice(0, 10);
  const to = (sun < now ? sun : now).toISOString().slice(0, 10);
  return { from, to, today };
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
export function parseRange(from?: string, to?: string): { from: string; to: string } {
  const d = defaultRange();
  let f = from && ISO.test(from) ? from : d.from;
  let t = to && ISO.test(to) ? to : d.to;
  if (f > t) [f, t] = [t, f];
  return { from: f, to: t };
}

// ── Summary: 7 KPI (raw components + gabungan) ──
export async function reportSummary(from: string, to: string) {
  const sql = db();
  const [r] = await sql`
    WITH wd AS (
      SELECT count(*)::int AS working_days
      FROM generate_series(${from}::date, ${to}::date, '1 day') g(d)
      WHERE EXTRACT(DOW FROM g.d) NOT IN (0,6)
        AND NOT EXISTS (SELECT 1 FROM master_holiday h WHERE h.tanggal = g.d::date)
    ),
    uc AS (
      SELECT count(*) FILTER (WHERE aktif)::int AS users_aktif,
             count(*) FILTER (WHERE aktif AND wajib_plan_report)::int AS users_wajib
      FROM master_user
    ),
    pl AS (
      SELECT count(*)::int AS total_plan_visits,
             count(*) FILTER (WHERE reported)::int AS plan_reported,
             count(*) FILTER (WHERE is_late_plan)::int AS plan_late
      FROM sales_plan WHERE tanggal BETWEEN ${from} AND ${to}
    ),
    td AS (
      SELECT COALESCE(sum(total_items),0)::int AS total_todo_items,
             count(*) FILTER (WHERE is_late_plan)::int AS todo_late,
             COALESCE(sum((SELECT count(*) FROM jsonb_array_elements(CASE WHEN jsonb_typeof(report_data)='array' THEN report_data ELSE '[]'::jsonb END) e WHERE e->>'status'='matched')),0)::int AS todo_matched,
             COALESCE(sum((SELECT count(*) FROM jsonb_array_elements(CASE WHEN jsonb_typeof(report_data)='array' THEN report_data ELSE '[]'::jsonb END) e WHERE e->>'status' IN ('ambiguous','unmatched'))),0)::int AS todo_unmatched
      FROM sales_todo WHERE tanggal BETWEEN ${from} AND ${to}
    ),
    ac AS (
      SELECT count(*)::int AS total_activity,
             count(*) FILTER (WHERE is_unmatched)::int AS unmatched_activity
      FROM activity_log WHERE tanggal BETWEEN ${from} AND ${to}
    )
    SELECT * FROM wd, uc, pl, td, ac
  `;
  const c = {
    working_days: Number(r.working_days),
    users_aktif: Number(r.users_aktif),
    users_wajib: Number(r.users_wajib),
    total_plan_visits: Number(r.total_plan_visits),
    plan_reported: Number(r.plan_reported),
    plan_late: Number(r.plan_late),
    total_todo_items: Number(r.total_todo_items),
    todo_late: Number(r.todo_late),
    todo_matched: Number(r.todo_matched),
    todo_unmatched: Number(r.todo_unmatched),
    total_activity: Number(r.total_activity),
    unmatched_activity: Number(r.unmatched_activity),
  };
  const total_plan = c.total_plan_visits + c.total_todo_items;
  const reported = c.plan_reported + c.todo_matched;
  const late = c.plan_late + c.todo_late;
  const aktivitas = c.total_activity + c.todo_matched + c.todo_unmatched;
  const unmatched = c.unmatched_activity + c.todo_unmatched;
  return {
    from,
    to,
    kpi: {
      working_days: c.working_days,
      users_wajib: c.users_wajib,
      users_aktif: c.users_aktif,
      total_plan,
      total_plan_visits: c.total_plan_visits,
      total_todo_items: c.total_todo_items,
      reported,
      completion: total_plan > 0 ? Math.round((reported / total_plan) * 100) : 0,
      late,
      aktivitas,
      unmatched,
    },
    components: c,
  };
}

export interface OrangRow {
  am_id: string;
  panggilan: string | null;
  nama: string;
  role: string;
  cabang: string | null;
  active_days: number;
  plan_count: number;
  report_count: number;
  late: number;
  unmatched: number;
  completion: number | null;
  is_am: boolean;
}

// Komponen per-user (plan & todo & activity & active_days), lalu di-branch role.
export async function reportPerOrang(from: string, to: string): Promise<OrangRow[]> {
  const sql = db();
  const rows = await sql`
    SELECT mu.am_id, mu.panggilan, mu.nama, mu.role, mu.cabang,
      COALESCE(sp.plan_visits,0)::int   AS plan_visits,
      COALESCE(sp.plan_reported,0)::int AS plan_reported,
      COALESCE(sp.plan_late,0)::int     AS plan_late,
      COALESCE(st.todo_items,0)::int    AS todo_items,
      COALESCE(st.todo_matched,0)::int  AS todo_matched,
      COALESCE(st.todo_unmatched,0)::int AS todo_unmatched,
      COALESCE(st.todo_late,0)::int     AS todo_late,
      COALESCE(act.unmatched_activity,0)::int AS unmatched_activity,
      COALESCE(d.active_days,0)::int    AS active_days
    FROM master_user mu
    LEFT JOIN LATERAL (
      SELECT count(*) AS plan_visits,
             count(*) FILTER (WHERE reported) AS plan_reported,
             count(*) FILTER (WHERE is_late_plan) AS plan_late
      FROM sales_plan WHERE am_id = mu.am_id AND tanggal BETWEEN ${from} AND ${to}
    ) sp ON true
    LEFT JOIN LATERAL (
      SELECT COALESCE(sum(total_items),0) AS todo_items,
             count(*) FILTER (WHERE is_late_plan) AS todo_late,
             COALESCE(sum((SELECT count(*) FROM jsonb_array_elements(CASE WHEN jsonb_typeof(report_data)='array' THEN report_data ELSE '[]'::jsonb END) e WHERE e->>'status'='matched')),0) AS todo_matched,
             COALESCE(sum((SELECT count(*) FROM jsonb_array_elements(CASE WHEN jsonb_typeof(report_data)='array' THEN report_data ELSE '[]'::jsonb END) e WHERE e->>'status' IN ('ambiguous','unmatched'))),0) AS todo_unmatched
      FROM sales_todo WHERE am_id = mu.am_id AND tanggal BETWEEN ${from} AND ${to}
    ) st ON true
    LEFT JOIN LATERAL (
      SELECT count(*) FILTER (WHERE is_unmatched) AS unmatched_activity
      FROM activity_log WHERE am_id = mu.am_id AND tanggal BETWEEN ${from} AND ${to}
    ) act ON true
    LEFT JOIN LATERAL (
      SELECT count(DISTINCT t) AS active_days FROM (
        SELECT tanggal t FROM sales_plan  WHERE am_id = mu.am_id AND tanggal BETWEEN ${from} AND ${to}
        UNION SELECT tanggal FROM sales_todo  WHERE am_id = mu.am_id AND tanggal BETWEEN ${from} AND ${to}
        UNION SELECT tanggal FROM activity_log WHERE am_id = mu.am_id AND tanggal BETWEEN ${from} AND ${to}
      ) u
    ) d ON true
    WHERE mu.aktif AND mu.wajib_plan_report
    ORDER BY mu.cabang NULLS LAST, mu.nama
  `;
  return rows.map((r) => {
    const isAm = String(r.role) === "AM";
    const plan_count = isAm ? Number(r.plan_visits) : Number(r.todo_items);
    const report_count = isAm ? Number(r.plan_reported) : Number(r.todo_matched);
    const late = Number(r.plan_late) + Number(r.todo_late);
    const unmatched = isAm ? Number(r.unmatched_activity) : Number(r.todo_unmatched);
    return {
      am_id: String(r.am_id),
      panggilan: r.panggilan ? String(r.panggilan) : null,
      nama: String(r.nama),
      role: String(r.role),
      cabang: r.cabang ? String(r.cabang) : null,
      active_days: Number(r.active_days),
      plan_count,
      report_count,
      late,
      unmatched,
      completion: plan_count > 0 ? Math.round((report_count / plan_count) * 100) : null,
      is_am: isAm,
    };
  });
}

interface GroupRow {
  key: string;
  count: number;
  plan_count: number;
  report_count: number;
  late: number;
  unmatched: number;
  completion: number | null;
}
function groupBy(rows: OrangRow[], keyFn: (r: OrangRow) => string): GroupRow[] {
  const map = new Map<string, GroupRow>();
  for (const r of rows) {
    const key = keyFn(r) || "—";
    const g = map.get(key) ?? { key, count: 0, plan_count: 0, report_count: 0, late: 0, unmatched: 0, completion: null };
    g.count += 1;
    g.plan_count += r.plan_count;
    g.report_count += r.report_count;
    g.late += r.late;
    g.unmatched += r.unmatched;
    map.set(key, g);
  }
  const out = [...map.values()];
  for (const g of out) g.completion = g.plan_count > 0 ? Math.round((g.report_count / g.plan_count) * 100) : null;
  return out.sort((a, b) => a.key.localeCompare(b.key));
}

export async function reportPerDivisi(from: string, to: string) {
  return groupBy(await reportPerOrang(from, to), (r) => r.role);
}
export async function reportPerCabang(from: string, to: string) {
  return groupBy(await reportPerOrang(from, to), (r) => r.cabang ?? "—");
}

// Per-HOD: hanya AM, dikelompokkan via master_territory.am_panggilan→hod_panggilan.
export async function reportPerHod(from: string, to: string) {
  const sql = db();
  const rows = await sql`
    WITH am AS (
      SELECT mu.am_id, UPPER(mu.panggilan) AS panggilan_uc
      FROM master_user mu WHERE mu.role='AM' AND mu.aktif AND mu.wajib_plan_report
    ),
    am_hod AS (
      SELECT am.am_id, COALESCE(MAX(t.hod_panggilan), '— (tanpa territory)') AS hod
      FROM am LEFT JOIN master_territory t ON UPPER(t.am_panggilan) = am.panggilan_uc
      GROUP BY am.am_id
    ),
    stats AS (
      SELECT ah.hod,
        count(DISTINCT ah.am_id)::int AS jumlah_am,
        count(DISTINCT ah.am_id) FILTER (WHERE sp.plan_visits > 0)::int AS am_submit,
        COALESCE(sum(sp.plan_visits),0)::int AS plan_count,
        COALESCE(sum(sp.plan_reported),0)::int AS report_count,
        COALESCE(sum(sp.plan_late),0)::int AS late,
        COALESCE(sum(ac.unmatched_activity),0)::int AS unmatched
      FROM am_hod ah
      LEFT JOIN LATERAL (
        SELECT count(*) AS plan_visits, count(*) FILTER (WHERE reported) AS plan_reported,
               count(*) FILTER (WHERE is_late_plan) AS plan_late
        FROM sales_plan WHERE am_id = ah.am_id AND tanggal BETWEEN ${from} AND ${to}
      ) sp ON true
      LEFT JOIN LATERAL (
        SELECT count(*) FILTER (WHERE is_unmatched) AS unmatched_activity
        FROM activity_log WHERE am_id = ah.am_id AND tanggal BETWEEN ${from} AND ${to}
      ) ac ON true
      GROUP BY ah.hod
    )
    SELECT s.*, hu.nama AS hod_nama
    FROM stats s
    LEFT JOIN master_user hu ON hu.role='HOD' AND UPPER(hu.panggilan)=s.hod
    ORDER BY s.hod
  `;
  return rows.map((r) => ({
    hod: String(r.hod),
    hod_nama: r.hod_nama ? String(r.hod_nama) : null,
    jumlah_am: Number(r.jumlah_am),
    am_submit: Number(r.am_submit),
    plan_count: Number(r.plan_count),
    report_count: Number(r.report_count),
    late: Number(r.late),
    unmatched: Number(r.unmatched),
    completion: Number(r.plan_count) > 0 ? Math.round((Number(r.report_count) / Number(r.plan_count)) * 100) : null,
  }));
}

// Tren harian: plan / report / late per hari (+ working/holiday).
export async function reportDailyTrend(from: string, to: string) {
  const sql = db();
  const rows = await sql`
    SELECT g.d::date::text AS tanggal,
      EXTRACT(DOW FROM g.d) NOT IN (0,6)
        AND NOT EXISTS (SELECT 1 FROM master_holiday h WHERE h.tanggal=g.d::date) AS is_working,
      (SELECT keterangan FROM master_holiday h WHERE h.tanggal=g.d::date) AS holiday,
      COALESCE((SELECT count(*) FROM sales_plan WHERE tanggal=g.d::date),0)::int AS plan_visits,
      COALESCE((SELECT count(*) FROM sales_plan WHERE tanggal=g.d::date AND is_late_plan),0)::int AS plan_late,
      COALESCE((SELECT sum(total_items) FROM sales_todo WHERE tanggal=g.d::date),0)::int AS todo_items,
      COALESCE((SELECT count(*) FROM sales_todo WHERE tanggal=g.d::date AND is_late_plan),0)::int AS todo_late,
      COALESCE((SELECT count(*) FROM sales_todo WHERE tanggal=g.d::date AND reported),0)::int AS todo_reported,
      COALESCE((SELECT count(*) FROM activity_log WHERE tanggal=g.d::date),0)::int AS total_activity
    FROM generate_series(${from}::date, ${to}::date, '1 day') g(d)
    ORDER BY g.d
  `;
  return rows.map((r) => ({
    tanggal: String(r.tanggal),
    is_working: Boolean(r.is_working),
    holiday: r.holiday ? String(r.holiday) : null,
    plan: Number(r.plan_visits) + Number(r.todo_items),
    report: Number(r.total_activity) + Number(r.todo_reported),
    late: Number(r.plan_late) + Number(r.todo_late),
  }));
}

// Drilldown 1 AM: identitas + plan rows + todo rows + unmatched activity.
export async function reportDrilldown(amId: string, from: string, to: string) {
  const sql = db();
  const [user] = await sql`SELECT am_id, nama, panggilan, role, posisi, cabang, wa_number FROM master_user WHERE am_id=${amId}`;
  const plan = await sql`
    SELECT sp.tanggal::text, sp.customer_name, sp.tujuan, sp.goal, sp.reported, sp.is_late_plan,
           sp.submitted_at::text, sp.visit_lat, sp.visit_lon, sp.visit_timestamp::text, sp.visit_date_mismatch,
           al.hasil, al.next_action, al.match_score
    FROM sales_plan sp LEFT JOIN activity_log al ON al.id = sp.activity_id
    WHERE sp.am_id=${amId} AND sp.tanggal BETWEEN ${from} AND ${to}
    ORDER BY sp.tanggal DESC, sp.seq
  `;
  const todo = await sql`
    SELECT tanggal::text, items, total_items, reported, reported_at::text, is_late_plan, report_data
    FROM sales_todo WHERE am_id=${amId} AND tanggal BETWEEN ${from} AND ${to}
    ORDER BY tanggal DESC
  `;
  const unmatched = await sql`
    SELECT tanggal::text, customer_name, hasil, next_action, match_score, created_at::text
    FROM activity_log WHERE am_id=${amId} AND plan_id IS NULL AND tanggal BETWEEN ${from} AND ${to}
    ORDER BY tanggal DESC
  `;
  return {
    user: user
      ? {
          am_id: String(user.am_id),
          nama: String(user.nama),
          panggilan: user.panggilan ? String(user.panggilan) : null,
          role: String(user.role),
          posisi: user.posisi ? String(user.posisi) : null,
          cabang: user.cabang ? String(user.cabang) : null,
          wa_number: user.wa_number ? String(user.wa_number) : null,
        }
      : null,
    plan: plan.map((r) => ({
      tanggal: String(r.tanggal),
      customer_name: r.customer_name ? String(r.customer_name) : null,
      tujuan: r.tujuan ? String(r.tujuan) : null,
      goal: r.goal ? String(r.goal) : null,
      reported: Boolean(r.reported),
      is_late_plan: Boolean(r.is_late_plan),
      visit_lat: r.visit_lat === null ? null : Number(r.visit_lat),
      visit_lon: r.visit_lon === null ? null : Number(r.visit_lon),
      visit_timestamp: r.visit_timestamp ? String(r.visit_timestamp) : null,
      visit_date_mismatch: Boolean(r.visit_date_mismatch),
      hasil: r.hasil ? String(r.hasil) : null,
      next_action: r.next_action ? String(r.next_action) : null,
    })),
    todo: todo.map((r) => ({
      tanggal: String(r.tanggal),
      items: Array.isArray(r.items) ? (r.items as string[]) : [],
      total_items: Number(r.total_items),
      reported: Boolean(r.reported),
      is_late_plan: Boolean(r.is_late_plan),
      report_data: r.report_data ?? null,
    })),
    unmatched: unmatched.map((r) => ({
      tanggal: String(r.tanggal),
      customer_name: r.customer_name ? String(r.customer_name) : null,
      hasil: r.hasil ? String(r.hasil) : null,
      next_action: r.next_action ? String(r.next_action) : null,
    })),
  };
}

// Sales Calendar: agregat plan/report per (tanggal, AM) untuk rentang grid +
// libur nasional + katalog AM (untuk filter). Satu query agregat (efisien),
// pengganti N-fetch per-AM ala legacy.
export async function reportCalendar(from: string, to: string, amId?: string, cabang?: string) {
  const sql = db();
  const holidays = await sql`
    SELECT tanggal::text, keterangan FROM master_holiday
    WHERE tanggal BETWEEN ${from} AND ${to} ORDER BY tanggal
  `;
  const ams = await sql`
    SELECT am_id::text AS am_id, COALESCE(panggilan, nama) AS name, cabang
    FROM master_user WHERE role='AM' AND aktif ORDER BY cabang, name
  `;
  const rows = await sql`
    SELECT sp.tanggal::text AS d, sp.am_id::text AS am_id,
           COALESCE(mu.panggilan, mu.nama) AS name, mu.cabang,
           count(*)::int AS total,
           count(*) FILTER (WHERE sp.reported)::int AS reported,
           count(*) FILTER (WHERE sp.visit_lat IS NOT NULL)::int AS geo,
           bool_or(sp.is_late_plan) AS late
    FROM sales_plan sp JOIN master_user mu ON mu.am_id = sp.am_id
    WHERE sp.tanggal BETWEEN ${from} AND ${to} AND mu.role='AM' AND mu.aktif
      ${amId ? sql`AND sp.am_id = ${amId}` : sql``}
      ${cabang ? sql`AND mu.cabang = ${cabang}` : sql``}
    GROUP BY sp.tanggal, sp.am_id, name, mu.cabang
    ORDER BY sp.tanggal, name
  `;
  return {
    from,
    to,
    holidays: holidays.map((h) => ({ tanggal: String(h.tanggal), keterangan: String(h.keterangan) })),
    ams: ams.map((a) => ({ am_id: String(a.am_id), name: a.name ? String(a.name) : "—", cabang: a.cabang ? String(a.cabang) : null })),
    rows: rows.map((r) => ({
      d: String(r.d),
      am_id: String(r.am_id),
      name: r.name ? String(r.name) : "—",
      cabang: r.cabang ? String(r.cabang) : null,
      total: Number(r.total),
      reported: Number(r.reported),
      geo: Number(r.geo),
      late: Boolean(r.late),
    })),
  };
}

// Reminder 3-tier (selalu "hari ini"): AM belum visit-report, todo belum report, zero-submission.
export async function reportRemindersPending(date: string) {
  const sql = db();
  const [am] = await sql`
    WITH am_plan AS (
      SELECT sp.am_id, bool_or(al.id IS NOT NULL) AS has_report
      FROM sales_plan sp LEFT JOIN activity_log al ON al.plan_id = sp.id
      WHERE sp.tanggal = ${date} GROUP BY sp.am_id, sp.id
    )
    SELECT count(DISTINCT mu.am_id) FILTER (WHERE NOT COALESCE(ap.has_report,false))::int AS pending,
           count(DISTINCT mu.am_id)::int AS total
    FROM master_user mu
    LEFT JOIN am_plan ap ON ap.am_id = mu.am_id
    WHERE mu.role='AM' AND mu.aktif AND mu.wajib_plan_report AND ap.am_id IS NOT NULL
  `;
  const [todo] = await sql`
    SELECT COALESCE(sum(st.total_items),0)::int AS pending, count(*)::int AS total
    FROM sales_todo st JOIN master_user mu ON mu.am_id=st.am_id
    WHERE st.tanggal=${date} AND NOT st.reported AND mu.aktif AND mu.wajib_plan_report
  `;
  const [zero] = await sql`
    SELECT count(*)::int AS pending FROM master_user mu
    WHERE mu.aktif AND mu.wajib_plan_report
      AND NOT EXISTS (SELECT 1 FROM sales_plan WHERE am_id=mu.am_id AND tanggal=${date})
      AND NOT EXISTS (SELECT 1 FROM sales_todo WHERE am_id=mu.am_id AND tanggal=${date})
  `;
  return {
    date,
    am_pending: { pending: Number(am?.pending ?? 0), total: Number(am?.total ?? 0) },
    todo_pending: { pending: Number(todo?.pending ?? 0), total: Number(todo?.total ?? 0) },
    zero_submission: { pending: Number(zero?.pending ?? 0) },
  };
}
