import { db } from "../db.js";
import { FULL_SCOPE, scopeSalesPlanClause, type DataScope } from "./access-scope.js";

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

export interface VisitInput {
  am_id: string;
  deal_id?: string;
  customer_name?: string;
  photo_url?: string;
  lat?: number | null;
  lon?: number | null;
  visit_timestamp?: string;
  visit_date?: string;
  note?: string;
}

export async function createVisit(v: VisitInput): Promise<{ id: string; geo_status: GeoStatus }> {
  const sql = db();
  const geo = verifyGeo({
    lat: v.lat,
    lon: v.lon,
    visit_timestamp: v.visit_timestamp,
    visit_date: v.visit_date,
  });
  const rows = await sql`
    INSERT INTO visit
      (deal_id, am_id, customer_name, photo_url, visit_lat, visit_lon, visit_timestamp, visit_date, geo_status, note)
    VALUES
      (${v.deal_id ?? null}, ${v.am_id}, ${v.customer_name ?? null}, ${v.photo_url ?? null},
       ${v.lat ?? null}, ${v.lon ?? null}, ${v.visit_timestamp ?? null}, ${v.visit_date ?? null},
       ${geo}, ${v.note ?? null})
    RETURNING id
  `;
  return { id: rows[0].id as string, geo_status: geo };
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

// Detail 1 visit (sales_plan by id) — VisitRow + note (dari plan goal/tujuan).
export async function getVisit(id: string, scope: DataScope = FULL_SCOPE): Promise<(VisitRow & { note: string | null }) | null> {
  const sql = db();
  const [r] = await sql`
    SELECT sp.id::text AS id, sp.am_id, COALESCE(initcap(mu.panggilan), mu.nama) AS nama,
           sp.customer_name, sp.visit_lat, sp.visit_lon, sp.visit_timestamp::text AS visit_timestamp,
           sp.tanggal::text AS visit_date, sp.visit_date_mismatch,
           COALESCE(al.photo_path, wm.media_path) AS photo_path, sp.created_at::text AS created_at,
           NULLIF(concat_ws(' — ', NULLIF(sp.tujuan,''), NULLIF(sp.goal,'')), '') AS note
    FROM sales_plan sp
    JOIN master_user mu ON mu.am_id = sp.am_id
    LEFT JOIN activity_log al ON al.id = sp.activity_id
    LEFT JOIN wa_message wm ON wm.message_id = al.message_id
    WHERE sp.id::text = ${id} AND sp.visit_lat IS NOT NULL ${scopeSalesPlanClause(sql, scope)}
  `;
  if (!r) return null;
  return { ...rowToVisit(r), note: r.note ? String(r.note) : null };
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
