import { db } from "../db.js";

// F136 ATK Stock Opname (General Affairs) — hitung fisik vs stok sistem
// (lihat 131_atk_stock_opname.sql). system_qty snapshot dihitung di sini
// (SUM in - SUM out per item, sama query dgn listAtkStockLevels di
// atk-stock.ts) saat opname dibuat, lalu dibekukan. variance dihitung di JS
// dari system_qty/counted_qty yg sudah beku — bukan kolom tersimpan. date/
// timestamptz eksplisit ::text di SELECT/RETURNING — pola sama dgn
// atk-stock.ts/atk-master.ts (postgres.js balikin objek Date tanpa cast).

export interface AtkStockOpnameRow {
  id: string;
  item_id: string;
  item_name: string;
  item_unit: string;
  opname_date: string;
  system_qty: number;
  counted_qty: number;
  variance: number;
  counted_by: string | null;
  cabang: string | null;
  notes: string | null;
  adjustment_movement_id: string | null;
  created_at: string;
  updated_at: string;
}

function mapOpname(r: Record<string, unknown>): AtkStockOpnameRow {
  const systemQty = Number(r.system_qty);
  const countedQty = Number(r.counted_qty);
  return {
    id: String(r.id),
    item_id: String(r.item_id),
    item_name: String(r.item_name),
    item_unit: String(r.item_unit),
    opname_date: String(r.opname_date),
    system_qty: systemQty,
    counted_qty: countedQty,
    variance: countedQty - systemQty,
    counted_by: r.counted_by != null ? String(r.counted_by) : null,
    cabang: r.cabang != null ? String(r.cabang) : null,
    notes: r.notes != null ? String(r.notes) : null,
    adjustment_movement_id: r.adjustment_movement_id != null ? String(r.adjustment_movement_id) : null,
    created_at: String(r.created_at),
    updated_at: String(r.updated_at),
  };
}

function opnameCols(sql: ReturnType<typeof db>) {
  return sql`
    o.id, o.item_id, i.name AS item_name, i.unit AS item_unit,
    o.opname_date::text, o.system_qty, o.counted_qty, o.counted_by, o.cabang, o.notes,
    o.adjustment_movement_id, o.created_at::text, o.updated_at::text
  `;
}

export interface AtkStockOpnameInput {
  item_id: string;
  counted_qty: number;
  opname_date?: string | null;
  counted_by?: string | null;
  cabang?: string | null;
  notes?: string | null;
}

export async function listAtkStockOpnames(): Promise<AtkStockOpnameRow[]> {
  const sql = db();
  const rows = await sql`
    SELECT ${opnameCols(sql)}
    FROM atk_stock_opname o
    JOIN atk_item i ON i.id = o.item_id
    ORDER BY o.opname_date DESC, o.created_at DESC
  `;
  return rows.map(mapOpname);
}

async function currentStockOf(itemId: string): Promise<number> {
  const sql = db();
  const rows = await sql`
    SELECT
      COALESCE(SUM(CASE WHEN movement_type = 'in' THEN qty ELSE 0 END), 0)
      - COALESCE(SUM(CASE WHEN movement_type = 'out' THEN qty ELSE 0 END), 0) AS current_stock
    FROM atk_stock_movement
    WHERE item_id = ${itemId}
  `;
  return Number(rows[0]?.current_stock ?? 0);
}

export async function createAtkStockOpname(t: AtkStockOpnameInput): Promise<AtkStockOpnameRow> {
  const sql = db();
  const systemQty = await currentStockOf(t.item_id);
  const rows = await sql`
    INSERT INTO atk_stock_opname (item_id, opname_date, system_qty, counted_qty, counted_by, cabang, notes)
    VALUES (${t.item_id}, ${t.opname_date ?? sql`CURRENT_DATE`}, ${systemQty}, ${t.counted_qty},
            ${t.counted_by ?? null}, ${t.cabang ?? null}, ${t.notes ?? null})
    RETURNING id
  `;
  const created = await getAtkStockOpname(String(rows[0].id));
  if (!created) throw new Error("gagal membaca opname stok ATK setelah dibuat");
  return created;
}

export async function getAtkStockOpname(id: string): Promise<AtkStockOpnameRow | null> {
  const sql = db();
  const rows = await sql`
    SELECT ${opnameCols(sql)}
    FROM atk_stock_opname o
    JOIN atk_item i ON i.id = o.item_id
    WHERE o.id = ${id}
  `;
  return rows.length ? mapOpname(rows[0]) : null;
}

export interface AtkStockOpnameUpdate {
  counted_by?: string | null;
  cabang?: string | null;
  notes?: string | null;
  adjustment_movement_id?: string | null;
}

export async function updateAtkStockOpname(id: string, f: AtkStockOpnameUpdate): Promise<AtkStockOpnameRow | null> {
  const sql = db();
  const rows = await sql`
    UPDATE atk_stock_opname SET
      counted_by             = ${f.counted_by !== undefined ? f.counted_by : sql`counted_by`},
      cabang                 = ${f.cabang !== undefined ? f.cabang : sql`cabang`},
      notes                  = ${f.notes !== undefined ? f.notes : sql`notes`},
      adjustment_movement_id = ${f.adjustment_movement_id !== undefined ? f.adjustment_movement_id : sql`adjustment_movement_id`},
      updated_at             = now()
    WHERE id = ${id}
    RETURNING id
  `;
  return rows.length ? getAtkStockOpname(id) : null;
}

export async function deleteAtkStockOpname(id: string): Promise<{ deleted: number }> {
  const sql = db();
  const rows = await sql`DELETE FROM atk_stock_opname WHERE id = ${id} RETURNING id`;
  return { deleted: rows.length };
}
