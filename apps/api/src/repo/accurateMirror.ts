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
      ON CONFLICT (id) DO UPDATE SET
        no=COALESCE(NULLIF(EXCLUDED.no,''), accurate_customer.no),
        name=COALESCE(NULLIF(EXCLUDED.name,''), accurate_customer.name),
        branch_id=COALESCE(EXCLUDED.branch_id, accurate_customer.branch_id),
        raw=EXCLUDED.raw, last_synced_at=now()
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
  rows: { id: number; no?: string; name?: string; category?: string; unit_price?: number; quantity?: number; available?: number; unit?: string; raw?: unknown }[],
): Promise<number> {
  const sql = db();
  let n = 0;
  for (const r of rows) {
    if (r.id === undefined || r.id === null) continue;
    await sql`
      INSERT INTO accurate_item (id, no, name, category, unit_price, quantity, available, unit, raw, last_synced_at)
      VALUES (${r.id}, ${r.no ?? null}, ${r.name ?? null}, ${r.category ?? null}, ${r.unit_price ?? null}, ${r.quantity ?? null}, ${r.available ?? null}, ${r.unit ?? null}, ${sql.json(j(r.raw ?? {}))}, now())
      ON CONFLICT (id) DO UPDATE SET no=EXCLUDED.no, name=EXCLUDED.name,
        category=EXCLUDED.category, unit_price=EXCLUDED.unit_price,
        quantity=COALESCE(EXCLUDED.quantity, accurate_item.quantity),
        available=COALESCE(EXCLUDED.available, accurate_item.available),
        unit=COALESCE(EXCLUDED.unit, accurate_item.unit),
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

// customer_id mirror SO/DO (migrasi 162) = FK ke accurate_customer. Sync customer
// jalan di job yang sama tapi bisa TERTINGGAL (customer baru muncul di SO sebelum
// tabel customer ter-refresh). Karena itu id-nya tidak ditulis mentah, melainkan
// lewat subquery skalar: kalau customer belum ada → NULL, bukan foreign key
// violation yang menggagalkan seluruh upsert. Baris tetap punya customer_name dan
// akan tertaut sendiri di sync berikutnya (backfill migrasi 162 pola sama).
export async function upsertSalesOrders(
  rows: { id: number; number?: string; trans_date?: string | null; customer_name?: string; customer_id?: number; status?: string; total_amount?: number; raw?: unknown }[],
): Promise<number> {
  const sql = db();
  let n = 0;
  for (const r of rows) {
    if (r.id === undefined || r.id === null) continue;
    if (r.number) {
      // Baris lain yang menempati id ini pasti sisa dokumen lama: id Accurate unik
      // per dokumen, jadi nomor berbeda di id yang sama = baris yatim. Dibuang dulu
      // supaya INSERT di bawah tak tabrakan primary key (item ikut via ON DELETE CASCADE).
      await sql`DELETE FROM accurate_sales_order WHERE id = ${r.id} AND number IS DISTINCT FROM ${r.number}`;
      await sql`
        INSERT INTO accurate_sales_order (id, number, trans_date, customer_name, customer_id, status, total_amount, raw, last_synced_at)
        VALUES (${r.id}, ${r.number}, ${r.trans_date ?? null}, ${r.customer_name ?? null}, (SELECT c.id FROM accurate_customer c WHERE c.id = ${r.customer_id ?? null}), ${r.status ?? null}, ${r.total_amount ?? null}, ${sql.json(j(r.raw ?? {}))}, now())
        ON CONFLICT (number) WHERE number IS NOT NULL DO UPDATE SET
          id=EXCLUDED.id, trans_date=EXCLUDED.trans_date,
          customer_name=EXCLUDED.customer_name, customer_id=EXCLUDED.customer_id, status=EXCLUDED.status, total_amount=EXCLUDED.total_amount,
          raw=EXCLUDED.raw, last_synced_at=now(),
          items_synced_at=CASE WHEN accurate_sales_order.id <> EXCLUDED.id THEN NULL
                               ELSE accurate_sales_order.items_synced_at END
      `;
    } else {
      await sql`
        INSERT INTO accurate_sales_order (id, number, trans_date, customer_name, customer_id, status, total_amount, raw, last_synced_at)
        VALUES (${r.id}, ${null}, ${r.trans_date ?? null}, ${r.customer_name ?? null}, (SELECT c.id FROM accurate_customer c WHERE c.id = ${r.customer_id ?? null}), ${r.status ?? null}, ${r.total_amount ?? null}, ${sql.json(j(r.raw ?? {}))}, now())
        ON CONFLICT (id) DO UPDATE SET number=EXCLUDED.number, trans_date=EXCLUDED.trans_date,
          customer_name=EXCLUDED.customer_name, customer_id=EXCLUDED.customer_id, status=EXCLUDED.status, total_amount=EXCLUDED.total_amount,
          raw=EXCLUDED.raw, last_synced_at=now()
      `;
    }
    n += 1;
  }
  return n;
}

// Baris item SO/DO (migrasi 081). Delete+reinsert per dokumen supaya baris yang
// dihapus di Accurate ikut hilang, lalu stamp items_synced_at agar dokumen tak
// ditarik ulang tiap siklus sync.
export interface MirrorLine {
  line_no: number;
  item_no?: string | null;
  item_name?: string | null;
  qty?: number | null;
  unit?: string | null;
  raw?: unknown;
}

// Ambil id numerik dari payload detail Accurate (migrasi 096). Nol/kosong/non-angka
// diperlakukan sebagai "tidak ada tautan" — id Accurate selalu positif.
const rawId = (raw: unknown, key: string): number | null => {
  const v = (raw as Record<string, unknown> | null | undefined)?.[key];
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

export async function replaceSalesOrderItems(orderId: number, lines: MirrorLine[]): Promise<number> {
  const sql = db();
  await sql`DELETE FROM accurate_sales_order_item WHERE order_id = ${orderId}`;
  for (const l of lines) {
    await sql`
      INSERT INTO accurate_sales_order_item (order_id, line_no, item_no, item_name, qty, unit, raw, line_id)
      VALUES (${orderId}, ${l.line_no}, ${l.item_no ?? null}, ${l.item_name ?? null}, ${l.qty ?? null},
              ${l.unit ?? null}, ${sql.json(j(l.raw ?? {}))}, ${rawId(l.raw, "id")})
      ON CONFLICT (order_id, line_no) DO UPDATE SET
        item_no=EXCLUDED.item_no, item_name=EXCLUDED.item_name, qty=EXCLUDED.qty,
        unit=EXCLUDED.unit, raw=EXCLUDED.raw, line_id=EXCLUDED.line_id
    `;
  }
  await sql`UPDATE accurate_sales_order SET items_synced_at = now() WHERE id = ${orderId}`;
  return lines.length;
}

export async function replaceDeliveryOrderItems(deliveryId: number, lines: MirrorLine[]): Promise<number> {
  const sql = db();
  await sql`DELETE FROM accurate_delivery_order_item WHERE delivery_id = ${deliveryId}`;
  for (const l of lines) {
    await sql`
      INSERT INTO accurate_delivery_order_item (delivery_id, line_no, item_no, item_name, qty, unit, raw,
                                                sales_order_id, sales_order_detail_id)
      VALUES (${deliveryId}, ${l.line_no}, ${l.item_no ?? null}, ${l.item_name ?? null}, ${l.qty ?? null},
              ${l.unit ?? null}, ${sql.json(j(l.raw ?? {}))},
              ${rawId(l.raw, "salesOrderId")}, ${rawId(l.raw, "salesOrderDetailId")})
      ON CONFLICT (delivery_id, line_no) DO UPDATE SET
        item_no=EXCLUDED.item_no, item_name=EXCLUDED.item_name, qty=EXCLUDED.qty,
        unit=EXCLUDED.unit, raw=EXCLUDED.raw,
        sales_order_id=EXCLUDED.sales_order_id, sales_order_detail_id=EXCLUDED.sales_order_detail_id
    `;
  }
  await sql`UPDATE accurate_delivery_order SET items_synced_at = now() WHERE id = ${deliveryId}`;
  return lines.length;
}

/** Dokumen (terbaru dulu) sejak `sinceDays` yang baris itemnya belum pernah ditarik. */
export async function pendingItemDocs(
  entity: "so" | "do",
  sinceDays: number,
  limit: number,
): Promise<number[]> {
  const sql = db();
  const rows =
    entity === "so"
      ? await sql<{ id: string }[]>`
          SELECT id FROM accurate_sales_order
          WHERE items_synced_at IS NULL AND trans_date >= CURRENT_DATE - ${sinceDays}::int
          ORDER BY trans_date DESC NULLS LAST LIMIT ${limit}`
      : await sql<{ id: string }[]>`
          SELECT id FROM accurate_delivery_order
          WHERE items_synced_at IS NULL AND trans_date >= CURRENT_DATE - ${sinceDays}::int
          ORDER BY trans_date DESC NULLS LAST LIMIT ${limit}`;
  return rows.map((r) => Number(r.id));
}

/**
 * Jumlah dokumen yang baris itemnya belum ditarik — count sebenarnya, tanpa
 * LIMIT. Dipakai untuk `pending` di balikan /accurate/sync/doc-items supaya
 * pemanggil tahu sisa backlog yang asli; memakai pendingItemDocs(...).length
 * membuat angkanya mentok di nilai LIMIT dan terbaca seolah tak pernah maju.
 */
export async function countPendingItemDocs(
  entity: "so" | "do",
  sinceDays: number,
): Promise<number> {
  const sql = db();
  const rows =
    entity === "so"
      ? await sql<{ n: number }[]>`
          SELECT count(*)::int AS n FROM accurate_sales_order
          WHERE items_synced_at IS NULL AND trans_date >= CURRENT_DATE - ${sinceDays}::int`
      : await sql<{ n: number }[]>`
          SELECT count(*)::int AS n FROM accurate_delivery_order
          WHERE items_synced_at IS NULL AND trans_date >= CURRENT_DATE - ${sinceDays}::int`;
  return Number(rows[0]?.n ?? 0);
}

export async function listSalesOrders(limit = 500) {
  const sql = db();
  const rows = await sql`
    SELECT id, number, trans_date::text AS trans_date, customer_name, customer_id, status, total_amount
    FROM accurate_sales_order ORDER BY trans_date DESC NULLS LAST, id DESC LIMIT ${limit}
  `;
  return rows.map((r) => ({ ...r }));
}

export async function upsertDeliveryOrders(
  rows: { id: number; number?: string; trans_date?: string | null; customer_name?: string; customer_id?: number; ship_to?: string; status?: string; raw?: unknown }[],
): Promise<number> {
  const sql = db();
  let n = 0;
  for (const r of rows) {
    if (r.id === undefined || r.id === null) continue;
    if (r.number) {
      await sql`DELETE FROM accurate_delivery_order WHERE id = ${r.id} AND number IS DISTINCT FROM ${r.number}`;
      await sql`
        INSERT INTO accurate_delivery_order (id, number, trans_date, customer_name, customer_id, ship_to, status, raw, last_synced_at)
        VALUES (${r.id}, ${r.number}, ${r.trans_date ?? null}, ${r.customer_name ?? null}, (SELECT c.id FROM accurate_customer c WHERE c.id = ${r.customer_id ?? null}), ${r.ship_to ?? null}, ${r.status ?? null}, ${sql.json(j(r.raw ?? {}))}, now())
        ON CONFLICT (number) WHERE number IS NOT NULL DO UPDATE SET
          id=EXCLUDED.id, trans_date=EXCLUDED.trans_date,
          customer_name=EXCLUDED.customer_name, customer_id=EXCLUDED.customer_id, ship_to=EXCLUDED.ship_to, status=EXCLUDED.status,
          raw=EXCLUDED.raw, last_synced_at=now(),
          items_synced_at=CASE WHEN accurate_delivery_order.id <> EXCLUDED.id THEN NULL
                               ELSE accurate_delivery_order.items_synced_at END
      `;
    } else {
      await sql`
        INSERT INTO accurate_delivery_order (id, number, trans_date, customer_name, customer_id, ship_to, status, raw, last_synced_at)
        VALUES (${r.id}, ${null}, ${r.trans_date ?? null}, ${r.customer_name ?? null}, (SELECT c.id FROM accurate_customer c WHERE c.id = ${r.customer_id ?? null}), ${r.ship_to ?? null}, ${r.status ?? null}, ${sql.json(j(r.raw ?? {}))}, now())
        ON CONFLICT (id) DO UPDATE SET number=EXCLUDED.number, trans_date=EXCLUDED.trans_date,
          customer_name=EXCLUDED.customer_name, customer_id=EXCLUDED.customer_id, ship_to=EXCLUDED.ship_to, status=EXCLUDED.status,
          raw=EXCLUDED.raw, last_synced_at=now()
      `;
    }
    n += 1;
  }
  return n;
}

export async function listDeliveryOrders(limit = 500) {
  const sql = db();
  const rows = await sql`
    SELECT id, number, trans_date::text AS trans_date, customer_name, customer_id, ship_to, status
    FROM accurate_delivery_order ORDER BY trans_date DESC NULLS LAST, id DESC LIMIT ${limit}
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

// ── F37: stok per gudang (#836) ─────────────────────────────────────────────
// Saldo per gudang hanya tersedia lewat item/detail.do per SKU — lihat alasan
// lengkapnya di migrasi 166. Yang ada di sini bagian DB-nya; pemanggil API-nya
// `syncItemStockBranch()` di accurateSync.ts.

export interface WarehouseMapRow {
  accurate_warehouse_id: number;
  warehouse_kode: string;
}

/**
 * Allowlist gudang: id Accurate → kode kita. Puller TIDAK BOLEH menerima id di
 * luar hasil fungsi ini — 96 dari 109 gudang di Accurate adalah gudang virtual
 * milik customer (migrasi 166).
 */
export async function warehouseAccurateMap(): Promise<WarehouseMapRow[]> {
  const sql = db();
  // Ikut menggerbang `jenis = 'cabang'` + `aktif`, sama seperti query baca di
  // stock-branch.ts. Pemetaan yang menunjuk gudang nonaktif tak boleh diam-diam
  // menghidupkannya kembali lewat pintu puller.
  const rows = await sql<{ accurate_warehouse_id: string; warehouse_kode: string }[]>`
    SELECT wa.accurate_warehouse_id::text AS accurate_warehouse_id, wa.warehouse_kode
    FROM warehouse_accurate wa
    JOIN warehouse w ON w.kode = wa.warehouse_kode
    WHERE w.jenis = 'cabang' AND w.aktif
  `;
  return rows.map((r) => ({
    accurate_warehouse_id: Number(r.accurate_warehouse_id),
    warehouse_kode: String(r.warehouse_kode),
  }));
}

/** Satu entri `detailWarehouseData` dari item/detail.do, sebatas yang dipakai. */
export interface DetailWarehouseEntry {
  id?: unknown;
  balance?: unknown;
  warehouseName?: unknown;
}

/**
 * Ringkas `detailWarehouseData` satu SKU menjadi qty per KODE GUDANG KITA.
 *
 * Fungsi MURNI — di sinilah tiga keputusan 2026-09-06 benar-benar berlaku, dan
 * di sinilah kesalahan paling mahal bisa terjadi tanpa gejala. Diuji di
 * accurate-stock-branch.test.ts.
 *
 *  · id di luar allowlist DIBUANG (96 gudang customer);
 *  · beberapa id yang menunjuk kode sama DIJUMLAHKAN (tiga Surabaya → `SBY`);
 *  · saldo negatif dijepit ke 0 — `item_stock_branch.quantity` punya
 *    CHECK (quantity >= 0), jadi tanpa jepitan ini satu baris minus membuat
 *    SELURUH sapuan item itu gagal insert.
 */
export function ringkasStokPerGudang(
  entries: DetailWarehouseEntry[],
  map: WarehouseMapRow[],
): Map<string, number> {
  const byId = new Map<number, string>();
  for (const m of map) byId.set(m.accurate_warehouse_id, m.warehouse_kode);

  const hasil = new Map<string, number>();
  for (const e of entries ?? []) {
    const id = Number(e?.id);
    if (!Number.isFinite(id)) continue;
    const kode = byId.get(id);
    if (!kode) continue; // di luar allowlist — gudang customer / bukan cabang
    // `balance` kosong DILEWATI, bukan dibaca 0. Tanpa cabang eksplisit ini,
    // `Number(null)` = 0 sementara `Number(undefined)` = NaN — dua bentuk
    // "tidak ada angka" diperlakukan berbeda karena kebetulan JS, bukan karena
    // keputusan, dan yang null tertulis jadi stok 0 sungguhan.
    const bal = e?.balance;
    if (bal === null || bal === undefined || bal === "") continue;
    const qty = Number(bal);
    if (!Number.isFinite(qty)) continue;
    hasil.set(kode, (hasil.get(kode) ?? 0) + Math.max(0, qty));
  }
  return hasil;
}

/**
 * Tulis stok satu SKU untuk gudang-gudang YANG DIPETAKAN saja.
 *
 * Cakupan hapusnya sengaja dibatasi ke `kodeDipetakan`: baris milik lima cabang
 * yang di-skip (LAMONGAN/TUBAN/JOGJA/SOLO/NTT) berasal dari CSV dan TIDAK boleh
 * ikut terhapus oleh puller yang tak punya angka untuk mereka.
 *
 * Untuk gudang yang dipetakan, Accurate adalah sumber kebenaran: baris lama
 * (termasuk source='import') digantikan. Gudang yang saldonya 0 tidak ditulis
 * barisnya — supaya metrik "item tanpa data" tetap bermakna, bukan penuh nol.
 */
export async function replaceItemStockBranch(
  itemId: number,
  qtyPerKode: Map<string, number>,
  kodeDipetakan: string[],
): Promise<number> {
  const sql = db();
  if (kodeDipetakan.length === 0) return 0;

  await sql`
    DELETE FROM item_stock_branch
    WHERE item_id = ${itemId} AND warehouse_kode = ANY(${kodeDipetakan}::text[])
  `;
  let ditulis = 0;
  for (const [kode, qty] of qtyPerKode) {
    if (qty <= 0) continue;
    await sql`
      INSERT INTO item_stock_branch (item_id, warehouse_kode, quantity, source, updated_at)
      VALUES (${itemId}, ${kode}, ${qty}, 'accurate', now())
      ON CONFLICT (item_id, warehouse_kode) DO UPDATE SET
        quantity = EXCLUDED.quantity, source = EXCLUDED.source, updated_at = EXCLUDED.updated_at
    `;
    ditulis += 1;
  }
  await sql`UPDATE accurate_item SET stock_synced_at = now() WHERE id = ${itemId}`;
  return ditulis;
}

/** SKU yang paling lama (atau belum pernah) ditarik stok per-gudangnya. */
export async function pendingStockItems(limit: number): Promise<number[]> {
  const sql = db();
  const rows = await sql<{ id: string }[]>`
    SELECT id::text AS id FROM accurate_item
    ORDER BY stock_synced_at ASC NULLS FIRST, id
    LIMIT ${limit}
  `;
  return rows.map((r) => Number(r.id));
}

/**
 * Sisa SKU yang belum pernah ditarik sama sekali — angka SEBENARNYA tanpa
 * LIMIT. Memakai pendingStockItems(...).length akan mentok di nilai LIMIT dan
 * terbaca seolah backlog tak pernah berkurang (jebakan yang sama sudah pernah
 * dicatat untuk countPendingItemDocs).
 */
export async function countPendingStockItems(): Promise<number> {
  const sql = db();
  const [r] = await sql<{ n: string }[]>`
    SELECT count(*)::text AS n FROM accurate_item WHERE stock_synced_at IS NULL
  `;
  return Number(r?.n ?? 0);
}
