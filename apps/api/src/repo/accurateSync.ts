import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";

import { db } from "../db.js";
import { ingestAccurateWebhook, normalizeAccurateDate, type AccurateInvoice } from "./ar.js";
import { upsertVendors, upsertItems, upsertSalesOrders, upsertDeliveryOrders } from "./accurateMirror.js";

// Puller Accurate Online (pengganti legacy sync_accurate.sh). Tarik sales-invoice
// header+items dari zeus.accurate.id → mirror penuh accurate_* + refresh ar_aging.
//
// Auth: Authorization: Bearer <access_token> + X-Api-Timestamp (dd/MM/yyyy
// HH:mm:ss WIB) + X-Api-Signature (HMAC-SHA256 hex(signature_secret, timestamp)).
// Hanya GET (read-only). Kredensial: env ACCURATE_ACCESS_TOKEN +
// ACCURATE_SIGNATURE_SECRET (+ACCURATE_HOST), atau file ACCURATE_CRED_FILE
// (default ~/.openclaw/credentials/accurate.json).

interface Creds {
  token: string;
  secret: string;
  host: string;
}

function loadCreds(): Creds | null {
  const host = process.env.ACCURATE_HOST || "zeus.accurate.id";
  const envTok = process.env.ACCURATE_ACCESS_TOKEN;
  const envSec = process.env.ACCURATE_SIGNATURE_SECRET;
  if (envTok && envSec) return { token: envTok, secret: envSec, host };
  const path = process.env.ACCURATE_CRED_FILE || `${homedir()}/.openclaw/credentials/accurate.json`;
  try {
    const j = JSON.parse(readFileSync(path, "utf8")) as { access_token?: string; signature_secret?: string };
    if (j.access_token && j.signature_secret) return { token: j.access_token, secret: j.signature_secret, host };
  } catch {
    /* file tak ada / tak valid → null */
  }
  return null;
}

export function accurateConfigured(): boolean {
  return loadCreds() !== null;
}

function wibTimestamp(): string {
  const d = new Date(Date.now() + 7 * 3600 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}

async function accGet(creds: Creds, path: string, qs?: string): Promise<{ s?: boolean; d?: unknown }> {
  const ts = wibTimestamp();
  const sig = createHmac("sha256", creds.secret).update(ts).digest("hex");
  const url = `https://${creds.host}${path}${qs ? `?${qs}` : ""}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${creds.token}`, "X-Api-Timestamp": ts, "X-Api-Signature": sig },
    signal: AbortSignal.timeout(30_000),
  });
  return (await res.json()) as { s?: boolean; d?: unknown };
}

const num = (v: unknown): number => Number(v ?? 0) || 0;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Detail = any;

// Upsert SATU invoice detail (.d) → mirror penuh: customer/branch/invoice/
// salesman/item/invoice_item (delete+reinsert items). Idempoten by id.
async function upsertInvoiceDetail(d: Detail): Promise<boolean> {
  const sql = db();
  const invId = Number(d?.id);
  if (!invId) return false;
  const tgl = normalizeAccurateDate(d.transDate);
  if (!tgl) return false;

  const custId = d.customerId ?? d.customer?.id ?? null;
  const custName = d.retailWpName ?? d.customer?.name ?? null;
  const branchId = d.branchId ?? null;
  const status = d.outstanding ? "OPEN" : "PAID";
  const smId = d.masterSalesmanId ?? null;
  const allSm: Detail[] = (d.detailItem ?? []).flatMap((it: Detail) => it.salesmanList ?? []);
  let smName: string | null = null;
  if (smId != null) smName = allSm.find((s) => Number(s.id) === Number(smId))?.name ?? null;
  if (!smName) smName = d.detailItem?.[0]?.salesmanName ?? null;

  if (custId != null) {
    await sql`
      INSERT INTO accurate_customer (id, name, branch_id, last_synced_at)
      VALUES (${custId}, ${custName}, ${branchId}, now())
      ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, branch_id = EXCLUDED.branch_id, last_synced_at = now()
    `;
  }
  if (branchId != null) {
    await sql`
      INSERT INTO accurate_branch (id, suspended, last_synced_at)
      VALUES (${branchId}, false, now())
      ON CONFLICT (id) DO UPDATE SET last_synced_at = now()
    `;
  }

  await sql`
    INSERT INTO accurate_invoice
      (id, number, customer_id, branch_id, tanggal, taxable_amount, tax_amount, total, paid,
       outstanding, status, salesman_id, salesman_name, raw, last_synced_at)
    VALUES
      (${invId}, ${d.number ?? d.transNumber ?? null}, ${custId}, ${branchId}, ${tgl},
       ${num(d.taxableAmount1)}, ${num(d.tax1Amount)}, ${num(d.totalAmount)}, ${num(d.totalPaid)},
       ${num(d.totalDue)}, ${status}, ${smId}, ${smName},
       ${sql.json(d as Parameters<typeof sql.json>[0])}, now())
    ON CONFLICT (id) DO UPDATE SET
      number = EXCLUDED.number, customer_id = EXCLUDED.customer_id, branch_id = EXCLUDED.branch_id,
      tanggal = EXCLUDED.tanggal, taxable_amount = EXCLUDED.taxable_amount, tax_amount = EXCLUDED.tax_amount,
      total = EXCLUDED.total, paid = EXCLUDED.paid, outstanding = EXCLUDED.outstanding, status = EXCLUDED.status,
      salesman_id = EXCLUDED.salesman_id, salesman_name = EXCLUDED.salesman_name, raw = EXCLUDED.raw,
      last_synced_at = now()
  `;

  for (const s of allSm) {
    if (s?.id == null) continue;
    await sql`
      INSERT INTO accurate_salesman (id, name, number, branch_id, suspended, employee_work_status, last_synced_at)
      VALUES (${s.id}, ${s.name ?? null}, ${s.number ?? null}, ${s.branchId ?? null},
              ${s.suspended ?? false}, ${s.employeeWorkStatus ?? null}, now())
      ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, number = EXCLUDED.number,
        branch_id = EXCLUDED.branch_id, suspended = EXCLUDED.suspended,
        employee_work_status = EXCLUDED.employee_work_status, last_synced_at = now()
    `;
  }

  await sql`DELETE FROM accurate_invoice_item WHERE invoice_id = ${invId}`;
  let lineNo = 0;
  for (const it of (d.detailItem ?? []) as Detail[]) {
    lineNo += 1;
    const itemId = it.item?.id ?? it.itemId ?? null;
    if (itemId != null) {
      await sql`
        INSERT INTO accurate_item (id, no, name, category, unit_price, raw, last_synced_at)
        VALUES (${itemId}, ${it.item?.no ?? null}, ${it.item?.name ?? null}, ${it.item?.itemType ?? null},
                ${num(it.unitPrice)}, ${sql.json((it.item ?? {}) as Parameters<typeof sql.json>[0])}, now())
        ON CONFLICT (id) DO UPDATE SET no = COALESCE(EXCLUDED.no, accurate_item.no),
          name = COALESCE(EXCLUDED.name, accurate_item.name),
          category = COALESCE(EXCLUDED.category, accurate_item.category),
          unit_price = EXCLUDED.unit_price, last_synced_at = now()
      `;
    }
    await sql`
      INSERT INTO accurate_invoice_item (invoice_id, item_id, line_no, qty, unit, unit_price, discount_amount, total, raw)
      VALUES (${invId}, ${itemId}, ${lineNo}, ${num(it.quantity)},
              ${it.itemUnit?.name ?? it.itemUnitName ?? null}, ${num(it.unitPrice)},
              ${num(it.itemCashDiscount)}, ${num(it.totalPrice)},
              ${sql.json(it as Parameters<typeof sql.json>[0])})
    `;
  }
  return true;
}

function isoDaysAgo(days: number): string {
  return new Date(Date.now() + 7 * 3600 * 1000 - days * 86_400_000).toISOString().slice(0, 10);
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function recordState(processed: number, days: number, ok: boolean): Promise<void> {
  const sql = db();
  await sql`
    INSERT INTO accurate_sync_state (entity, last_synced_at, last_run_ok, last_run_summary)
    VALUES ('sales-invoice', now(), ${ok},
            ${sql.json({ processed, days } as Parameters<typeof sql.json>[0])})
    ON CONFLICT (entity) DO UPDATE SET last_synced_at = now(), last_run_ok = ${ok},
      last_run_summary = ${sql.json({ processed, days } as Parameters<typeof sql.json>[0])}
  `;
}

export interface AccurateSyncResult {
  ok: boolean;
  mode?: "single" | "incremental";
  processed?: number;
  days?: number;
  pages?: number;
  error?: string;
}

// Sync sales-invoice. invoiceId → satu invoice; selainnya incremental (window
// `days` hari, recent-first, stop saat transDate < threshold).
// Tarik master vendor (vendor/list.do) → mirror accurate_vendor. Paginated (100/hal).
export async function syncVendors(): Promise<{ ok: boolean; synced: number; error?: string }> {
  const creds = loadCreds();
  if (!creds) return { ok: false, synced: 0, error: "kredensial Accurate tak tersedia" };
  let page = 1;
  let synced = 0;
  for (;;) {
    const list = await accGet(creds, "/accurate/api/vendor/list.do", `sp.page=${page}&sp.pageSize=100&fields=id,name,vendorBranchName`);
    const rows = Array.isArray(list.d) ? (list.d as Array<Record<string, unknown>>) : [];
    if (rows.length === 0) break;
    await upsertVendors(
      rows.map((v) => ({
        id: Number(v.id),
        name: v.name != null ? String(v.name) : undefined,
        branch_name: v.vendorBranchName != null ? String(v.vendorBranchName) : undefined,
        raw: v,
      })),
    );
    synced += rows.length;
    if (rows.length < 100 || page >= 50) break;
    page += 1;
  }
  return { ok: true, synced };
}

// Tarik full katalog item (item/list.do) + STOK → mirror accurate_item.
// Paginated (100/hal, ~58 hal utk 5.794 item). Untuk menu Inventory & Products.
export async function syncItems(): Promise<{ ok: boolean; synced: number; error?: string }> {
  const creds = loadCreds();
  if (!creds) return { ok: false, synced: 0, error: "kredensial Accurate tak tersedia" };
  let page = 1;
  let synced = 0;
  for (;;) {
    const list = await accGet(creds, "/accurate/api/item/list.do", `sp.page=${page}&sp.pageSize=100&fields=id,no,name,itemType,unitPrice,quantity,availableToSell`);
    const rows = Array.isArray(list.d) ? (list.d as Array<Record<string, unknown>>) : [];
    if (rows.length === 0) break;
    await upsertItems(
      rows.map((v) => ({
        id: Number(v.id),
        no: v.no != null ? String(v.no) : undefined,
        name: v.name != null ? String(v.name) : undefined,
        category: v.itemType != null ? String(v.itemType) : undefined,
        unit_price: v.unitPrice != null ? Number(v.unitPrice) : undefined,
        quantity: v.quantity != null ? Number(v.quantity) : undefined,
        available: v.availableToSell != null ? Number(v.availableToSell) : undefined,
        raw: v,
      })),
    );
    synced += rows.length;
    if (rows.length < 100 || page >= 100) break;
    page += 1;
    await new Promise((r) => setTimeout(r, 150));
  }
  return { ok: true, synced };
}

// Tarik sales-order TERBARU (sales-order/list.do, sort transDate desc) → mirror
// accurate_sales_order utk menu Orders. Volume total ~11.8rb, jadi cuma recent
// (default 5 hal = 500 order). customer di-nested (customer.name).
export async function syncSalesOrders(opts: { maxPages?: number } = {}): Promise<{ ok: boolean; synced: number; error?: string }> {
  const creds = loadCreds();
  if (!creds) return { ok: false, synced: 0, error: "kredensial Accurate tak tersedia" };
  const maxPages = opts.maxPages ?? 5;
  let page = 1;
  let synced = 0;
  for (; page <= maxPages; page++) {
    const list = await accGet(
      creds,
      "/accurate/api/sales-order/list.do",
      `sp.page=${page}&sp.pageSize=100&sp.sort=transDate|desc&fields=id,number,transDate,statusName,totalAmount,customer`,
    );
    const rows = Array.isArray(list.d) ? (list.d as Array<Record<string, unknown>>) : [];
    if (rows.length === 0) break;
    await upsertSalesOrders(
      rows.map((v) => {
        const td = v.transDate != null ? String(v.transDate) : "";
        const [dd, mm, yy] = td.split("/");
        const iso = dd && mm && yy ? `${yy}-${mm}-${dd}` : null;
        const cust = v.customer && typeof v.customer === "object" ? (v.customer as { name?: unknown }).name : null;
        return {
          id: Number(v.id),
          number: v.number != null ? String(v.number) : undefined,
          trans_date: iso,
          customer_name: cust != null ? String(cust) : undefined,
          status: v.statusName != null ? String(v.statusName) : undefined,
          total_amount: v.totalAmount != null ? Number(v.totalAmount) : undefined,
          raw: v,
        };
      }),
    );
    synced += rows.length;
    if (rows.length < 100) break;
    await sleep(150);
  }
  return { ok: true, synced };
}

// Tarik delivery-order TERBARU (delivery-order/list.do, sort transDate desc) →
// mirror accurate_delivery_order utk menu Shipments. Volume ~11.9rb → recent saja.
export async function syncDeliveryOrders(opts: { maxPages?: number } = {}): Promise<{ ok: boolean; synced: number; error?: string }> {
  const creds = loadCreds();
  if (!creds) return { ok: false, synced: 0, error: "kredensial Accurate tak tersedia" };
  const maxPages = opts.maxPages ?? 5;
  let page = 1;
  let synced = 0;
  for (; page <= maxPages; page++) {
    const list = await accGet(
      creds,
      "/accurate/api/delivery-order/list.do",
      `sp.page=${page}&sp.pageSize=100&sp.sort=transDate|desc&fields=id,number,transDate,statusName,customer,toAddress`,
    );
    const rows = Array.isArray(list.d) ? (list.d as Array<Record<string, unknown>>) : [];
    if (rows.length === 0) break;
    await upsertDeliveryOrders(
      rows.map((v) => {
        const td = v.transDate != null ? String(v.transDate) : "";
        const [dd, mm, yy] = td.split("/");
        const iso = dd && mm && yy ? `${yy}-${mm}-${dd}` : null;
        const cust = v.customer && typeof v.customer === "object" ? (v.customer as { name?: unknown }).name : null;
        return {
          id: Number(v.id),
          number: v.number != null ? String(v.number) : undefined,
          trans_date: iso,
          customer_name: cust != null ? String(cust) : undefined,
          ship_to: v.toAddress != null ? String(v.toAddress) : undefined,
          status: v.statusName != null ? String(v.statusName) : undefined,
          raw: v,
        };
      }),
    );
    synced += rows.length;
    if (rows.length < 100) break;
    await sleep(150);
  }
  return { ok: true, synced };
}

// Ambil baris produk (detailItem) satu delivery-order via detail.do — dipakai
// on-demand saat user buka detail Shipments (bukan disimpan tiap sync).
export async function getDeliveryOrderItems(
  id: number,
): Promise<{ ok: boolean; items: { no: string | null; name: string | null; quantity: number | null; unit: string | null }[]; error?: string }> {
  const creds = loadCreds();
  if (!creds) return { ok: false, items: [], error: "kredensial Accurate tak tersedia" };
  const det = await accGet(creds, "/accurate/api/delivery-order/detail.do", `id=${id}`);
  if (det?.s !== true) return { ok: false, items: [], error: `detail gagal: ${JSON.stringify(det?.d).slice(0, 160)}` };
  const d = det.d as Detail;
  const items = ((d?.detailItem ?? []) as Detail[]).map((it) => ({
    no: it.item?.no ?? null,
    name: it.item?.name ?? it.detailName ?? null,
    quantity: it.quantity != null ? Number(it.quantity) : null,
    unit: it.itemUnit?.name ?? it.itemUnitName ?? null,
  }));
  return { ok: true, items };
}

export async function syncAccurateInvoices(
  opts: { days?: number; invoiceId?: number } = {},
): Promise<AccurateSyncResult> {
  const creds = loadCreds();
  if (!creds) {
    return { ok: false, error: "kredensial Accurate tak tersedia (set ACCURATE_ACCESS_TOKEN+ACCURATE_SIGNATURE_SECRET atau ACCURATE_CRED_FILE)" };
  }

  if (opts.invoiceId) {
    const det = await accGet(creds, "/accurate/api/sales-invoice/detail.do", `id=${opts.invoiceId}`);
    if (det?.s !== true) return { ok: false, error: `detail gagal: ${JSON.stringify(det?.d).slice(0, 200)}` };
    const done = await upsertInvoiceDetail(det.d as Detail);
    try {
      await ingestAccurateWebhook([det.d as AccurateInvoice]);
    } catch {
      /* aging refresh opsional */
    }
    await recordState(done ? 1 : 0, 0, true);
    return { ok: true, mode: "single", processed: done ? 1 : 0 };
  }

  const days = opts.days ?? 7;
  const threshold = isoDaysAgo(days);
  const detailRecs: AccurateInvoice[] = [];
  let processed = 0;
  let page = 1;
  for (; page <= 200; page++) {
    const list = await accGet(creds, "/accurate/api/sales-invoice/list.do", `sp.page=${page}&sp.pageSize=50&fields=id,transDate`);
    if (list?.s !== true) {
      if (page === 1) {
        await recordState(processed, days, false);
        return { ok: false, error: `list gagal: ${JSON.stringify(list?.d).slice(0, 200)}` };
      }
      break;
    }
    const arr = (list.d ?? []) as Detail[];
    if (arr.length === 0) break;
    let stop = false;
    for (const row of arr) {
      const tgl = normalizeAccurateDate(row.transDate);
      if (tgl && tgl < threshold) {
        stop = true;
        break;
      }
      const det = await accGet(creds, "/accurate/api/sales-invoice/detail.do", `id=${row.id}`);
      if (det?.s !== true) continue;
      if (await upsertInvoiceDetail(det.d as Detail)) {
        processed += 1;
        detailRecs.push(det.d as AccurateInvoice);
      }
      await sleep(150);
    }
    if (stop) break;
  }

  if (detailRecs.length > 0) {
    try {
      await ingestAccurateWebhook(detailRecs);
    } catch {
      /* aging refresh opsional */
    }
  }
  await recordState(processed, days, true);
  return { ok: true, mode: "incremental", processed, days, pages: page };
}
