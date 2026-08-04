import { db } from "../db.js";

// F132 — GA Aset Master (General Affairs). Katalog inventaris kantor, single
// source of truth (menyerap rencana `it_asset` F52 — lihat migrasi 086).
// F133 (assignment/transfer/history) & F137 (maintenance) FK ke ga_assets.
//
// Skema diadaptasi dari repo gais (github.com/ditoanggara919-lang/gais,
// backend/routes/assets.js) — termasuk formula asset_code & pola hybrid PIC
// (current_pic_user_id FK + pic_name_override free-text). Assign/return/
// transfer SUNGGUHAN (yang menulis histori ke ga_asset_assignments/
// ga_asset_transfers) ada di repo/ga-asset-assignment.ts (F133) — file ini
// cuma CRUD dasar aset+kategori, termasuk override PIC manual TANPA histori
// (dipakai form edit cepat, beda dari aksi "Assign" resmi F133).

const toIsoDate = (x: unknown): string | null => (x == null ? null : new Date(x as string | Date).toISOString().slice(0, 10));
const toIsoTs = (x: unknown): string => new Date(x as string | Date).toISOString();

export interface ActionResult {
  ok: boolean;
  error?: string;
}

// ───────────────────────── Kategori ─────────────────────────

export interface GaAssetCategoryRow {
  id: string;
  code: string;
  nama: string;
  depreciation_years: number | null;
  icon: string | null;
  is_shared: boolean;
  // F137 — default recur_months disodorkan (auto-fill) saat bikin jadwal
  // maintenance utk aset di kategori ini (mis. "Kendaraan Bermotor"=6,
  // "AC"=3 — contoh dari brief F137, TIDAK diseed, admin isi sendiri).
  default_recur_months: number | null;
  active: boolean;
}

function mapCategoryRow(r: Record<string, unknown>): GaAssetCategoryRow {
  return {
    id: String(r.id),
    code: String(r.code),
    nama: String(r.nama),
    depreciation_years: r.depreciation_years == null ? null : Number(r.depreciation_years),
    icon: r.icon ? String(r.icon) : null,
    is_shared: Boolean(r.is_shared),
    default_recur_months: r.default_recur_months == null ? null : Number(r.default_recur_months),
    active: Boolean(r.active),
  };
}

export async function listCategories(activeOnly = true): Promise<GaAssetCategoryRow[]> {
  const sql = db();
  const rows = await sql`
    SELECT * FROM ga_asset_categories WHERE ${activeOnly ? sql`active = true` : sql`true`}
    ORDER BY nama ASC
  `;
  return rows.map(mapCategoryRow);
}

export interface GaAssetCategoryInput {
  code: string;
  nama: string;
  depreciation_years?: number | null;
  icon?: string | null;
  is_shared?: boolean;
  default_recur_months?: number | null;
}

export async function createCategory(input: GaAssetCategoryInput): Promise<GaAssetCategoryRow | ActionResult> {
  const sql = db();
  const code = input.code.trim();
  const nama = input.nama.trim();
  if (!code || !nama) return { ok: false, error: "code & nama wajib diisi" };
  const existing = await sql`SELECT 1 FROM ga_asset_categories WHERE code = ${code} LIMIT 1`;
  if (existing.length > 0) return { ok: false, error: `code "${code}" sudah dipakai` };
  const rows = await sql`
    INSERT INTO ga_asset_categories (code, nama, depreciation_years, icon, is_shared, default_recur_months)
    VALUES (${code}, ${nama}, ${input.depreciation_years ?? null}, ${input.icon ?? null}, ${input.is_shared ?? false}, ${input.default_recur_months ?? null})
    RETURNING *
  `;
  return mapCategoryRow(rows[0]);
}

export interface GaAssetCategoryUpdateInput {
  nama?: string | null;
  depreciation_years?: number | null;
  icon?: string | null;
  is_shared?: boolean | null;
  default_recur_months?: number | null;
  active?: boolean | null;
}

export async function updateCategory(id: string, input: GaAssetCategoryUpdateInput): Promise<ActionResult> {
  const sql = db();
  const rows = await sql`SELECT id FROM ga_asset_categories WHERE id = ${id}`;
  if (rows.length === 0) return { ok: false, error: "kategori tidak ditemukan" };
  await sql`
    UPDATE ga_asset_categories SET
      nama = COALESCE(${input.nama ?? null}, nama),
      depreciation_years = COALESCE(${input.depreciation_years ?? null}, depreciation_years),
      icon = COALESCE(${input.icon ?? null}, icon),
      default_recur_months = COALESCE(${input.default_recur_months ?? null}, default_recur_months),
      is_shared = COALESCE(${input.is_shared ?? null}, is_shared),
      active = COALESCE(${input.active ?? null}, active),
      updated_at = now()
    WHERE id = ${id}
  `;
  return { ok: true };
}

// ───────────────────────── Aset ─────────────────────────

export interface GaAssetRow {
  id: string;
  asset_code: string;
  nama: string;
  category_id: string;
  category_nama: string;
  is_shared_category: boolean;
  brand: string | null;
  model: string | null;
  serial_number: string | null;
  purchase_date: string | null;
  purchase_price: number;
  current_value: number;
  warranty_expiry: string | null;
  location: string | null;
  current_pic_user_id: string | null;
  pic_name: string | null; // COALESCE(pic_name_override, app_user.name)
  department: string | null;
  condition: string;
  status: string;
  foto_path: string | null;
  dokumen_path: string | null;
  notes: string | null;
  is_critical: boolean;
  active: boolean;
  created_at: string;
  updated_at: string;
}

function mapAssetRow(r: Record<string, unknown>): GaAssetRow {
  return {
    id: String(r.id),
    asset_code: String(r.asset_code),
    nama: String(r.nama),
    category_id: String(r.category_id),
    category_nama: String(r.category_nama ?? ""),
    is_shared_category: Boolean(r.is_shared_category),
    brand: r.brand ? String(r.brand) : null,
    model: r.model ? String(r.model) : null,
    serial_number: r.serial_number ? String(r.serial_number) : null,
    purchase_date: toIsoDate(r.purchase_date),
    purchase_price: Number(r.purchase_price ?? 0),
    current_value: Number(r.current_value ?? 0),
    warranty_expiry: toIsoDate(r.warranty_expiry),
    location: r.location ? String(r.location) : null,
    current_pic_user_id: r.current_pic_user_id ? String(r.current_pic_user_id) : null,
    pic_name: r.pic_name ? String(r.pic_name) : null,
    department: r.department ? String(r.department) : null,
    condition: String(r.condition),
    status: String(r.status),
    foto_path: r.foto_path ? String(r.foto_path) : null,
    dokumen_path: r.dokumen_path ? String(r.dokumen_path) : null,
    notes: r.notes ? String(r.notes) : null,
    is_critical: Boolean(r.is_critical),
    active: Boolean(r.active),
    created_at: toIsoTs(r.created_at),
    updated_at: toIsoTs(r.updated_at),
  };
}

// NB: query ditulis lengkap tiap fungsi (bukan compose via sql.unsafe +
// interpolasi lanjutan) — kombinasi itu TIDAK reliable di postgres.js
// (pelajaran F37/F38, lihat technical.md).
export interface ListAssetsFilter {
  activeOnly?: boolean;
  categoryId?: string;
  status?: string;
  unassigned?: boolean;
}

export async function listAssets(filter: ListAssetsFilter = {}): Promise<GaAssetRow[]> {
  const sql = db();
  const rows = await sql`
    SELECT a.*, c.nama AS category_nama, c.is_shared AS is_shared_category,
           COALESCE(a.pic_name_override, u.name) AS pic_name
    FROM ga_assets a
    JOIN ga_asset_categories c ON c.id = a.category_id
    LEFT JOIN app_user u ON u.id = a.current_pic_user_id
    WHERE ${filter.activeOnly === false ? sql`true` : sql`a.active = true`}
      AND ${filter.categoryId ? sql`a.category_id = ${filter.categoryId}` : sql`true`}
      AND ${filter.status ? sql`a.status = ${filter.status}` : sql`true`}
      AND ${filter.unassigned ? sql`a.current_pic_user_id IS NULL AND a.pic_name_override IS NULL` : sql`true`}
    ORDER BY a.updated_at DESC, a.asset_code ASC
  `;
  return rows.map(mapAssetRow);
}

export async function getAsset(id: string): Promise<GaAssetRow | null> {
  const sql = db();
  const rows = await sql`
    SELECT a.*, c.nama AS category_nama, c.is_shared AS is_shared_category,
           COALESCE(a.pic_name_override, u.name) AS pic_name
    FROM ga_assets a
    JOIN ga_asset_categories c ON c.id = a.category_id
    LEFT JOIN app_user u ON u.id = a.current_pic_user_id
    WHERE a.id = ${id}
  `;
  return rows.length ? mapAssetRow(rows[0]) : null;
}

// Formula EKSAK dari source gais routes/assets.js: basis tahun dari tanggal
// input (NOW()), BUKAN purchase_date. Reset otomatis tiap tahun kalender krn
// filter LIKE 'AST-<tahun ini>-%'.
async function generateAssetCode(): Promise<string> {
  const sql = db();
  const [row] = await sql`
    SELECT 'AST-' || TO_CHAR(NOW(), 'YYYY') || '-' ||
           LPAD((COALESCE(MAX(SUBSTRING(asset_code FROM 10)::int), 0) + 1)::text, 4, '0') AS next_code
    FROM ga_assets
    WHERE asset_code LIKE 'AST-' || TO_CHAR(NOW(), 'YYYY') || '-%'
  `;
  return String(row.next_code);
}

export interface GaAssetInput {
  asset_code?: string | null; // kosong = auto-gen
  nama: string;
  category_id: string;
  brand?: string | null;
  model?: string | null;
  serial_number?: string | null;
  purchase_date?: string | null;
  purchase_price?: number | null;
  current_value?: number | null;
  warranty_expiry?: string | null;
  location?: string | null;
  department?: string | null;
  condition?: string | null;
  status?: string | null;
  foto_path?: string | null;
  dokumen_path?: string | null;
  notes?: string | null;
  is_critical?: boolean;
}

export async function createAsset(input: GaAssetInput): Promise<GaAssetRow | ActionResult> {
  const sql = db();
  const nama = input.nama.trim();
  if (!nama) return { ok: false, error: "nama wajib diisi" };
  if (!input.category_id) return { ok: false, error: "category_id wajib diisi" };
  const cat = await sql`SELECT 1 FROM ga_asset_categories WHERE id = ${input.category_id}`;
  if (cat.length === 0) return { ok: false, error: "kategori tidak ditemukan" };

  const code = input.asset_code?.trim() || (await generateAssetCode());
  const existing = await sql`SELECT 1 FROM ga_assets WHERE asset_code = ${code} LIMIT 1`;
  if (existing.length > 0) return { ok: false, error: `asset_code "${code}" sudah dipakai` };

  const rows = await sql`
    INSERT INTO ga_assets (
      asset_code, nama, category_id, brand, model, serial_number,
      purchase_date, purchase_price, current_value, warranty_expiry, location,
      department, condition, status, foto_path, dokumen_path, notes, is_critical
    ) VALUES (
      ${code}, ${nama}, ${input.category_id}, ${input.brand ?? null}, ${input.model ?? null}, ${input.serial_number ?? null},
      ${input.purchase_date ?? null}, ${input.purchase_price ?? 0}, ${input.current_value ?? 0}, ${input.warranty_expiry ?? null}, ${input.location ?? null},
      ${input.department ?? null}, ${input.condition ?? "baik"}, ${input.status ?? "active"}, ${input.foto_path ?? null}, ${input.dokumen_path ?? null}, ${input.notes ?? null}, ${input.is_critical ?? false}
    )
    RETURNING id
  `;
  return (await getAsset(String(rows[0].id)))!;
}

export interface GaAssetUpdateInput {
  nama?: string | null;
  category_id?: string | null;
  brand?: string | null;
  model?: string | null;
  serial_number?: string | null;
  purchase_date?: string | null;
  purchase_price?: number | null;
  current_value?: number | null;
  warranty_expiry?: string | null;
  location?: string | null;
  department?: string | null;
  condition?: string | null;
  status?: string | null;
  foto_path?: string | null;
  dokumen_path?: string | null;
  notes?: string | null;
  is_critical?: boolean | null;
  active?: boolean | null;
  // Override PIC manual cepat (TANPA histori assignment — beda dari aksi
  // "Assign" resmi F133). Kirim pic_name_override = "" utk mengosongkan.
  pic_name_override?: string | null;
}

export async function updateAsset(id: string, input: GaAssetUpdateInput): Promise<ActionResult> {
  const sql = db();
  const rows = await sql`SELECT id FROM ga_assets WHERE id = ${id}`;
  if (rows.length === 0) return { ok: false, error: "aset tidak ditemukan" };
  const picProvided = Object.prototype.hasOwnProperty.call(input, "pic_name_override");
  const picValue = input.pic_name_override == null || input.pic_name_override === "" ? null : String(input.pic_name_override);
  await sql`
    UPDATE ga_assets SET
      nama = COALESCE(${input.nama ?? null}, nama),
      category_id = COALESCE(${input.category_id ?? null}, category_id),
      brand = COALESCE(${input.brand ?? null}, brand),
      model = COALESCE(${input.model ?? null}, model),
      serial_number = COALESCE(${input.serial_number ?? null}, serial_number),
      purchase_date = COALESCE(${input.purchase_date ?? null}, purchase_date),
      purchase_price = COALESCE(${input.purchase_price ?? null}, purchase_price),
      current_value = COALESCE(${input.current_value ?? null}, current_value),
      warranty_expiry = COALESCE(${input.warranty_expiry ?? null}, warranty_expiry),
      location = COALESCE(${input.location ?? null}, location),
      department = COALESCE(${input.department ?? null}, department),
      condition = COALESCE(${input.condition ?? null}, condition),
      status = COALESCE(${input.status ?? null}, status),
      foto_path = COALESCE(${input.foto_path ?? null}, foto_path),
      dokumen_path = COALESCE(${input.dokumen_path ?? null}, dokumen_path),
      notes = COALESCE(${input.notes ?? null}, notes),
      is_critical = COALESCE(${input.is_critical ?? null}, is_critical),
      active = COALESCE(${input.active ?? null}, active),
      pic_name_override = CASE WHEN ${picProvided}::boolean THEN ${picValue} ELSE pic_name_override END,
      updated_at = now()
    WHERE id = ${id}
  `;
  return { ok: true };
}

// Dipakai F133 (assign resmi) & bisa dipakai UI F132 utk auto-suggest: cari
// app_user via exact case-insensitive match nama — pola PERSIS source gais
// (routes/assets.js, auto-resolve pic_name -> user_id kalau cocok).
export async function resolveUserByName(name: string): Promise<string | null> {
  const sql = db();
  const rows = await sql`SELECT id FROM app_user WHERE lower(name) = lower(${name}) LIMIT 1`;
  return rows.length ? String(rows[0].id) : null;
}

// Upload foto/dokumen aset — dipanggil dari POST /ga-assets/:id/upload
// setelah file ditulis ke disk (lihat GA_UPLOAD_ROOT di index.ts). Simpan
// PATH ABSOLUT (bukan URL) — sama pola `visit.photo_url` (raw media path,
// web resolve via /api/media?p=).
export async function setAssetFile(id: string, kind: "foto" | "dokumen", absPath: string): Promise<ActionResult> {
  const sql = db();
  const rows = await sql`SELECT id FROM ga_assets WHERE id = ${id}`;
  if (rows.length === 0) return { ok: false, error: "aset tidak ditemukan" };
  if (kind === "foto") {
    await sql`UPDATE ga_assets SET foto_path = ${absPath}, updated_at = now() WHERE id = ${id}`;
  } else {
    await sql`UPDATE ga_assets SET dokumen_path = ${absPath}, updated_at = now() WHERE id = ${id}`;
  }
  return { ok: true };
}
