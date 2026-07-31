import { db } from "../db.js";
import { sendViaWaGateway } from "../wasend.js";

// F50 — Kendaraan Operasional Log (OPS). `vehicle` = master kecil (7 mobil,
// diseed manual — lihat 080_vehicle_operational_log.sql, SENGAJA tanpa
// halaman "tambah kendaraan"). `vehicle_log` = entri transaksional
// (km/BBM/service), tiap entri bisa update status vehicle induk.
//
// Alert service-due: KM-BASED (current_km - last_service_km >= interval),
// dikirim SEKALI saat crossing threshold (bukan H-14 spt STNK — km tak bisa
// diprediksi majú berapa hari lagi tanpa telemetry). Alert STNK: H-30
// (ASUMSI ballpark, STNK butuh lead time admin lebih panjang dari PM alat —
// beda dari H-14 F24 — adjustable via env). Reset alert flag saat service
// baru dicatat / stnk_expiry di-update maju.

const DEFAULT_STNK_ALERT_DAYS = 30;

const toIsoDate = (x: unknown): string => new Date(x as string | Date).toISOString().slice(0, 10);
const toIsoTs = (x: unknown): string => new Date(x as string | Date).toISOString();

export interface VehicleRow {
  id: string;
  plate_number: string;
  model: string | null;
  sopir_name: string | null;
  current_km: number | null;
  stnk_expiry: string | null;
  service_interval_km: number;
  last_service_km: number | null;
  last_service_date: string | null;
  active: boolean;
  service_due: boolean;
  stnk_due: boolean;
  stnk_days_left: number | null;
  created_at: string;
  updated_at: string;
}

function mapRow(r: Record<string, unknown>): VehicleRow {
  const currentKm = r.current_km != null ? Number(r.current_km) : null;
  const lastServiceKm = r.last_service_km != null ? Number(r.last_service_km) : null;
  const intervalKm = Number(r.service_interval_km);
  const serviceDue = currentKm != null && currentKm - (lastServiceKm ?? 0) >= intervalKm;

  const stnkExpiry = r.stnk_expiry ? toIsoDate(r.stnk_expiry) : null;
  let stnkDaysLeft: number | null = null;
  let stnkDue = false;
  if (stnkExpiry) {
    const days = Math.ceil((new Date(`${stnkExpiry}T00:00:00Z`).getTime() - Date.now()) / 86_400_000);
    stnkDaysLeft = days;
    stnkDue = days <= DEFAULT_STNK_ALERT_DAYS;
  }

  return {
    id: String(r.id),
    plate_number: String(r.plate_number),
    model: r.model ? String(r.model) : null,
    sopir_name: r.sopir_name ? String(r.sopir_name) : null,
    current_km: currentKm,
    stnk_expiry: stnkExpiry,
    service_interval_km: intervalKm,
    last_service_km: lastServiceKm,
    last_service_date: r.last_service_date ? toIsoDate(r.last_service_date) : null,
    active: Boolean(r.active),
    service_due: serviceDue,
    stnk_due: stnkDue,
    stnk_days_left: stnkDaysLeft,
    created_at: toIsoTs(r.created_at),
    updated_at: toIsoTs(r.updated_at),
  };
}

export async function listVehicles(activeOnly = true): Promise<VehicleRow[]> {
  const sql = db();
  const rows = await sql`
    SELECT * FROM vehicle
    WHERE ${activeOnly ? sql`active = true` : sql`true`}
    ORDER BY plate_number ASC
  `;
  return rows.map(mapRow);
}

export async function getVehicleById(id: string): Promise<VehicleRow | null> {
  const sql = db();
  const rows = await sql`SELECT * FROM vehicle WHERE id = ${id}`;
  return rows.length ? mapRow(rows[0]) : null;
}

export interface VehicleUpdateInput {
  sopir_name?: string | null;
  stnk_expiry?: string | null;
  service_interval_km?: number | null;
  active?: boolean;
}

export interface VehicleActionResult {
  ok: boolean;
  error?: string;
}

// Update field admin (sopir/STNK/interval) — nge-reset stnk_alert_sent_at
// kalau stnk_expiry diisi tanggal baru (renewal), supaya alert siklus lama
// tak nyangkut nge-block alert siklus berikutnya.
export async function updateVehicle(id: string, input: VehicleUpdateInput): Promise<VehicleActionResult> {
  const sql = db();
  const rows = await sql`SELECT id FROM vehicle WHERE id = ${id}`;
  if (rows.length === 0) return { ok: false, error: "kendaraan tidak ditemukan" };
  await sql`
    UPDATE vehicle SET
      sopir_name = COALESCE(${input.sopir_name ?? null}, sopir_name),
      stnk_expiry = COALESCE(${input.stnk_expiry ?? null}, stnk_expiry),
      service_interval_km = COALESCE(${input.service_interval_km ?? null}, service_interval_km),
      active = COALESCE(${input.active ?? null}, active),
      stnk_alert_sent_at = CASE WHEN ${input.stnk_expiry ?? null}::date IS NOT NULL THEN NULL ELSE stnk_alert_sent_at END,
      updated_at = now()
    WHERE id = ${id}
  `;
  return { ok: true };
}

export interface VehicleLogInput {
  log_type: "km" | "bbm" | "service";
  log_date?: string | null;
  km?: number | null;
  bbm_liter?: number | null;
  bbm_cost?: number | null;
  note?: string | null;
  created_by?: string | null;
}

export interface VehicleLogRow {
  id: string;
  vehicle_id: string;
  log_type: string;
  log_date: string;
  km: number | null;
  bbm_liter: number | null;
  bbm_cost: number | null;
  note: string | null;
  created_by: string | null;
  created_at: string;
}

function mapLogRow(r: Record<string, unknown>): VehicleLogRow {
  return {
    id: String(r.id),
    vehicle_id: String(r.vehicle_id),
    log_type: String(r.log_type),
    log_date: toIsoDate(r.log_date),
    km: r.km != null ? Number(r.km) : null,
    bbm_liter: r.bbm_liter != null ? Number(r.bbm_liter) : null,
    bbm_cost: r.bbm_cost != null ? Number(r.bbm_cost) : null,
    note: r.note ? String(r.note) : null,
    created_by: r.created_by ? String(r.created_by) : null,
    created_at: toIsoTs(r.created_at),
  };
}

export async function listVehicleLogs(vehicleId: string, limit = 100): Promise<VehicleLogRow[]> {
  const sql = db();
  const rows = await sql`
    SELECT * FROM vehicle_log WHERE vehicle_id = ${vehicleId}
    ORDER BY log_date DESC, created_at DESC LIMIT ${limit}
  `;
  return rows.map(mapLogRow);
}

// Tambah entri log + update status vehicle induk (current_km selalu maju,
// tak pernah mundur; log_type='service' reset last_service_km/date +
// service_alert_sent_at supaya siklus alert berikutnya bisa kirim lagi).
export async function createVehicleLog(
  vehicleId: string,
  input: VehicleLogInput,
): Promise<VehicleLogRow | VehicleActionResult> {
  const sql = db();
  const veh = await sql`SELECT id, current_km FROM vehicle WHERE id = ${vehicleId}`;
  if (veh.length === 0) return { ok: false, error: "kendaraan tidak ditemukan" };

  const rows = await sql`
    INSERT INTO vehicle_log (vehicle_id, log_type, log_date, km, bbm_liter, bbm_cost, note, created_by)
    VALUES (
      ${vehicleId}, ${input.log_type}, ${input.log_date ?? new Date().toISOString().slice(0, 10)},
      ${input.km ?? null}, ${input.bbm_liter ?? null}, ${input.bbm_cost ?? null},
      ${input.note ?? null}, ${input.created_by ?? null}
    )
    RETURNING *
  `;

  const currentKm = veh[0].current_km != null ? Number(veh[0].current_km) : null;
  if (input.km != null && (currentKm == null || input.km > currentKm)) {
    await sql`UPDATE vehicle SET current_km = ${input.km}, updated_at = now() WHERE id = ${vehicleId}`;
  }
  if (input.log_type === "service") {
    await sql`
      UPDATE vehicle SET
        last_service_km = COALESCE(${input.km ?? null}, last_service_km),
        last_service_date = ${input.log_date ?? new Date().toISOString().slice(0, 10)},
        service_alert_sent_at = NULL,
        updated_at = now()
      WHERE id = ${vehicleId}
    `;
  }

  return mapLogRow(rows[0]);
}

// ── Cron: alert service-due (km-based, sekali per crossing) + STNK H-30. ──
export async function runVehicleAlerts(): Promise<{ service_alerts: number; stnk_alerts: number }> {
  const sql = db();
  const target = process.env.VEHICLE_ALERT_WA_TARGET || "";
  if (!target) return { service_alerts: 0, stnk_alerts: 0 }; // anti broadcast tak sengaja tanpa tujuan jelas

  const vehicles = (
    await sql`SELECT * FROM vehicle WHERE active = true`
  ).map(mapRow);

  let serviceAlerts = 0;
  let stnkAlerts = 0;

  for (const v of vehicles) {
    const raw = await sql`SELECT stnk_alert_sent_at, service_alert_sent_at FROM vehicle WHERE id = ${v.id}`;
    const alreadyServiceAlerted = raw[0].service_alert_sent_at != null;
    const alreadyStnkAlerted = raw[0].stnk_alert_sent_at != null;

    if (v.service_due && !alreadyServiceAlerted) {
      const msg = [
        "🔧 *Service Kendaraan Due*",
        `${v.plate_number}${v.model ? ` (${v.model})` : ""}`,
        `KM sekarang: ${v.current_km ?? "?"} — interval service: ${v.service_interval_km} km`,
        `Sopir: ${v.sopir_name ?? "-"}`,
      ].join("\n");
      const gw = await sendViaWaGateway(target, msg);
      // gw.sent juga true di mode stub & dry-run (lihat wasend.ts) — tanpa gerbang
      // ini penanda anti-spam ter-set walau tak ada WA yang benar-benar terkirim,
      // dan alert-nya mati permanen begitu WA_DRY_RUN (default true) dimatikan.
      if (gw.sent && !gw.stub && !gw.dryRun) {
        await sql`UPDATE vehicle SET service_alert_sent_at = now() WHERE id = ${v.id}`;
        serviceAlerts += 1;
      }
    }

    if (v.stnk_due && !alreadyStnkAlerted) {
      const msg = [
        "📄 *STNK Kendaraan Akan/Sudah Jatuh Tempo*",
        `${v.plate_number}${v.model ? ` (${v.model})` : ""}`,
        `Jatuh tempo: ${v.stnk_expiry} (${v.stnk_days_left} hari lagi)`,
        `Sopir: ${v.sopir_name ?? "-"}`,
      ].join("\n");
      const gw = await sendViaWaGateway(target, msg);
      if (gw.sent && !gw.stub && !gw.dryRun) {
        await sql`UPDATE vehicle SET stnk_alert_sent_at = now() WHERE id = ${v.id}`;
        stnkAlerts += 1;
      }
    }
  }

  return { service_alerts: serviceAlerts, stnk_alerts: stnkAlerts };
}
