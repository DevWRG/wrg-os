import { db } from "../db.js";

// D2 — mirror master Accurate (port legacy accurate_customer/item/branch).
// Upsert by Accurate id; simpan raw JSONB. Feeder dari sinkronisasi Accurate.

const j = (v: unknown) => v as unknown as Parameters<ReturnType<typeof db>["json"]>[0];

export async function upsertCustomers(
  rows: { id: number; no?: string; name?: string; branch_id?: number; raw?: unknown }[],
): Promise<number> {
  const sql = db();
  let n = 0;
  for (const r of rows) {
    if (r.id === undefined || r.id === null) continue;
    await sql`
      INSERT INTO accurate_customer (id, no, name, branch_id, raw, last_synced_at)
      VALUES (${r.id}, ${r.no ?? null}, ${r.name ?? null}, ${r.branch_id ?? null}, ${sql.json(j(r.raw ?? {}))}, now())
      ON CONFLICT (id) DO UPDATE SET no=EXCLUDED.no, name=EXCLUDED.name,
        branch_id=EXCLUDED.branch_id, raw=EXCLUDED.raw, last_synced_at=now()
    `;
    n += 1;
  }
  return n;
}

export async function upsertBranches(
  rows: { id: number; name?: string; suspended?: boolean; raw?: unknown }[],
): Promise<number> {
  const sql = db();
  let n = 0;
  for (const r of rows) {
    if (r.id === undefined || r.id === null) continue;
    await sql`
      INSERT INTO accurate_branch (id, name, suspended, raw, last_synced_at)
      VALUES (${r.id}, ${r.name ?? null}, ${r.suspended ?? false}, ${sql.json(j(r.raw ?? {}))}, now())
      ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, suspended=EXCLUDED.suspended,
        raw=EXCLUDED.raw, last_synced_at=now()
    `;
    n += 1;
  }
  return n;
}

export async function upsertItems(
  rows: { id: number; no?: string; name?: string; category?: string; unit_price?: number; quantity?: number; available?: number; raw?: unknown }[],
): Promise<number> {
  const sql = db();
  let n = 0;
  for (const r of rows) {
    if (r.id === undefined || r.id === null) continue;
    await sql`
      INSERT INTO accurate_item (id, no, name, category, unit_price, quantity, available, raw, last_synced_at)
      VALUES (${r.id}, ${r.no ?? null}, ${r.name ?? null}, ${r.category ?? null}, ${r.unit_price ?? null}, ${r.quantity ?? null}, ${r.available ?? null}, ${sql.json(j(r.raw ?? {}))}, now())
      ON CONFLICT (id) DO UPDATE SET no=EXCLUDED.no, name=EXCLUDED.name,
        category=EXCLUDED.category, unit_price=EXCLUDED.unit_price,
        quantity=COALESCE(EXCLUDED.quantity, accurate_item.quantity),
        available=COALESCE(EXCLUDED.available, accurate_item.available),
        raw=EXCLUDED.raw, last_synced_at=now()
    `;
    n += 1;
  }
  return n;
}

export async function upsertVendors(
  rows: { id: number; name?: string; branch_name?: string; raw?: unknown }[],
): Promise<number> {
  const sql = db();
  let n = 0;
  for (const r of rows) {
    if (r.id === undefined || r.id === null) continue;
    await sql`
      INSERT INTO accurate_vendor (id, name, branch_name, raw, last_synced_at)
      VALUES (${r.id}, ${r.name ?? null}, ${r.branch_name ?? null}, ${sql.json(j(r.raw ?? {}))}, now())
      ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, branch_name=EXCLUDED.branch_name, raw=EXCLUDED.raw, last_synced_at=now()
    `;
    n += 1;
  }
  return n;
}

export async function upsertSalesOrders(
  rows: { id: number; number?: string; trans_date?: string | null; customer_name?: string; status?: string; total_amount?: number; raw?: unknown }[],
): Promise<number> {
  const sql = db();
  let n = 0;
  for (const r of rows) {
    if (r.id === undefined || r.id === null) continue;
    await sql`
      INSERT INTO accurate_sales_order (id, number, trans_date, customer_name, status, total_amount, raw, last_synced_at)
      VALUES (${r.id}, ${r.number ?? null}, ${r.trans_date ?? null}, ${r.customer_name ?? null}, ${r.status ?? null}, ${r.total_amount ?? null}, ${sql.json(j(r.raw ?? {}))}, now())
      ON CONFLICT (id) DO UPDATE SET number=EXCLUDED.number, trans_date=EXCLUDED.trans_date,
        customer_name=EXCLUDED.customer_name, status=EXCLUDED.status, total_amount=EXCLUDED.total_amount,
        raw=EXCLUDED.raw, last_synced_at=now()
    `;
    n += 1;
  }
  return n;
}

export async function listSalesOrders(limit = 500) {
  const sql = db();
  const rows = await sql`
    SELECT id, number, trans_date::text AS trans_date, customer_name, status, total_amount
    FROM accurate_sales_order ORDER BY trans_date DESC NULLS LAST, id DESC LIMIT ${limit}
  `;
  return rows.map((r) => ({ ...r }));
}

export async function listMirror(entity: "customers" | "items" | "branches" | "vendors", limit = 100) {
  const sql = db();
  const table = entity === "customers" ? sql`accurate_customer` : entity === "items" ? sql`accurate_item` : entity === "vendors" ? sql`accurate_vendor` : sql`accurate_branch`;
  const rows = await sql`SELECT * FROM ${table} ORDER BY last_synced_at DESC LIMIT ${limit}`;
  return rows.map((r) => {
    const { raw, ...rest } = r as Record<string, unknown>;
    void raw;
    return rest;
  });
}
