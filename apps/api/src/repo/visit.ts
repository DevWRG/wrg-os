import { db } from "../db.js";

// D1 — visit report AM dengan geotag + foto (port legacy visit_geo +
// report_photo + check_photo_geotag). Foto = URL/metadata (bukan binary; tak
// ada OCR — lat/lon dikirim klien/upstream). Verifikasi: bounds Indonesia +
// date-mismatch (tanggal foto ≠ tanggal kunjungan yang diklaim).

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
  created_at: string;
}

export async function listVisits(status?: string, limit = 1000): Promise<VisitRow[]> {
  const sql = db();
  const rows = await sql`
    SELECT v.id, v.am_id, COALESCE(initcap(mu.panggilan), mu.nama) AS nama,
           v.customer_name, v.photo_url, v.visit_lat, v.visit_lon,
           v.visit_timestamp::text, v.visit_date::text, v.geo_status, v.created_at::text
    FROM visit v
    LEFT JOIN master_user mu ON mu.am_id = v.am_id
    WHERE ${status ? sql`v.geo_status = ${status}` : sql`true`}
    ORDER BY v.created_at DESC
    LIMIT ${limit}
  `;
  return rows.map((r) => ({
    id: String(r.id),
    am_id: String(r.am_id),
    nama: r.nama ? String(r.nama) : null,
    customer_name: r.customer_name ? String(r.customer_name) : null,
    photo_url: r.photo_url ? String(r.photo_url) : null,
    visit_lat: r.visit_lat === null ? null : Number(r.visit_lat),
    visit_lon: r.visit_lon === null ? null : Number(r.visit_lon),
    visit_timestamp: r.visit_timestamp ? String(r.visit_timestamp) : null,
    visit_date: r.visit_date ? String(r.visit_date) : null,
    geo_status: String(r.geo_status),
    created_at: String(r.created_at),
  }));
}

// Brief kepatuhan geotag (port send_geotag_brief): hitung per-status + flagged.
export async function visitSummary(): Promise<{
  total: number;
  by_status: Record<string, number>;
  flagged: number;
}> {
  const sql = db();
  const rows = await sql`SELECT geo_status, count(*)::int AS n FROM visit GROUP BY geo_status`;
  const by: Record<string, number> = {};
  let total = 0;
  for (const r of rows) {
    by[String(r.geo_status)] = Number(r.n);
    total += Number(r.n);
  }
  const flagged = total - (by.ok ?? 0);
  return { total, by_status: by, flagged };
}
