import { db } from "../db.js";

// F49 ATK Stock Movement (General Affairs) — ledger transaksi stok
// masuk/keluar barang ATK (lihat 069_atk_stock_movement.sql), konsumen
// katalog F134 (atk-master.ts). date/timestamptz eksplisit ::text di
// SELECT/RETURNING — pola sama dgn atk-master.ts/supplier-eta.ts
// (postgres.js balikin objek Date tanpa cast).

export type AtkMovementType = "in" | "out";

export interface AtkStockMovementRow {
  id: string;
  item_id: string;
  item_name: string;
  item_unit: string;
  movement_type: AtkMovementType;
  qty: number;
  movement_date: string;
  reference: string | null;
  pic: string | null;
  cabang: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

function mapMovement(r: Record<string, unknown>): AtkStockMovementRow {
  return {
    id: String(r.id),
    item_id: String(r.item_id),
    item_name: String(r.item_name),
    item_unit: String(r.item_unit),
    movement_type: r.movement_type as AtkMovementType,
    qty: Number(r.qty),
    movement_date: String(r.movement_date),
    reference: r.reference != null ? String(r.reference) : null,
    pic: r.pic != null ? String(r.pic) : null,
    cabang: r.cabang != null ? String(r.cabang) : null,
    notes: r.notes != null ? String(r.notes) : null,
    created_at: String(r.created_at),
    updated_at: String(r.updated_at),
  };
}

function movementCols(sql: ReturnType<typeof db>) {
  return sql`
    m.id, m.item_id, i.name AS item_name, i.unit AS item_unit,
    m.movement_type, m.qty, m.movement_date::text, m.reference, m.pic, m.cabang, m.notes,
    m.created_at::text, m.updated_at::text
  `;
}

export interface AtkStockMovementInput {
  item_id: string;
  movement_type: AtkMovementType;
  qty: number;
  movement_date?: string | null;
  reference?: string | null;
  pic?: string | null;
  cabang?: string | null;
  notes?: string | null;
}

export async function listAtkStockMovements(): Promise<AtkStockMovementRow[]> {
  const sql = db();
  const rows = await sql`
    SELECT ${movementCols(sql)}
    FROM atk_stock_movement m
    JOIN atk_item i ON i.id = m.item_id
    ORDER BY m.movement_date DESC, m.created_at DESC
  `;
  return rows.map(mapMovement);
}

export async function createAtkStockMovement(t: AtkStockMovementInput): Promise<AtkStockMovementRow> {
  const sql = db();
  const rows = await sql`
    INSERT INTO atk_stock_movement (item_id, movement_type, qty, movement_date, reference, pic, cabang, notes)
    VALUES (${t.item_id}, ${t.movement_type}, ${t.qty}, ${t.movement_date ?? sql`CURRENT_DATE`},
            ${t.reference ?? null}, ${t.pic ?? null}, ${t.cabang ?? null}, ${t.notes ?? null})
    RETURNING id
  `;
  const created = await getAtkStockMovement(String(rows[0].id));
  if (!created) throw new Error("gagal membaca mutasi stok ATK setelah dibuat");
  return created;
}

export async function getAtkStockMovement(id: string): Promise<AtkStockMovementRow | null> {
  const sql = db();
  const rows = await sql`
    SELECT ${movementCols(sql)}
    FROM atk_stock_movement m
    JOIN atk_item i ON i.id = m.item_id
    WHERE m.id = ${id}
  `;
  return rows.length ? mapMovement(rows[0]) : null;
}

export interface AtkStockMovementUpdate {
  item_id?: string;
  movement_type?: AtkMovementType;
  qty?: number;
  movement_date?: string;
  reference?: string | null;
  pic?: string | null;
  cabang?: string | null;
  notes?: string | null;
}

export async function updateAtkStockMovement(id: string, f: AtkStockMovementUpdate): Promise<AtkStockMovementRow | null> {
  const sql = db();
  const rows = await sql`
    UPDATE atk_stock_movement SET
      item_id       = COALESCE(${f.item_id ?? null}, item_id),
      movement_type = COALESCE(${f.movement_type ?? null}, movement_type),
      qty           = COALESCE(${f.qty ?? null}, qty),
      movement_date = COALESCE(${f.movement_date ?? null}, movement_date),
      reference     = ${f.reference !== undefined ? f.reference : sql`reference`},
      pic           = ${f.pic !== undefined ? f.pic : sql`pic`},
      cabang        = ${f.cabang !== undefined ? f.cabang : sql`cabang`},
      notes         = ${f.notes !== undefined ? f.notes : sql`notes`},
      updated_at    = now()
    WHERE id = ${id}
    RETURNING id
  `;
  return rows.length ? getAtkStockMovement(id) : null;
}

export async function deleteAtkStockMovement(id: string): Promise<{ deleted: number }> {
  const sql = db();
  const rows = await sql`DELETE FROM atk_stock_movement WHERE id = ${id} RETURNING id`;
  return { deleted: rows.length };
}

export interface AtkStockLevelRow {
  item_id: string;
  item_name: string;
  unit: string;
  category_name: string | null;
  min_stock: number | null;
  is_active: boolean;
  stock_in: number;
  stock_out: number;
  current_stock: number;
  is_low_stock: boolean;
}

export async function listAtkStockLevels(): Promise<AtkStockLevelRow[]> {
  const sql = db();
  const rows = await sql`
    SELECT
      i.id AS item_id, i.name AS item_name, i.unit, c.name AS category_name,
      i.min_stock, i.is_active,
      COALESCE(SUM(CASE WHEN m.movement_type = 'in' THEN m.qty ELSE 0 END), 0) AS stock_in,
      COALESCE(SUM(CASE WHEN m.movement_type = 'out' THEN m.qty ELSE 0 END), 0) AS stock_out
    FROM atk_item i
    LEFT JOIN atk_category c ON c.id = i.category_id
    LEFT JOIN atk_stock_movement m ON m.item_id = i.id
    GROUP BY i.id, i.name, i.unit, c.name, i.min_stock, i.is_active
    ORDER BY i.name
  `;
  return rows.map((r) => {
    const stockIn = Number(r.stock_in);
    const stockOut = Number(r.stock_out);
    const currentStock = stockIn - stockOut;
    const minStock = r.min_stock != null ? Number(r.min_stock) : null;
    return {
      item_id: String(r.item_id),
      item_name: String(r.item_name),
      unit: String(r.unit),
      category_name: r.category_name != null ? String(r.category_name) : null,
      min_stock: minStock,
      is_active: Boolean(r.is_active),
      stock_in: stockIn,
      stock_out: stockOut,
      current_stock: currentStock,
      is_low_stock: minStock != null && currentStock < minStock,
    };
  });
}
