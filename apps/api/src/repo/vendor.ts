import { db } from "../db.js";

// F140 Vendor Management + Contract Expiry Alerts (Purchasing/GA, role min HOD).
// Header (vendor_partner) + child (vendor_contract) terpisah — beda dari pola
// flat F39 Supplier ETA — supaya histori renewal kontrak lama tetap tersimpan
// (kontrak baru = baris baru, bukan overwrite). Lihat 078_vendor_management.sql
// utk rasional lengkap (accurate_vendor_id opsional, ON DELETE CASCADE, dst).
//
// Alert kedaluwarsa kontrak = STATUS COMPUTED di query (CASE di contractCols()),
// TIDAK ada cron/WA — dikonfirmasi user (Direktur), pola sama F25. Threshold
// "expiring_soon" 30 hari adalah ASUMSI (belum ada arahan eksplisit board),
// gampang diubah lewat EXPIRING_SOON_THRESHOLD_DAYS.
//
// date/timestamptz eksplisit ::text di SELECT/RETURNING — pola sama semua repo
// lain (postgres.js balikin objek Date tanpa cast eksplisit, ke-serialize salah).

export const EXPIRING_SOON_THRESHOLD_DAYS = 30;

export type VendorContractStatus = "active" | "expiring_soon" | "expired" | "no_end_date" | "terminated";

export interface VendorPartnerRow {
  id: string;
  name: string;
  category: string | null;
  contact_person: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  cabang: string | null;
  accurate_vendor_id: string | null;
  is_active: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
  contract_count: number;
  expiring_count: number;
  expired_count: number;
}

export interface VendorContractRow {
  id: string;
  vendor_id: string;
  contract_number: string | null;
  contract_type: string | null;
  start_date: string;
  end_date: string | null;
  value: number | null;
  terminated_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  status: VendorContractStatus;
}

function vendorCols(sql: ReturnType<typeof db>) {
  return sql`
    v.id, v.name, v.category, v.contact_person, v.phone, v.email, v.address, v.cabang,
    v.accurate_vendor_id, v.is_active, v.notes,
    v.created_at::text, v.updated_at::text,
    (SELECT COUNT(*) FROM vendor_contract c WHERE c.vendor_id = v.id)::int AS contract_count,
    (SELECT COUNT(*) FROM vendor_contract c
       WHERE c.vendor_id = v.id AND c.terminated_at IS NULL AND c.end_date IS NOT NULL
         AND c.end_date >= CURRENT_DATE AND c.end_date <= CURRENT_DATE + ${EXPIRING_SOON_THRESHOLD_DAYS}::int
    )::int AS expiring_count,
    (SELECT COUNT(*) FROM vendor_contract c
       WHERE c.vendor_id = v.id AND c.terminated_at IS NULL AND c.end_date IS NOT NULL
         AND c.end_date < CURRENT_DATE
    )::int AS expired_count
  `;
}

function mapVendor(r: Record<string, unknown>): VendorPartnerRow {
  return {
    id: String(r.id),
    name: String(r.name),
    category: r.category != null ? String(r.category) : null,
    contact_person: r.contact_person != null ? String(r.contact_person) : null,
    phone: r.phone != null ? String(r.phone) : null,
    email: r.email != null ? String(r.email) : null,
    address: r.address != null ? String(r.address) : null,
    cabang: r.cabang != null ? String(r.cabang) : null,
    accurate_vendor_id: r.accurate_vendor_id != null ? String(r.accurate_vendor_id) : null,
    is_active: Boolean(r.is_active),
    notes: r.notes != null ? String(r.notes) : null,
    created_at: String(r.created_at),
    updated_at: String(r.updated_at),
    contract_count: Number(r.contract_count ?? 0),
    expiring_count: Number(r.expiring_count ?? 0),
    expired_count: Number(r.expired_count ?? 0),
  };
}

function contractCols(sql: ReturnType<typeof db>) {
  return sql`
    id, vendor_id, contract_number, contract_type, start_date::text, end_date::text,
    value, terminated_at::text, notes, created_at::text, updated_at::text,
    CASE
      WHEN terminated_at IS NOT NULL THEN 'terminated'
      WHEN end_date IS NULL THEN 'no_end_date'
      WHEN end_date < CURRENT_DATE THEN 'expired'
      WHEN end_date <= CURRENT_DATE + ${EXPIRING_SOON_THRESHOLD_DAYS}::int THEN 'expiring_soon'
      ELSE 'active'
    END AS status
  `;
}

function mapContract(r: Record<string, unknown>): VendorContractRow {
  return {
    id: String(r.id),
    vendor_id: String(r.vendor_id),
    contract_number: r.contract_number != null ? String(r.contract_number) : null,
    contract_type: r.contract_type != null ? String(r.contract_type) : null,
    start_date: String(r.start_date),
    end_date: r.end_date != null ? String(r.end_date) : null,
    value: r.value != null ? Number(r.value) : null,
    terminated_at: r.terminated_at != null ? String(r.terminated_at) : null,
    notes: r.notes != null ? String(r.notes) : null,
    created_at: String(r.created_at),
    updated_at: String(r.updated_at),
    status: r.status as VendorContractStatus,
  };
}

export interface VendorPartnerInput {
  name: string;
  category?: string | null;
  contact_person?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  cabang?: string | null;
  accurate_vendor_id?: string | null;
  is_active?: boolean;
  notes?: string | null;
}

export interface VendorPartnerUpdate {
  name?: string;
  category?: string | null;
  contact_person?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  cabang?: string | null;
  accurate_vendor_id?: string | null;
  is_active?: boolean;
  notes?: string | null;
}

export async function listVendors(): Promise<VendorPartnerRow[]> {
  const sql = db();
  const rows = await sql`
    SELECT ${vendorCols(sql)}
    FROM vendor_partner v
    ORDER BY v.name ASC
  `;
  return rows.map(mapVendor);
}

export async function getVendorRow(id: string): Promise<VendorPartnerRow | null> {
  const sql = db();
  const rows = await sql`SELECT ${vendorCols(sql)} FROM vendor_partner v WHERE v.id = ${id}`;
  return rows.length ? mapVendor(rows[0]) : null;
}

export async function getVendor(id: string): Promise<(VendorPartnerRow & { contracts: VendorContractRow[] }) | null> {
  const vendor = await getVendorRow(id);
  if (!vendor) return null;
  const contracts = await listVendorContracts(id);
  return { ...vendor, contracts };
}

export async function createVendor(t: VendorPartnerInput): Promise<VendorPartnerRow> {
  const sql = db();
  const rows = await sql`
    INSERT INTO vendor_partner (
      name, category, contact_person, phone, email, address, cabang,
      accurate_vendor_id, is_active, notes
    ) VALUES (
      ${t.name}, ${t.category ?? null}, ${t.contact_person ?? null}, ${t.phone ?? null},
      ${t.email ?? null}, ${t.address ?? null}, ${t.cabang ?? null},
      ${t.accurate_vendor_id ?? null}, ${t.is_active ?? true}, ${t.notes ?? null}
    )
    RETURNING id
  `;
  const created = await getVendorRow(String(rows[0].id));
  if (!created) throw new Error("gagal membaca vendor setelah dibuat");
  return created;
}

export async function updateVendor(id: string, f: VendorPartnerUpdate): Promise<VendorPartnerRow | null> {
  const sql = db();
  const rows = await sql`
    UPDATE vendor_partner SET
      name               = COALESCE(${f.name ?? null}, name),
      category           = ${f.category !== undefined ? f.category : sql`category`},
      contact_person     = ${f.contact_person !== undefined ? f.contact_person : sql`contact_person`},
      phone              = ${f.phone !== undefined ? f.phone : sql`phone`},
      email              = ${f.email !== undefined ? f.email : sql`email`},
      address            = ${f.address !== undefined ? f.address : sql`address`},
      cabang             = ${f.cabang !== undefined ? f.cabang : sql`cabang`},
      accurate_vendor_id = ${f.accurate_vendor_id !== undefined ? f.accurate_vendor_id : sql`accurate_vendor_id`},
      is_active          = COALESCE(${f.is_active ?? null}, is_active),
      notes              = ${f.notes !== undefined ? f.notes : sql`notes`},
      updated_at         = now()
    WHERE id = ${id}
    RETURNING id
  `;
  return rows.length ? getVendorRow(id) : null;
}

export async function deleteVendor(id: string): Promise<{ deleted: number }> {
  const sql = db();
  const rows = await sql`DELETE FROM vendor_partner WHERE id = ${id} RETURNING id`;
  return { deleted: rows.length };
}

export interface VendorContractInput {
  contract_number?: string | null;
  contract_type?: string | null;
  start_date?: string;
  end_date?: string | null;
  value?: number | null;
  notes?: string | null;
}

export interface VendorContractUpdate {
  contract_number?: string | null;
  contract_type?: string | null;
  start_date?: string;
  end_date?: string | null;
  value?: number | null;
  terminated_at?: string | null;
  notes?: string | null;
}

export async function listVendorContracts(vendorId: string): Promise<VendorContractRow[]> {
  const sql = db();
  const rows = await sql`
    SELECT ${contractCols(sql)}
    FROM vendor_contract
    WHERE vendor_id = ${vendorId}
    ORDER BY start_date DESC, created_at DESC
  `;
  return rows.map(mapContract);
}

export async function getVendorContract(vendorId: string, id: string): Promise<VendorContractRow | null> {
  const sql = db();
  const rows = await sql`
    SELECT ${contractCols(sql)} FROM vendor_contract WHERE id = ${id} AND vendor_id = ${vendorId}
  `;
  return rows.length ? mapContract(rows[0]) : null;
}

export async function createVendorContract(vendorId: string, t: VendorContractInput): Promise<VendorContractRow> {
  const sql = db();
  const rows = await sql`
    INSERT INTO vendor_contract (
      vendor_id, contract_number, contract_type, start_date, end_date, value, notes
    ) VALUES (
      ${vendorId}, ${t.contract_number ?? null}, ${t.contract_type ?? null},
      ${t.start_date ?? new Date().toISOString().slice(0, 10)}, ${t.end_date ?? null},
      ${t.value ?? null}, ${t.notes ?? null}
    )
    RETURNING id
  `;
  const created = await getVendorContract(vendorId, String(rows[0].id));
  if (!created) throw new Error("gagal membaca kontrak setelah dibuat");
  return created;
}

export async function updateVendorContract(vendorId: string, id: string, f: VendorContractUpdate): Promise<VendorContractRow | null> {
  const sql = db();
  const rows = await sql`
    UPDATE vendor_contract SET
      contract_number = ${f.contract_number !== undefined ? f.contract_number : sql`contract_number`},
      contract_type   = ${f.contract_type !== undefined ? f.contract_type : sql`contract_type`},
      start_date      = COALESCE(${f.start_date ?? null}, start_date),
      end_date        = ${f.end_date !== undefined ? f.end_date : sql`end_date`},
      value           = ${f.value !== undefined ? f.value : sql`value`},
      terminated_at   = ${f.terminated_at !== undefined ? f.terminated_at : sql`terminated_at`},
      notes           = ${f.notes !== undefined ? f.notes : sql`notes`},
      updated_at      = now()
    WHERE id = ${id} AND vendor_id = ${vendorId}
    RETURNING id
  `;
  return rows.length ? getVendorContract(vendorId, id) : null;
}

export async function deleteVendorContract(vendorId: string, id: string): Promise<{ deleted: number }> {
  const sql = db();
  const rows = await sql`DELETE FROM vendor_contract WHERE id = ${id} AND vendor_id = ${vendorId} RETURNING id`;
  return { deleted: rows.length };
}
