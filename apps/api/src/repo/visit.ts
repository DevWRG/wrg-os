import { db } from "../db.js";
import { FULL_SCOPE, scopeOnClause, scopeSalesPlanClause, type DataScope } from "./access-scope.js";

// D1 — visit report AM dengan geotag + foto (port legacy visit_geo +
// report_photo + check_photo_geotag). Foto = URL/metadata (bukan binary; tak
// ada OCR — lat/lon dikirim klien/upstream). Verifikasi: bounds Indonesia +
// date-mismatch (tanggal foto ≠ tanggal kunjungan yang diklaim).
//
// Row-level scope (F122): AM hanya kunjungannya sendiri, HoD hanya cabang
// timnya, admin semua. Ditegakkan di SQL — bukan di UI. Scope dioper dari
// endpoint (resolveScope dari header x-user-id); tanpa scope = FULL (dev/auth off).

// Bounding box Indonesia (sama dgn check_photo_geotag.py).
const ID_LAT_MIN = -11;
const ID_LAT_MAX = 6;
const ID_LON_MIN = 95;
const ID_LON_MAX = 141;

export type GeoStatus = "ok" | "out_of_bounds" | "no_geo" | "date_mismatch";

export function verifyGeo(opts: {
  lat?: number | null;
  lon?: number | null;
  visit_timestamp?: string | null;
  visit_date?: string | null;
}): GeoStatus {
  const { lat, lon } = opts;
  if (lat === null || lat === undefined || lon === null || lon === undefined) return "no_geo";
  if (lat < ID_LAT_MIN || lat > ID_LAT_MAX || lon < ID_LON_MIN || lon > ID_LON_MAX) {
    return "out_of_bounds";
  }
  if (opts.visit_date && opts.visit_timestamp) {
    const tsDate = opts.visit_timestamp.slice(0, 10); // YYYY-MM-DD dari ISO
    if (tsDate && tsDate !== opts.visit_date.slice(0, 10)) return "date_mismatch";
  }
  return "ok";
}

/**
 * Ambang fuzzy pencocokan customer ke plan hari itu. Sama dengan
 * insertAmActivities() di inbound.ts — input manual dan #REPORT WA harus
 * memperlakukan nama faskes yang sama dengan cara yang sama, kalau tidak satu
 * kunjungan bisa dianggap "sesuai plan" lewat WA tapi "di luar plan" lewat form.
 */
const PLAN_MATCH = 0.3;

export interface VisitInput {
  am_id: string;
  deal_id?: string;
  customer_name?: string;
  photo_url?: string;
  /**
   * lat/lon WAJIB — bukan opsional. listVisits()/getVisit() memfilter
   * `visit_lat IS NOT NULL`, jadi kunjungan tanpa koordinat tersimpan tapi
   * tidak akan pernah terlihat di menu Visits. Dulu opsional, dan itu satu-
   * satunya cara menghasilkan baris yang "tersimpan tapi hilang". Tipe ini
   * dibuat ketat supaya pemanggil baru ditolak compiler, bukan baru ketahuan
   * saat datanya sudah tak terlihat di produksi.
   *
   * Di luar bbox Indonesia tetap DITERIMA (geo_status='out_of_bounds') —
   * menu Visits berguna justru untuk memperlihatkan koordinat yang salah.
   */
  lat: number;
  lon: number;
  visit_timestamp?: string;
  visit_date?: string;
  note?: string;
}

/**
 * Simpan visit input manual ke `sales_plan` + `activity_log` — BUKAN ke tabel
 * `visit`.
 *
 * Kenapa: tabel `visit` tidak pernah dibaca siapa pun. listVisits()/getVisit()
 * di bawah membaca `sales_plan` (di-JOIN ke `activity_log`), jadi apa pun yang
 * masuk ke tabel `visit` tidak akan muncul di menu Visits, tidak terhitung di
 * KPI, dan `id` yang dikembalikan POST /visits tak bisa dipakai GET /visits/:id.
 * Tabel itu terisi 628 baris (2–11 Juni 2026) lalu berhenti; isinya sudah
 * tercermin di sales_plan/activity_log lewat jalur legacy, jadi ditinggal
 * sebagai arsip — tidak dihapus, tidak ditulisi lagi.
 *
 * `id` yang dikembalikan sekarang adalah id `sales_plan`, sehingga langsung
 * bisa dipakai GET /visits/:id.
 */
export async function createVisit(v: VisitInput): Promise<{
  id: string;
  geo_status: GeoStatus;
  activity_id: string;
  matched_plan: boolean;
}> {
  const sql = db();
  const geo = verifyGeo({
    lat: v.lat,
    lon: v.lon,
    visit_timestamp: v.visit_timestamp,
    visit_date: v.visit_date,
  });
  // Tanggal kunjungan: eksplisit → dari timestamp foto → hari ini (WIB).
  const tanggal =
    v.visit_date?.slice(0, 10) ??
    v.visit_timestamp?.slice(0, 10) ??
    new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
  const customer = v.customer_name ?? null;
  // photo_geotag disimpan dalam bentuk yang sama dengan jalur OCR WA supaya
  // metrik "foto tanpa geo" membaca kedua jalur dengan aturan yang sama.
  const geotag = {
    ts: v.visit_timestamp ?? null,
    lat: String(v.lat),
    lon: String(v.lon),
    address: null,
  };

  return await sql.begin(async (tx) => {
    // 1. Cari plan hari itu yang cocok. Kalau ada, kunjungan ini MEMENUHI plan
    //    tersebut — jangan buat baris plan kedua untuk faskes yang sama.
    const cocok = customer
      ? await tx`
          SELECT id, similarity(customer_name, ${customer}) AS score
          FROM sales_plan
          WHERE am_id = ${v.am_id} AND tanggal = ${tanggal}
            AND similarity(customer_name, ${customer}) > ${PLAN_MATCH}
          ORDER BY score DESC LIMIT 1`
      : [];
    let planId: number | null = cocok[0] ? Number(cocok[0].id) : null;
    const score = cocok[0] ? Number(cocok[0].score) : null;
    const matched = planId !== null;

    // 2. Tak ada plan yang cocok → kunjungan di luar plan. Tetap dibuat baris
    //    plan-nya, karena listVisits() membaca dari sales_plan; tanpa ini
    //    kunjungannya tak akan pernah terlihat. seq lanjut dari maksimum.
    if (planId === null) {
      const [{ maxseq }] = await tx`
        SELECT COALESCE(max(seq), 0) AS maxseq FROM sales_plan
        WHERE am_id = ${v.am_id} AND tanggal = ${tanggal}`;
      const [baru] = await tx`
        INSERT INTO sales_plan (am_id, tanggal, customer_name, seq, submitted_at)
        VALUES (${v.am_id}, ${tanggal}, ${customer}, ${Number(maxseq) + 1}, now())
        RETURNING id`;
      planId = Number(baru.id);
    }

    const [akt] = await tx`
      INSERT INTO activity_log
        (am_id, plan_id, tanggal, customer_name, hasil, source, is_unmatched, match_score,
         photo_path, photo_geotag, activity_type, opportunity_id)
      VALUES
        (${v.am_id}, ${planId}, ${tanggal}, ${customer}, ${v.note ?? null}, 'manual-visit',
         ${!matched}, ${score}, ${v.photo_url ?? null},
         ${tx.json(geotag)}, 'Fisik', ${v.deal_id ?? null})
      RETURNING id`;

    await tx`
      UPDATE sales_plan SET
        visit_lat = ${v.lat}, visit_lon = ${v.lon},
        visit_timestamp = ${v.visit_timestamp ?? null},
        visit_date_mismatch = ${geo === "date_mismatch"},
        reported = true, reported_at = now(), activity_id = ${Number(akt.id)}
      WHERE id = ${planId}`;

    return {
      id: String(planId),
      geo_status: geo,
      activity_id: String(akt.id),
      matched_plan: matched,
    };
  });
}

export interface VisitRow {
  id: string;
  am_id: string;
  nama: string | null;
  customer_name: string | null;
  photo_url: string | null;
  visit_lat: number | null;
  visit_lon: number | null;
  visit_timestamp: string | null;
  visit_date: string | null;
  geo_status: string;
  tujuan: string | null;
  goal: string | null;
  catatan: string | null;
  activity_type: string | null;
  account_id: number | null;
  opportunity_id: string | null;
  created_at: string;
}

// SUMBER: sales_plan (kunjungan AM ber-geotag dari inbound) — bukan tabel `visit`
// legacy yang sparse. visit_lat/lon dari report inbound; foto dari
// activity_log.photo_path / wa_message.media_path (via activity_id→message_id).
// geo_status dihitung on-the-fly (bbox Indonesia + flag visit_date_mismatch).
function rowToVisit(r: Record<string, unknown>): VisitRow {
  const lat = r.visit_lat === null || r.visit_lat === undefined ? null : Number(r.visit_lat);
  const lon = r.visit_lon === null || r.visit_lon === undefined ? null : Number(r.visit_lon);
  const geo_status = r.visit_date_mismatch
    ? "date_mismatch"
    : verifyGeo({ lat, lon });
  return {
    id: String(r.id),
    am_id: String(r.am_id),
    nama: r.nama ? String(r.nama) : null,
    customer_name: r.customer_name ? String(r.customer_name) : null,
    photo_url: r.photo_path ? String(r.photo_path) : null, // raw media path; web → /api/media?p=
    visit_lat: lat,
    visit_lon: lon,
    visit_timestamp: r.visit_timestamp ? String(r.visit_timestamp) : null,
    visit_date: r.visit_date ? String(r.visit_date) : null,
    geo_status,
    tujuan: r.tujuan ? String(r.tujuan) : null,
    goal: r.goal ? String(r.goal) : null,
    catatan: r.catatan ? String(r.catatan) : null,
    activity_type: r.activity_type ? String(r.activity_type) : null,
    account_id: r.account_id === null || r.account_id === undefined ? null : Number(r.account_id),
    opportunity_id: r.opportunity_id ? String(r.opportunity_id) : null,
    created_at: String(r.created_at),
  };
}

export async function listVisits(status?: string, scope: DataScope = FULL_SCOPE, limit = 1000): Promise<VisitRow[]> {
  const sql = db();
  const rows = await sql`
    SELECT sp.id::text AS id, sp.am_id, COALESCE(initcap(mu.panggilan), mu.nama) AS nama,
           sp.customer_name, sp.visit_lat, sp.visit_lon, sp.visit_timestamp::text AS visit_timestamp,
           sp.tanggal::text AS visit_date, sp.visit_date_mismatch,
           sp.tujuan, sp.goal,
           NULLIF(concat_ws(' — ', NULLIF(al.hasil,''), NULLIF(al.next_action,'')), '') AS catatan,
           al.activity_type, al.account_id, al.opportunity_id::text AS opportunity_id,
           COALESCE(al.photo_path, wm.media_path) AS photo_path, sp.created_at::text AS created_at
    FROM sales_plan sp
    JOIN master_user mu ON mu.am_id = sp.am_id
    LEFT JOIN activity_log al ON al.id = sp.activity_id
    LEFT JOIN wa_message wm ON wm.message_id = al.message_id
    WHERE sp.visit_lat IS NOT NULL ${scopeSalesPlanClause(sql, scope)}
    ORDER BY sp.created_at DESC
    LIMIT ${Number(limit) || 1000}`;
  const all = (rows as unknown as Record<string, unknown>[]).map(rowToVisit);
  return status ? all.filter((v) => v.geo_status === status) : all;
}

// Detail 1 visit (sales_plan by id) — VisitRow + note (dari plan goal/tujuan)
// + hasil/next_action mentah dari activity_log (report AM), dipisah biar UI bisa
// menampilkan "Hasil" dan "Next Action" sendiri-sendiri (di list keduanya
// digabung jadi `catatan`).
export interface VisitDetailRow extends VisitRow {
  note: string | null;
  hasil: string | null;
  next_action: string | null;
}

export async function getVisit(id: string, scope: DataScope = FULL_SCOPE): Promise<VisitDetailRow | null> {
  const sql = db();
  const [r] = await sql`
    SELECT sp.id::text AS id, sp.am_id, COALESCE(initcap(mu.panggilan), mu.nama) AS nama,
           sp.customer_name, sp.visit_lat, sp.visit_lon, sp.visit_timestamp::text AS visit_timestamp,
           sp.tanggal::text AS visit_date, sp.visit_date_mismatch,
           sp.tujuan, sp.goal,
           al.activity_type, al.account_id, al.opportunity_id::text AS opportunity_id,
           NULLIF(al.hasil, '') AS hasil, NULLIF(al.next_action, '') AS next_action,
           COALESCE(al.photo_path, wm.media_path) AS photo_path, sp.created_at::text AS created_at,
           NULLIF(concat_ws(' — ', NULLIF(sp.tujuan,''), NULLIF(sp.goal,'')), '') AS note
    FROM sales_plan sp
    JOIN master_user mu ON mu.am_id = sp.am_id
    LEFT JOIN activity_log al ON al.id = sp.activity_id
    LEFT JOIN wa_message wm ON wm.message_id = al.message_id
    WHERE sp.id::text = ${id} AND sp.visit_lat IS NOT NULL ${scopeSalesPlanClause(sql, scope)}
  `;
  if (!r) return null;
  return {
    ...rowToVisit(r),
    note: r.note ? String(r.note) : null,
    hasil: r.hasil ? String(r.hasil) : null,
    next_action: r.next_action ? String(r.next_action) : null,
  };
}

// Brief kepatuhan geotag (port send_geotag_brief): hitung per-status + flagged.
//
// Dihitung dari daftar yang SAMA dengan listVisits (sales_plan), bukan tabel
// `visit` legacy yang sparse — dulu kartu ringkasan & tabel di /visits bisa
// beda angka karena beda sumber. Bonus: ikut ter-scope otomatis dan status
// dihitung oleh verifyGeo() yang sama (tak ada duplikasi bbox di SQL).
const SUMMARY_LIMIT = 10000;

export async function visitSummary(scope: DataScope = FULL_SCOPE): Promise<{
  total: number;
  by_status: Record<string, number>;
  flagged: number;
}> {
  const visits = await listVisits(undefined, scope, SUMMARY_LIMIT);
  const by: Record<string, number> = {};
  for (const v of visits) by[v.geo_status] = (by[v.geo_status] ?? 0) + 1;
  const total = visits.length;
  return { total, by_status: by, flagged: total - (by.ok ?? 0) };
}

// ── F16 CRM Fase 1: KPI timeliness + target kunjungan mingguan ──
//
// Dua KPI yang diminta PRD F3+F16 dan dipakai hulu-hilir:
//   • Timeliness  — % aktivitas yang di-input ≤48 jam dari tanggal aktivitas
//                   (target ≥80%). Feed NPK aspek CRM/Presales (F66).
//   • Target visit— 20 kunjungan/minggu per AM, 6 di antaranya prospek baru.
//                   Feed Effort_Factor insentif (F67).
//
// Timeliness dihitung dari activity_log (bukan sales_plan): yang diukur adalah
// kedisiplinan MELAPOR, dan `created_at` di activity_log adalah stempel saat
// laporan masuk. sales_plan.created_at ikut berubah saat plan di-resubmit,
// jadi tak bisa dipakai sebagai patokan.

export const TIMELINESS_TARGET_PCT = 80;
const TIMELINESS_WINDOW_DAYS = 30;
const TIMELINESS_LIMIT_HOURS = 48;
// Prospek dianggap "baru" bila AM ybs tak mengunjunginya dalam N hari terakhir.
const NEW_PROSPECT_LOOKBACK_DAYS = 90;

export interface TimelinessKpi {
  window_days: number;
  total: number;
  on_time: number;
  pct: number | null; // null bila belum ada aktivitas di window
  target_pct: number;
}

export interface AmVisitProgress {
  am_id: string;
  nama: string | null;
  cabang: string | null;
  visits: number;
  new_prospects: number;
  target: number;
  new_target: number;
  pct: number;
}

export interface VisitTargetKpi {
  iso_year: number;
  iso_week: number;
  week_start: string;
  target_default: number;
  new_target_default: number;
  per_am: AmVisitProgress[];
  on_track: number; // jumlah AM yang sudah ≥ target
}

// Batas 48 jam diukur dari AKHIR hari aktivitas (WIB), bukan tengah malam awal:
// laporan yang masuk malam hari di tanggal yang sama jelas tak boleh dihitung
// telat, dan AM masih punya sisa hari berikutnya untuk menyusul.
export async function visitTimeliness(scope: DataScope = FULL_SCOPE): Promise<TimelinessKpi> {
  const sql = db();
  const [r] = await sql`
    SELECT count(*)::int AS total,
           count(*) FILTER (
             WHERE al.created_at <=
               ((al.tanggal + 1)::timestamp AT TIME ZONE 'Asia/Jakarta') + make_interval(hours => ${TIMELINESS_LIMIT_HOURS})
           )::int AS on_time
    FROM activity_log al
    JOIN master_user mu ON mu.am_id = al.am_id
    WHERE al.tanggal >= (CURRENT_DATE - make_interval(days => ${TIMELINESS_WINDOW_DAYS}))
      ${scopeOnClause(sql, scope, sql`al.am_id`, sql`NULLIF(mu.cabang,'')`)}
  `;
  const total = Number(r?.total ?? 0);
  const onTime = Number(r?.on_time ?? 0);
  return {
    window_days: TIMELINESS_WINDOW_DAYS,
    total,
    on_time: onTime,
    pct: total > 0 ? Math.round((onTime / total) * 1000) / 10 : null,
    target_pct: TIMELINESS_TARGET_PCT,
  };
}

// Capaian kunjungan minggu ISO berjalan (atau minggu yang diminta) per AM.
// `weekOffset` 0 = minggu ini, -1 = minggu lalu (dipakai rekap Senin).
export async function visitTargets(scope: DataScope = FULL_SCOPE, weekOffset = 0): Promise<VisitTargetKpi> {
  const sql = db();
  const rows = await sql`
    WITH wk AS (
      SELECT date_trunc('week', CURRENT_DATE)::date + make_interval(weeks => ${weekOffset}) AS start
    ),
    span AS (SELECT start::date AS d0, (start + interval '6 days')::date AS d1 FROM wk),
    -- Default global: agregat supaya baris '*' yang hilang tetap menghasilkan
    -- satu baris (COALESCE ke angka PRD) — tanpa ini seluruh CTE jadi kosong
    -- dan tabel progress ikut kosong tanpa pesan error.
    def AS (
      SELECT COALESCE(max(per_week), 20) AS per_week, COALESCE(max(new_per_week), 6) AS new_per_week
      FROM visit_target WHERE am_id = '*'
    ),
    tgt AS (
      SELECT mu.am_id,
             COALESCE(t.per_week, def.per_week) AS per_week,
             COALESCE(t.new_per_week, def.new_per_week) AS new_per_week
      FROM master_user mu
      CROSS JOIN def
      LEFT JOIN visit_target t ON t.am_id = mu.am_id
      WHERE mu.aktif AND upper(COALESCE(mu.role,'')) = 'AM'
    ),
    vis AS (
      SELECT sp.am_id, sp.customer_name, sp.tanggal
      FROM sales_plan sp, span
      WHERE sp.visit_lat IS NOT NULL AND sp.tanggal BETWEEN span.d0 AND span.d1
    )
    SELECT mu.am_id,
           COALESCE(initcap(mu.panggilan), mu.nama) AS nama,
           NULLIF(mu.cabang,'') AS cabang,
           tgt.per_week::int  AS target,
           tgt.new_per_week::int AS new_target,
           (SELECT count(*)::int FROM vis WHERE vis.am_id = mu.am_id) AS visits,
           (SELECT count(DISTINCT v.customer_name)::int
              FROM vis v, span
             WHERE v.am_id = mu.am_id AND v.customer_name IS NOT NULL
               AND NOT EXISTS (
                 SELECT 1 FROM sales_plan p
                  WHERE p.am_id = mu.am_id
                    AND p.customer_name = v.customer_name
                    AND p.tanggal < span.d0
                    AND p.tanggal >= span.d0 - make_interval(days => ${NEW_PROSPECT_LOOKBACK_DAYS})
               )) AS new_prospects
    FROM master_user mu
    JOIN tgt ON tgt.am_id = mu.am_id
    WHERE mu.aktif AND upper(COALESCE(mu.role,'')) = 'AM'
      ${scopeOnClause(sql, scope, sql`mu.am_id`, sql`NULLIF(mu.cabang,'')`)}
    ORDER BY visits DESC, nama
  `;
  const [meta] = await sql`
    SELECT (date_trunc('week', CURRENT_DATE)::date + make_interval(weeks => ${weekOffset}))::date::text AS week_start,
           extract(isoyear FROM (date_trunc('week', CURRENT_DATE)::date + make_interval(weeks => ${weekOffset})))::int AS iso_year,
           extract(week    FROM (date_trunc('week', CURRENT_DATE)::date + make_interval(weeks => ${weekOffset})))::int AS iso_week
  `;
  const [def] = await sql`SELECT per_week, new_per_week FROM visit_target WHERE am_id = '*'`;

  const perAm: AmVisitProgress[] = (rows as unknown as Record<string, unknown>[]).map((r) => {
    const visits = Number(r.visits ?? 0);
    const target = Number(r.target ?? 0);
    return {
      am_id: String(r.am_id),
      nama: r.nama ? String(r.nama) : null,
      cabang: r.cabang ? String(r.cabang) : null,
      visits,
      new_prospects: Number(r.new_prospects ?? 0),
      target,
      new_target: Number(r.new_target ?? 0),
      pct: target > 0 ? Math.round((visits / target) * 100) : 0,
    };
  });
  return {
    iso_year: Number(meta?.iso_year ?? 0),
    iso_week: Number(meta?.iso_week ?? 0),
    week_start: String(meta?.week_start ?? ""),
    target_default: Number(def?.per_week ?? 20),
    new_target_default: Number(def?.new_per_week ?? 6),
    per_am: perAm,
    on_track: perAm.filter((a) => a.target > 0 && a.visits >= a.target).length,
  };
}

// Bundel KPI untuk halaman /visits (satu round-trip).
export async function visitKpi(scope: DataScope = FULL_SCOPE, weekOffset = 0) {
  const [timeliness, targets] = await Promise.all([visitTimeliness(scope), visitTargets(scope, weekOffset)]);
  return { timeliness, targets };
}
