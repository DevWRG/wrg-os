import { db } from "../db.js";

// F12 — Tracking Pengiriman Digital (SHIPPING). State machine SEDERHANA 3
// langkah: draft → dikirim → bast (TTF sengaja diabaikan, arahan Direktur
// rapat 2026-07-30 — lihat docs/features/F12-tracking-pengiriman-digital.md).
// ETA dihitung dari distance_km (input manual/dianalisa Admin Shipping saat
// create — bukan integrasi Maps real-time, sesuai arahan rapat) via
// computeEta(). Dipicu 2 arah: (1) web — Admin Shipping tandai manual;
// (2) WA hashtag #KIRIM/#BAST dari kurir (lihat repo/inbound.ts, match by
// sj_number, TANPA FK — kurir tak punya roster master data, sama filosofi
// self-contained spt F22 installation_unit).

const DEFAULT_KM_PER_DAY = 250; // asumsi kecepatan tempuh rata2 logistik antar-cabang, lihat docs/features.

export function computeEta(
  distanceKm: number | null | undefined,
  fromDate: Date = new Date(),
): { eta_days: number | null; eta_date: string | null } {
  if (distanceKm == null || !Number.isFinite(distanceKm) || distanceKm <= 0) {
    return { eta_days: null, eta_date: null };
  }
  const kmPerDay = Number(process.env.SHIPPING_ETA_KM_PER_DAY) || DEFAULT_KM_PER_DAY;
  const days = Math.max(1, Math.ceil(distanceKm / kmPerDay));
  const eta = new Date(fromDate);
  eta.setDate(eta.getDate() + days);
  return { eta_days: days, eta_date: eta.toISOString().slice(0, 10) };
}

export interface ShipmentInput {
  sj_number: string;
  customer_name: string;
  cabang?: string | null;
  distance_km?: number | null;
  driver_name?: string | null;
  driver_wa_number?: string | null;
  created_by?: string | null;
}

export interface ShipmentRow {
  id: string;
  sj_number: string;
  customer_name: string;
  cabang: string | null;
  distance_km: number | null;
  eta_days: number | null;
  eta_date: string | null;
  driver_name: string | null;
  driver_wa_number: string | null;
  status: string;
  kirim_at: string | null;
  kirim_photo_path: string | null;
  kirim_by: string | null;
  bast_at: string | null;
  bast_photo_path: string | null;
  bast_by: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

// postgres.js parse kolom date/timestamptz jadi objek Date — String(dateObj)
// hasilnya verbose ("Wed Aug 05 2026 …"), bukan ISO. new Date(x).toISOString()
// aman dipanggil baik x sudah Date maupun masih string dari driver.
const toIsoDate = (x: unknown): string => new Date(x as string | Date).toISOString().slice(0, 10);
const toIsoTs = (x: unknown): string => new Date(x as string | Date).toISOString();

function mapRow(r: Record<string, unknown>): ShipmentRow {
  return {
    id: String(r.id),
    sj_number: String(r.sj_number),
    customer_name: String(r.customer_name),
    cabang: r.cabang ? String(r.cabang) : null,
    distance_km: r.distance_km != null ? Number(r.distance_km) : null,
    eta_days: r.eta_days != null ? Number(r.eta_days) : null,
    eta_date: r.eta_date ? toIsoDate(r.eta_date) : null,
    driver_name: r.driver_name ? String(r.driver_name) : null,
    driver_wa_number: r.driver_wa_number ? String(r.driver_wa_number) : null,
    status: String(r.status),
    kirim_at: r.kirim_at ? toIsoTs(r.kirim_at) : null,
    kirim_photo_path: r.kirim_photo_path ? String(r.kirim_photo_path) : null,
    kirim_by: r.kirim_by ? String(r.kirim_by) : null,
    bast_at: r.bast_at ? toIsoTs(r.bast_at) : null,
    bast_photo_path: r.bast_photo_path ? String(r.bast_photo_path) : null,
    bast_by: r.bast_by ? String(r.bast_by) : null,
    created_by: r.created_by ? String(r.created_by) : null,
    created_at: toIsoTs(r.created_at),
    updated_at: toIsoTs(r.updated_at),
  };
}

export async function createShipment(input: ShipmentInput): Promise<ShipmentRow> {
  const sql = db();
  const { eta_days, eta_date } = computeEta(input.distance_km ?? null);
  const rows = await sql`
    INSERT INTO shipment_tracking
      (sj_number, customer_name, cabang, distance_km, eta_days, eta_date, driver_name, driver_wa_number, created_by)
    VALUES (
      ${input.sj_number}, ${input.customer_name}, ${input.cabang ?? null}, ${input.distance_km ?? null},
      ${eta_days}, ${eta_date}, ${input.driver_name ?? null}, ${input.driver_wa_number ?? null}, ${input.created_by ?? null}
    )
    RETURNING *
  `;
  return mapRow(rows[0]);
}

export async function listShipments(status?: string, search?: string, limit = 500): Promise<ShipmentRow[]> {
  const sql = db();
  const rows = await sql`
    SELECT * FROM shipment_tracking
    WHERE ${status ? sql`status = ${status}` : sql`true`}
      AND ${
        search
          ? sql`(sj_number ILIKE ${`%${search}%`} OR customer_name ILIKE ${`%${search}%`})`
          : sql`true`
      }
    ORDER BY created_at DESC
    LIMIT ${limit}
  `;
  return rows.map(mapRow);
}

export async function getShipmentById(id: string): Promise<ShipmentRow | null> {
  const sql = db();
  const rows = await sql`SELECT * FROM shipment_tracking WHERE id = ${id}`;
  return rows.length ? mapRow(rows[0]) : null;
}

// Match WA hashtag #KIRIM/#BAST [SJ_no] ke record — case-insensitive, terbaru
// menang kalau ada duplikat nomor SJ (harusnya tak terjadi, tapi tak di-UNIQUE-kan
// krn re-kirim/retur bisa pakai SJ sama di masa depan).
export async function findBySjNumber(sjNumber: string): Promise<ShipmentRow | null> {
  const sql = db();
  const rows = await sql`
    SELECT * FROM shipment_tracking WHERE sj_number ILIKE ${sjNumber} ORDER BY created_at DESC LIMIT 1
  `;
  return rows.length ? mapRow(rows[0]) : null;
}

export interface ShipmentActionResult {
  ok: boolean;
  error?: string;
  status?: string;
}

export async function markKirim(
  id: string,
  opts: { photo_path?: string | null; by?: string | null } = {},
): Promise<ShipmentActionResult> {
  const sql = db();
  const rows = await sql`SELECT id, status FROM shipment_tracking WHERE id = ${id}`;
  if (rows.length === 0) return { ok: false, error: "shipment tidak ditemukan" };
  if (rows[0].status !== "draft") return { ok: false, error: "langkah kirim sudah dilakukan / status tidak valid" };
  await sql`
    UPDATE shipment_tracking
    SET status = 'dikirim', kirim_at = now(),
        kirim_photo_path = COALESCE(${opts.photo_path ?? null}, kirim_photo_path),
        kirim_by = COALESCE(${opts.by ?? null}, kirim_by),
        updated_at = now()
    WHERE id = ${id}
  `;
  return { ok: true, status: "dikirim" };
}

export async function markBast(
  id: string,
  opts: { photo_path?: string | null; by?: string | null } = {},
): Promise<ShipmentActionResult> {
  const sql = db();
  const rows = await sql`SELECT id, status FROM shipment_tracking WHERE id = ${id}`;
  if (rows.length === 0) return { ok: false, error: "shipment tidak ditemukan" };
  if (rows[0].status !== "dikirim") return { ok: false, error: "langkah kirim belum selesai — belum bisa BAST" };
  await sql`
    UPDATE shipment_tracking
    SET status = 'bast', bast_at = now(),
        bast_photo_path = COALESCE(${opts.photo_path ?? null}, bast_photo_path),
        bast_by = COALESCE(${opts.by ?? null}, bast_by),
        updated_at = now()
    WHERE id = ${id}
  `;
  return { ok: true, status: "bast" };
}
