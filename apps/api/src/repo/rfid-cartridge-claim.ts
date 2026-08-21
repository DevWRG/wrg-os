import { db } from "../db.js";

// F23 — RFID/Cartridge Error Claim Tracker (Aftersales). Flat table, tracking
// internal saja. Lihat infra/postgres/init/116_rfid_cartridge_claim.sql.

export type ClaimStatus = "pending" | "resolved" | "rejected";

export interface RfidCartridgeClaimRow {
  id: string;
  device_name: string;
  cartridge_name: string;
  lot_number: string | null;
  serial_number: string | null;
  customer_name: string;
  error_description: string;
  reported_date: string;
  reported_by: string;
  cabang: string | null;
  status: ClaimStatus;
  resolution_notes: string | null;
  closed_at: string | null;
  notes: string | null;
  has_file: boolean;
  file_name: string | null;
  file_mime: string | null;
  file_size: number | null;
  created_at: string;
}

// Kolom list/detail — SENGAJA tidak bawa file_data (bisa besar, bikin payload
// berat). Isi file diambil terpisah lewat getRfidCartridgeClaimFile().
function listCols(sql: ReturnType<typeof db>) {
  return sql`
    id, device_name, cartridge_name, lot_number, serial_number, customer_name,
    error_description, reported_date::text, reported_by, cabang, status,
    resolution_notes, closed_at::text, notes,
    (file_data IS NOT NULL) AS has_file, file_name, file_mime, file_size,
    created_at::text
  `;
}

function mapRow(r: Record<string, unknown>): RfidCartridgeClaimRow {
  return {
    id: String(r.id),
    device_name: String(r.device_name),
    cartridge_name: String(r.cartridge_name),
    lot_number: r.lot_number ? String(r.lot_number) : null,
    serial_number: r.serial_number ? String(r.serial_number) : null,
    customer_name: String(r.customer_name),
    error_description: String(r.error_description),
    reported_date: String(r.reported_date),
    reported_by: String(r.reported_by),
    cabang: r.cabang ? String(r.cabang) : null,
    status: r.status as ClaimStatus,
    resolution_notes: r.resolution_notes ? String(r.resolution_notes) : null,
    closed_at: r.closed_at ? String(r.closed_at) : null,
    notes: r.notes ? String(r.notes) : null,
    has_file: Boolean(r.has_file),
    file_name: r.file_name ? String(r.file_name) : null,
    file_mime: r.file_mime ? String(r.file_mime) : null,
    file_size: r.file_size === null || r.file_size === undefined ? null : Number(r.file_size),
    created_at: String(r.created_at),
  };
}

export interface CreateRfidCartridgeClaimInput {
  device_name: string;
  cartridge_name: string;
  lot_number?: string;
  serial_number?: string;
  customer_name: string;
  error_description: string;
  reported_date?: string;
  reported_by: string;
  cabang?: string;
  notes?: string;
  file_name?: string;
  file_mime?: string;
  file_size?: number;
  file_data?: Buffer;
}

export async function createRfidCartridgeClaim(input: CreateRfidCartridgeClaimInput): Promise<{ id: string }> {
  const sql = db();
  const rows = await sql`
    INSERT INTO rfid_cartridge_claim (
      device_name, cartridge_name, lot_number, serial_number, customer_name,
      error_description, reported_date, reported_by, cabang, notes,
      file_name, file_mime, file_size, file_data
    ) VALUES (
      ${input.device_name}, ${input.cartridge_name}, ${input.lot_number ?? null},
      ${input.serial_number ?? null}, ${input.customer_name}, ${input.error_description},
      ${input.reported_date ?? sql`CURRENT_DATE`}, ${input.reported_by}, ${input.cabang ?? null},
      ${input.notes ?? null}, ${input.file_name ?? null}, ${input.file_mime ?? null},
      ${input.file_size ?? null}, ${input.file_data ?? null}
    )
    RETURNING id
  `;
  return { id: String(rows[0].id) };
}

export async function listRfidCartridgeClaims(status?: ClaimStatus): Promise<RfidCartridgeClaimRow[]> {
  const sql = db();
  const rows = await sql`
    SELECT ${listCols(sql)}
    FROM rfid_cartridge_claim
    WHERE ${status ? sql`status = ${status}` : sql`true`}
    ORDER BY reported_date DESC, created_at DESC
  `;
  return rows.map(mapRow);
}

export async function getRfidCartridgeClaim(id: string): Promise<RfidCartridgeClaimRow | null> {
  const sql = db();
  const rows = await sql`SELECT ${listCols(sql)} FROM rfid_cartridge_claim WHERE id = ${id}`;
  return rows.length ? mapRow(rows[0]) : null;
}

export async function getRfidCartridgeClaimFile(
  id: string,
): Promise<{ file_name: string; file_mime: string; file_data: Buffer } | null> {
  const sql = db();
  const rows = await sql`
    SELECT file_name, file_mime, file_data FROM rfid_cartridge_claim
    WHERE id = ${id} AND file_data IS NOT NULL
  `;
  if (!rows.length) return null;
  const r = rows[0];
  return { file_name: String(r.file_name), file_mime: String(r.file_mime), file_data: r.file_data as Buffer };
}

export interface UpdateRfidCartridgeClaimInput {
  device_name?: string;
  cartridge_name?: string;
  lot_number?: string | null;
  serial_number?: string | null;
  customer_name?: string;
  error_description?: string;
  reported_date?: string;
  reported_by?: string;
  cabang?: string | null;
  status?: ClaimStatus;
  resolution_notes?: string | null;
  notes?: string | null;
  file_name?: string;
  file_mime?: string;
  file_size?: number;
  file_data?: Buffer;
}

export async function updateRfidCartridgeClaim(
  id: string,
  fields: UpdateRfidCartridgeClaimInput,
): Promise<{ updated: number }> {
  const sql = db();
  // closed_at: distempel saat status masuk resolved/rejected, dibersihkan saat
  // kembali ke pending — dihitung di sini (bukan diterima dari client) supaya
  // konsisten dgn status yg benar-benar disimpan.
  const closedAtExpr =
    fields.status === undefined
      ? sql`closed_at`
      : fields.status === "pending"
        ? sql`NULL`
        : sql`COALESCE(closed_at, now())`;

  const hasFile = fields.file_data !== undefined;

  const rows = await sql`
    UPDATE rfid_cartridge_claim SET
      device_name       = COALESCE(${fields.device_name ?? null}, device_name),
      cartridge_name    = COALESCE(${fields.cartridge_name ?? null}, cartridge_name),
      lot_number        = ${fields.lot_number !== undefined ? fields.lot_number : sql`lot_number`},
      serial_number     = ${fields.serial_number !== undefined ? fields.serial_number : sql`serial_number`},
      customer_name     = COALESCE(${fields.customer_name ?? null}, customer_name),
      error_description = COALESCE(${fields.error_description ?? null}, error_description),
      reported_date     = COALESCE(${fields.reported_date ?? null}, reported_date),
      reported_by       = COALESCE(${fields.reported_by ?? null}, reported_by),
      cabang            = ${fields.cabang !== undefined ? fields.cabang : sql`cabang`},
      status            = COALESCE(${fields.status ?? null}, status),
      resolution_notes  = ${fields.resolution_notes !== undefined ? fields.resolution_notes : sql`resolution_notes`},
      notes             = ${fields.notes !== undefined ? fields.notes : sql`notes`},
      closed_at         = ${closedAtExpr},
      file_name         = ${hasFile ? (fields.file_name ?? null) : sql`file_name`},
      file_mime         = ${hasFile ? (fields.file_mime ?? null) : sql`file_mime`},
      file_size         = ${hasFile ? (fields.file_size ?? null) : sql`file_size`},
      file_data         = ${hasFile ? (fields.file_data ?? null) : sql`file_data`}
    WHERE id = ${id}
    RETURNING id
  `;
  return { updated: rows.length };
}

export async function deleteRfidCartridgeClaim(id: string): Promise<{ deleted: number }> {
  const sql = db();
  const rows = await sql`DELETE FROM rfid_cartridge_claim WHERE id = ${id} RETURNING id`;
  return { deleted: rows.length };
}
