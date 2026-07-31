import { db } from "../db.js";

// F134 ATK Master (General Affairs) — 3 tabel master data standalone:
// kategori, pemasok, katalog barang ATK (lihat 068_atk_master.sql). Prasyarat
// F49 (ATK Stock In/Out Digital Register). date/timestamptz eksplisit ::text
// di SELECT/RETURNING — pola sama dgn supplier-eta.ts/dana-ops.ts (postgres.js
// balikin objek Date tanpa cast).
//
// atk_item.transaction_category ('barang'|'materai', 071_atk_transaction_category.sql)
// — F49/F54 merge: Materai (F54) bukan modul terpisah, cuma kategori transaksi
// tingkat-atas di atas katalog item yang sama. Lihat 071 utk alasan taruh di
// item, bukan di atk_category.

export interface AtkCategoryRow {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

function mapCategory(r: Record<string, unknown>): AtkCategoryRow {
  return {
    id: String(r.id),
    name: String(r.name),
    description: r.description != null ? String(r.description) : null,
    is_active: Boolean(r.is_active),
    created_at: String(r.created_at),
    updated_at: String(r.updated_at),
  };
}

function categoryCols(sql: ReturnType<typeof db>) {
  return sql`id, name, description, is_active, created_at::text, updated_at::text`;
}

export interface AtkCategoryInput {
  name: string;
  description?: string | null;
}

export async function listAtkCategories(): Promise<AtkCategoryRow[]> {
  const sql = db();
  const rows = await sql`
    SELECT ${categoryCols(sql)} FROM atk_category ORDER BY name
  `;
  return rows.map(mapCategory);
}

export async function createAtkCategory(t: AtkCategoryInput): Promise<AtkCategoryRow> {
  const sql = db();
  const rows = await sql`
    INSERT INTO atk_category (name, description)
    VALUES (${t.name}, ${t.description ?? null})
    RETURNING ${categoryCols(sql)}
  `;
  return mapCategory(rows[0]);
}

export interface AtkCategoryUpdate {
  name?: string;
  description?: string | null;
  is_active?: boolean;
}

export async function updateAtkCategory(id: string, f: AtkCategoryUpdate): Promise<AtkCategoryRow | null> {
  const sql = db();
  const rows = await sql`
    UPDATE atk_category SET
      name        = COALESCE(${f.name ?? null}, name),
      description = ${f.description !== undefined ? f.description : sql`description`},
      is_active   = COALESCE(${f.is_active ?? null}, is_active),
      updated_at  = now()
    WHERE id = ${id}
    RETURNING ${categoryCols(sql)}
  `;
  return rows.length ? mapCategory(rows[0]) : null;
}

export async function deleteAtkCategory(id: string): Promise<{ deleted: number }> {
  const sql = db();
  const rows = await sql`DELETE FROM atk_category WHERE id = ${id} RETURNING id`;
  return { deleted: rows.length };
}

export interface AtkSupplierRow {
  id: string;
  name: string;
  contact_person: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

function mapSupplier(r: Record<string, unknown>): AtkSupplierRow {
  return {
    id: String(r.id),
    name: String(r.name),
    contact_person: r.contact_person != null ? String(r.contact_person) : null,
    phone: r.phone != null ? String(r.phone) : null,
    email: r.email != null ? String(r.email) : null,
    address: r.address != null ? String(r.address) : null,
    notes: r.notes != null ? String(r.notes) : null,
    is_active: Boolean(r.is_active),
    created_at: String(r.created_at),
    updated_at: String(r.updated_at),
  };
}

function supplierCols(sql: ReturnType<typeof db>) {
  return sql`id, name, contact_person, phone, email, address, notes, is_active, created_at::text, updated_at::text`;
}

export interface AtkSupplierInput {
  name: string;
  contact_person?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  notes?: string | null;
}

export async function listAtkSuppliers(): Promise<AtkSupplierRow[]> {
  const sql = db();
  const rows = await sql`
    SELECT ${supplierCols(sql)} FROM atk_supplier ORDER BY name
  `;
  return rows.map(mapSupplier);
}

export async function createAtkSupplier(t: AtkSupplierInput): Promise<AtkSupplierRow> {
  const sql = db();
  const rows = await sql`
    INSERT INTO atk_supplier (name, contact_person, phone, email, address, notes)
    VALUES (${t.name}, ${t.contact_person ?? null}, ${t.phone ?? null}, ${t.email ?? null},
            ${t.address ?? null}, ${t.notes ?? null})
    RETURNING ${supplierCols(sql)}
  `;
  return mapSupplier(rows[0]);
}

export interface AtkSupplierUpdate {
  name?: string;
  contact_person?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  notes?: string | null;
  is_active?: boolean;
}

export async function updateAtkSupplier(id: string, f: AtkSupplierUpdate): Promise<AtkSupplierRow | null> {
  const sql = db();
  const rows = await sql`
    UPDATE atk_supplier SET
      name           = COALESCE(${f.name ?? null}, name),
      contact_person = ${f.contact_person !== undefined ? f.contact_person : sql`contact_person`},
      phone          = ${f.phone !== undefined ? f.phone : sql`phone`},
      email          = ${f.email !== undefined ? f.email : sql`email`},
      address        = ${f.address !== undefined ? f.address : sql`address`},
      notes          = ${f.notes !== undefined ? f.notes : sql`notes`},
      is_active      = COALESCE(${f.is_active ?? null}, is_active),
      updated_at     = now()
    WHERE id = ${id}
    RETURNING ${supplierCols(sql)}
  `;
  return rows.length ? mapSupplier(rows[0]) : null;
}

export async function deleteAtkSupplier(id: string): Promise<{ deleted: number }> {
  const sql = db();
  const rows = await sql`DELETE FROM atk_supplier WHERE id = ${id} RETURNING id`;
  return { deleted: rows.length };
}

export type AtkTransactionCategory = "barang" | "materai";

export interface AtkItemRow {
  id: string;
  name: string;
  unit: string;
  category_id: string | null;
  category_name: string | null;
  default_supplier_id: string | null;
  default_supplier_name: string | null;
  min_stock: number | null;
  notes: string | null;
  is_active: boolean;
  transaction_category: AtkTransactionCategory;
  created_at: string;
  updated_at: string;
}

function mapItem(r: Record<string, unknown>): AtkItemRow {
  return {
    id: String(r.id),
    name: String(r.name),
    unit: String(r.unit),
    category_id: r.category_id != null ? String(r.category_id) : null,
    category_name: r.category_name != null ? String(r.category_name) : null,
    default_supplier_id: r.default_supplier_id != null ? String(r.default_supplier_id) : null,
    default_supplier_name: r.default_supplier_name != null ? String(r.default_supplier_name) : null,
    min_stock: r.min_stock != null ? Number(r.min_stock) : null,
    notes: r.notes != null ? String(r.notes) : null,
    is_active: Boolean(r.is_active),
    transaction_category: r.transaction_category as AtkTransactionCategory,
    created_at: String(r.created_at),
    updated_at: String(r.updated_at),
  };
}

function itemCols(sql: ReturnType<typeof db>) {
  return sql`
    i.id, i.name, i.unit, i.category_id, c.name AS category_name,
    i.default_supplier_id, s.name AS default_supplier_name,
    i.min_stock, i.notes, i.is_active, i.transaction_category,
    i.created_at::text, i.updated_at::text
  `;
}

export interface AtkItemInput {
  name: string;
  unit: string;
  category_id?: string | null;
  default_supplier_id?: string | null;
  min_stock?: number | null;
  notes?: string | null;
  transaction_category?: AtkTransactionCategory;
}

export async function listAtkItems(): Promise<AtkItemRow[]> {
  const sql = db();
  const rows = await sql`
    SELECT ${itemCols(sql)}
    FROM atk_item i
    LEFT JOIN atk_category c ON c.id = i.category_id
    LEFT JOIN atk_supplier s ON s.id = i.default_supplier_id
    ORDER BY i.name
  `;
  return rows.map(mapItem);
}

export async function createAtkItem(t: AtkItemInput): Promise<AtkItemRow> {
  const sql = db();
  const rows = await sql`
    INSERT INTO atk_item (name, unit, category_id, default_supplier_id, min_stock, notes, transaction_category)
    VALUES (${t.name}, ${t.unit}, ${t.category_id ?? null}, ${t.default_supplier_id ?? null},
            ${t.min_stock ?? null}, ${t.notes ?? null}, ${t.transaction_category ?? "barang"})
    RETURNING id
  `;
  const created = await getAtkItem(String(rows[0].id));
  if (!created) throw new Error("gagal membaca item ATK setelah dibuat");
  return created;
}

export async function getAtkItem(id: string): Promise<AtkItemRow | null> {
  const sql = db();
  const rows = await sql`
    SELECT ${itemCols(sql)}
    FROM atk_item i
    LEFT JOIN atk_category c ON c.id = i.category_id
    LEFT JOIN atk_supplier s ON s.id = i.default_supplier_id
    WHERE i.id = ${id}
  `;
  return rows.length ? mapItem(rows[0]) : null;
}

export interface AtkItemUpdate {
  name?: string;
  unit?: string;
  category_id?: string | null;
  default_supplier_id?: string | null;
  min_stock?: number | null;
  notes?: string | null;
  is_active?: boolean;
  transaction_category?: AtkTransactionCategory;
}

export async function updateAtkItem(id: string, f: AtkItemUpdate): Promise<AtkItemRow | null> {
  const sql = db();
  const rows = await sql`
    UPDATE atk_item SET
      name                 = COALESCE(${f.name ?? null}, name),
      unit                 = COALESCE(${f.unit ?? null}, unit),
      category_id          = ${f.category_id !== undefined ? f.category_id : sql`category_id`},
      default_supplier_id  = ${f.default_supplier_id !== undefined ? f.default_supplier_id : sql`default_supplier_id`},
      min_stock            = ${f.min_stock !== undefined ? f.min_stock : sql`min_stock`},
      notes                = ${f.notes !== undefined ? f.notes : sql`notes`},
      is_active            = COALESCE(${f.is_active ?? null}, is_active),
      transaction_category = COALESCE(${f.transaction_category ?? null}, transaction_category),
      updated_at           = now()
    WHERE id = ${id}
    RETURNING id
  `;
  return rows.length ? getAtkItem(id) : null;
}

export async function deleteAtkItem(id: string): Promise<{ deleted: number }> {
  const sql = db();
  const rows = await sql`DELETE FROM atk_item WHERE id = ${id} RETURNING id`;
  return { deleted: rows.length };
}
