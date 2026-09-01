import { db } from "../db.js";

// F12+F42 — Tracking Pengiriman (SHIPPING). State machine: draft → dikirim →
// terima → bast (TTF sengaja diabaikan utk F12 MAUPUN F42, arahan Direktur
// rapat 2026-07-30 — lihat docs/features/F12-*.md & F42-*.md). "terima"
// (F42, extend F12) ditandai MANUAL via web — board F42 cuma sebut hashtag
// #SJ #BAST #TTF, tak ada utk "terima" (default engineer, belum eksplisit
// dikonfirmasi Direktur).
//
// REVISI 2026-07-30 (arahan Direktur, jawab pertanyaan koordinat titik A/B):
// distance_km TIDAK LAGI diinput manual di awal. #KIRIM + foto ber-geotag
// capture titik AWAL (kirim_lat/lon); #BAST + foto ber-geotag capture titik
// CUSTOMER (bast_lat/lon). Begitu KEDUANYA ada, distance_km (haversine) +
// eta_days (durasi AKTUAL kirim_at→bast_at) dihitung OTOMATIS di markBast() —
// dipakai analitik "kesesuaian" jarak vs waktu tempuh, BUKAN estimasi
// customer sebelum kirim (beda dari desain awal). Ini juga menjawab "titik A
// cabang dari mana" — TAK PERLU tabel referensi statis, dinamis dari foto
// #KIRIM tiap shipment.
//
// Dipicu 2 arah: (1) web — Admin Shipping/Kirim-Tagih tandai manual (tanpa
// geo, dipakai kalau WA gagal); (2) WA hashtag #KIRIM/#BAST dari kurir
// (lihat repo/inbound.ts, match by sj_number + geo dari row.geo_lat/geo_lon
// kalau foto ber-geotag, TANPA FK — kurir tak punya roster master data,
// sama filosofi self-contained spt F22 installation_unit).

// Haversine — jarak great-circle (km) antar 2 titik lat/lon. Approksimasi
// cukup utk analitik "kesesuaian" (bukan jarak jalan sungguhan/routing).
function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export interface ShipmentInput {
  sj_number: string;
  customer_name: string;
  cabang?: string | null; // label informasional, TAK dipakai hitung jarak lagi
  driver_name?: string | null;
  driver_wa_number?: string | null;
  created_by?: string | null;
}

export interface ShipmentRow {
  id: string;
  sj_number: string;
  customer_name: string;
  cabang: string | null;
  distance_km: number | null; // dihitung otomatis setelah BAST (haversine kirim→bast)
  eta_days: number | null; // durasi AKTUAL kirim_at→bast_at (hari), bukan estimasi lagi
  kirim_lat: number | null;
  kirim_lon: number | null;
  bast_lat: number | null;
  bast_lon: number | null;
  driver_name: string | null;
  driver_wa_number: string | null;
  status: string;
  kirim_at: string | null;
  kirim_photo_path: string | null;
  kirim_by: string | null;
  terima_at: string | null;
  terima_by: string | null;
  bast_at: string | null;
  bast_photo_path: string | null;
  bast_by: string | null;
  bukti_photo_path: string | null;
  signature_photo_path: string | null;
  bukti_at: string | null;
  bukti_by: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

// postgres.js parse kolom timestamptz jadi objek Date — String(dateObj)
// hasilnya verbose ("Wed Aug 05 2026 …"), bukan ISO. new Date(x).toISOString()
// aman dipanggil baik x sudah Date maupun masih string dari driver.
const toIsoTs = (x: unknown): string => new Date(x as string | Date).toISOString();

function mapRow(r: Record<string, unknown>): ShipmentRow {
  return {
    id: String(r.id),
    sj_number: String(r.sj_number),
    customer_name: String(r.customer_name),
    cabang: r.cabang ? String(r.cabang) : null,
    distance_km: r.distance_km != null ? Number(r.distance_km) : null,
    eta_days: r.eta_days != null ? Number(r.eta_days) : null,
    kirim_lat: r.kirim_lat != null ? Number(r.kirim_lat) : null,
    kirim_lon: r.kirim_lon != null ? Number(r.kirim_lon) : null,
    bast_lat: r.bast_lat != null ? Number(r.bast_lat) : null,
    bast_lon: r.bast_lon != null ? Number(r.bast_lon) : null,
    driver_name: r.driver_name ? String(r.driver_name) : null,
    driver_wa_number: r.driver_wa_number ? String(r.driver_wa_number) : null,
    status: String(r.status),
    kirim_at: r.kirim_at ? toIsoTs(r.kirim_at) : null,
    kirim_photo_path: r.kirim_photo_path ? String(r.kirim_photo_path) : null,
    kirim_by: r.kirim_by ? String(r.kirim_by) : null,
    terima_at: r.terima_at ? toIsoTs(r.terima_at) : null,
    terima_by: r.terima_by ? String(r.terima_by) : null,
    bast_at: r.bast_at ? toIsoTs(r.bast_at) : null,
    bast_photo_path: r.bast_photo_path ? String(r.bast_photo_path) : null,
    bast_by: r.bast_by ? String(r.bast_by) : null,
    bukti_photo_path: r.bukti_photo_path ? String(r.bukti_photo_path) : null,
    signature_photo_path: r.signature_photo_path ? String(r.signature_photo_path) : null,
    bukti_at: r.bukti_at ? toIsoTs(r.bukti_at) : null,
    bukti_by: r.bukti_by ? String(r.bukti_by) : null,
    created_by: r.created_by ? String(r.created_by) : null,
    created_at: toIsoTs(r.created_at),
    updated_at: toIsoTs(r.updated_at),
  };
}

export async function createShipment(input: ShipmentInput): Promise<ShipmentRow> {
  const sql = db();
  const rows = await sql`
    INSERT INTO shipment_tracking
      (sj_number, customer_name, cabang, driver_name, driver_wa_number, created_by)
    VALUES (
      ${input.sj_number}, ${input.customer_name}, ${input.cabang ?? null},
      ${input.driver_name ?? null}, ${input.driver_wa_number ?? null}, ${input.created_by ?? null}
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
  opts: { photo_path?: string | null; by?: string | null; lat?: number | null; lon?: number | null } = {},
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
        kirim_lat = COALESCE(${opts.lat ?? null}, kirim_lat),
        kirim_lon = COALESCE(${opts.lon ?? null}, kirim_lon),
        updated_at = now()
    WHERE id = ${id}
  `;
  return { ok: true, status: "dikirim" };
}

// F42 — barang diterima customer, SEBELUM BAST resmi ditandatangani.
// Manual via web (Admin Shipping/Kirim-Tagih), bukan WA hashtag.
export async function markTerima(
  id: string,
  opts: { by?: string | null } = {},
): Promise<ShipmentActionResult> {
  const sql = db();
  const rows = await sql`SELECT id, status FROM shipment_tracking WHERE id = ${id}`;
  if (rows.length === 0) return { ok: false, error: "shipment tidak ditemukan" };
  if (rows[0].status !== "dikirim") return { ok: false, error: "langkah kirim belum selesai — belum bisa tandai terima" };
  await sql`
    UPDATE shipment_tracking
    SET status = 'terima', terima_at = now(),
        terima_by = COALESCE(${opts.by ?? null}, terima_by),
        updated_at = now()
    WHERE id = ${id}
  `;
  return { ok: true, status: "terima" };
}

export async function markBast(
  id: string,
  opts: { photo_path?: string | null; by?: string | null; lat?: number | null; lon?: number | null } = {},
): Promise<ShipmentActionResult> {
  const sql = db();
  const rows = await sql`SELECT id, status, kirim_at, kirim_lat, kirim_lon FROM shipment_tracking WHERE id = ${id}`;
  if (rows.length === 0) return { ok: false, error: "shipment tidak ditemukan" };
  if (rows[0].status === "bast") return { ok: false, error: "langkah bast sudah dilakukan" };
  if (rows[0].status !== "terima") return { ok: false, error: "langkah terima belum ditandai — belum bisa BAST" };

  const kirimLat = rows[0].kirim_lat != null ? Number(rows[0].kirim_lat) : null;
  const kirimLon = rows[0].kirim_lon != null ? Number(rows[0].kirim_lon) : null;
  const bastLat = opts.lat ?? null;
  const bastLon = opts.lon ?? null;

  // Begitu titik AWAL (#KIRIM) & CUSTOMER (#BAST) sama-sama ada → hitung
  // jarak (haversine) + durasi aktual (hari) utk analitik "kesesuaian".
  let distanceKm: number | null = null;
  let etaDays: number | null = null;
  if (kirimLat != null && kirimLon != null && bastLat != null && bastLon != null) {
    distanceKm = Math.round(haversineKm(kirimLat, kirimLon, bastLat, bastLon) * 10) / 10;
    const kirimAt = new Date(rows[0].kirim_at as string | Date);
    etaDays = Math.max(0, Math.round((Date.now() - kirimAt.getTime()) / 86_400_000));
  }

  await sql`
    UPDATE shipment_tracking
    SET status = 'bast', bast_at = now(),
        bast_photo_path = COALESCE(${opts.photo_path ?? null}, bast_photo_path),
        bast_by = COALESCE(${opts.by ?? null}, bast_by),
        bast_lat = COALESCE(${bastLat}, bast_lat),
        bast_lon = COALESCE(${bastLon}, bast_lon),
        distance_km = COALESCE(${distanceKm}, distance_km),
        eta_days = COALESCE(${etaDays}, eta_days),
        updated_at = now()
    WHERE id = ${id}
  `;
  return { ok: true, status: "bast" };
}

// F93 — foto bukti terima + scan tanda tangan customer, SETELAH BAST
// (audit trail tambahan, TIDAK mengubah status). Slot pertama yg masih
// kosong yang keisi (foto → bukti_photo_path, foto ke-2 → signature_photo_path)
// — kurir kirim 1 foto gabungan pun tetap valid (signature slot boleh kosong).
export async function markBukti(
  id: string,
  opts: { photo_path?: string | null; by?: string | null } = {},
): Promise<ShipmentActionResult> {
  const sql = db();
  const rows = await sql`
    SELECT id, status, bukti_photo_path, signature_photo_path FROM shipment_tracking WHERE id = ${id}
  `;
  if (rows.length === 0) return { ok: false, error: "shipment tidak ditemukan" };
  if (rows[0].status !== "bast") return { ok: false, error: "BAST belum selesai — belum bisa upload bukti" };

  const photoPath = opts.photo_path ?? null;
  // Tanpa foto (pesan teks tanpa lampiran, atau media_path gagal terisi krn
  // download/OCR gagal di bridge) → tolak eksplisit. Tanpa gerbang ini,
  // slot kosong TIDAK PERNAH terisi tapi bukti_at/bukti_by tetap ke-stamp —
  // shipment kelihatan "sudah ada bukti" padahal kedua slot foto tetap kosong.
  if (!photoPath) return { ok: false, error: "belum ada foto — kirim foto bukti/tanda tangan dulu" };
  const slot = !rows[0].bukti_photo_path ? "bukti_photo_path" : !rows[0].signature_photo_path ? "signature_photo_path" : null;
  if (!slot) return { ok: false, error: "slot bukti & signature sudah terisi keduanya" };

  await sql`
    UPDATE shipment_tracking
    SET bukti_photo_path = CASE WHEN ${slot} = 'bukti_photo_path' THEN ${photoPath} ELSE bukti_photo_path END,
        signature_photo_path = CASE WHEN ${slot} = 'signature_photo_path' THEN ${photoPath} ELSE signature_photo_path END,
        bukti_at = now(),
        bukti_by = COALESCE(${opts.by ?? null}, bukti_by),
        updated_at = now()
    WHERE id = ${id}
  `;
  return { ok: true, status: "bast" };
}
