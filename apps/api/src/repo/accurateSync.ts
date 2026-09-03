import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";

import { db } from "../db.js";
import { ingestAccurateWebhook, normalizeAccurateDate, type AccurateInvoice } from "./ar.js";
import {
  upsertVendors, upsertItems, upsertSalesOrders, upsertDeliveryOrders, upsertCustomers,
  replaceSalesOrderItems, replaceDeliveryOrderItems, pendingItemDocs, countPendingItemDocs,
} from "./accurateMirror.js";

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
  // Outstanding/paid: Accurate pakai primeOwing(+taxOwing) utk sisa tagihan, BUKAN
  // totalDue/totalPaid (yg kosong di payload detail → dulu bikin kolom selalu 0 →
  // laporan AR buang 99% invoice). paid = total − owing (clamp ≥0). Fix B 2026-07-14.
  const owing = num(d.primeOwing) + num(d.taxOwing);
  const paidAmt = Math.max(0, num(d.totalAmount) - owing);
  const smId = d.masterSalesmanId ?? null;
  const allSm: Detail[] = (d.detailItem ?? []).flatMap((it: Detail) => it.salesmanList ?? []);
  let smName: string | null = null;
  if (smId != null) smName = allSm.find((s) => Number(s.id) === Number(smId))?.name ?? null;
  if (!smName) smName = d.detailItem?.[0]?.salesmanName ?? null;

  if (custId != null) {
    await sql`
      INSERT INTO accurate_customer (id, name, branch_id, last_synced_at)
      VALUES (${custId}, ${custName}, ${branchId}, now())
      ON CONFLICT (id) DO UPDATE SET
        name = COALESCE(NULLIF(EXCLUDED.name, ''), accurate_customer.name),
        branch_id = EXCLUDED.branch_id, last_synced_at = now()
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
       ${num(d.taxableAmount1)}, ${num(d.tax1Amount)}, ${num(d.totalAmount)}, ${paidAmt},
       ${owing}, ${status}, ${smId}, ${smName},
       ${sql.json(d as Parameters<typeof sql.json>[0])}, now())
    ON CONFLICT (id) DO UPDATE SET
      number = EXCLUDED.number, customer_id = EXCLUDED.customer_id, branch_id = EXCLUDED.branch_id,
      tanggal = EXCLUDED.tanggal, taxable_amount = EXCLUDED.taxable_amount, tax_amount = EXCLUDED.tax_amount,
      total = EXCLUDED.total, paid = EXCLUDED.paid, outstanding = EXCLUDED.outstanding, status = EXCLUDED.status,
      salesman_id = EXCLUDED.salesman_id, salesman_name = EXCLUDED.salesman_name, raw = EXCLUDED.raw,
      -- lunas_at (migrasi 094, dipakai Collection Factor F67): stempel HANYA saat sync
      -- benar-benar MENGAMATI perpindahan OPEN → PAID. Urutan CASE-nya menentukan:
      --   1. balik jadi OPEN (retur/koreksi) → NULL lagi, jangan tinggalkan stempel basi
      --   2. sudah pernah distempel → pertahankan, jangan digeser tiap kali sync jalan
      --   3. baris lama OPEN & sekarang PAID → inilah transisinya, stempel hari ini
      --   4. sisanya = sudah PAID sejak pertama kali terlihat → NULL, umur tak diketahui.
      --      SENGAJA tidak distempel: kalau distempel, seluruh invoice lama akan terlihat
      --      berumur (hari ini − tanggal terbit) dan kena CF 0,50 massal.
      lunas_at = CASE
        WHEN EXCLUDED.status <> 'PAID' THEN NULL
        WHEN accurate_invoice.lunas_at IS NOT NULL THEN accurate_invoice.lunas_at
        WHEN accurate_invoice.status = 'OPEN' THEN CURRENT_DATE
        ELSE NULL
      END,
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

// Tarik master customer (customer/list.do) → mirror accurate_customer (id/no/name).
// Backfill nama yg kosong (mirror cuma diisi dari raw invoice yg kadang tanpa nama).
// Paginated 100/hal. Guard upsert COALESCE(NULLIF(...)) → gak nge-blank nama yg udah ada.
export async function syncCustomers(): Promise<{ ok: boolean; synced: number; error?: string }> {
  const creds = loadCreds();
  if (!creds) return { ok: false, synced: 0, error: "kredensial Accurate tak tersedia" };
  let page = 1;
  let synced = 0;
  for (;;) {
    const list = await accGet(creds, "/accurate/api/customer/list.do", `sp.page=${page}&sp.pageSize=100&fields=id,name,customerNo`);
    const rows = Array.isArray(list.d) ? (list.d as Array<Record<string, unknown>>) : [];
    if (rows.length === 0) break;
    await upsertCustomers(
      rows.map((v) => ({
        id: Number(v.id),
        no: v.customerNo != null ? String(v.customerNo) : undefined,
        name: v.name != null ? String(v.name) : undefined,
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

// Tarik full katalog item (item/list.do) + STOK → mirror accurate_item.
// Paginated (100/hal, ~58 hal utk 5.794 item). Untuk menu Inventory & Products.
export async function syncItems(): Promise<{ ok: boolean; synced: number; error?: string }> {
  const creds = loadCreds();
  if (!creds) return { ok: false, synced: 0, error: "kredensial Accurate tak tersedia" };
  let page = 1;
  let synced = 0;
  for (;;) {
    const list = await accGet(creds, "/accurate/api/item/list.do", `sp.page=${page}&sp.pageSize=100&fields=id,no,name,itemType,unitPrice,quantity,availableToSell,unit1`);
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
        unit: (v.unit1 as { name?: string } | null | undefined)?.name ?? undefined,
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
// Halaman dianggap sudah melewati cutoff bila SELURUH barisnya lebih tua dari
// `sinceDays`. Sengaja "seluruhnya", bukan "baris terakhir": tanggal kosong /
// tak terparse jangan sampai menghentikan paginasi lebih awal.
function allOlderThan(rows: { trans_date?: string | null }[], sinceDays: number): boolean {
  const cutoff = new Date(Date.now() - sinceDays * 86_400_000).toISOString().slice(0, 10);
  const dated = rows.map((r) => r.trans_date).filter((d): d is string => typeof d === "string" && d !== "");
  return dated.length > 0 && dated.every((d) => d < cutoff);
}

export async function syncSalesOrders(opts: { maxPages?: number; sinceDays?: number } = {}): Promise<{ ok: boolean; synced: number; error?: string }> {
  const creds = loadCreds();
  if (!creds) return { ok: false, synced: 0, error: "kredensial Accurate tak tersedia" };
  // Batas halaman tetap ada sebagai pagar, tapi yang menentukan berhenti adalah
  // TANGGAL: list di-sort transDate desc, jadi begitu satu halaman seluruhnya
  // lebih tua dari cutoff, sisanya pasti lebih tua juga. Tanpa ini "5 halaman"
  // bisa memotong bulan berjalan saat volume order naik — dan fill rate yang
  // dihitung dari mirror terpotong akan salah tanpa jejak.
  const maxPages = opts.maxPages ?? 40;
  const sinceDays = opts.sinceDays ?? 120;
  let page = 1;
  let synced = 0;
  let cutoffReached = false;
  for (; page <= maxPages && !cutoffReached; page++) {
    const list = await accGet(
      creds,
      "/accurate/api/sales-order/list.do",
      `sp.page=${page}&sp.pageSize=100&sp.sort=transDate|desc&fields=id,number,transDate,statusName,totalAmount,customer`,
    );
    const rows = Array.isArray(list.d) ? (list.d as Array<Record<string, unknown>>) : [];
    if (rows.length === 0) break;
    const mapped = rows.map((v) => {
      const td = v.transDate != null ? String(v.transDate) : "";
      const [dd, mm, yy] = td.split("/");
      const iso = dd && mm && yy ? `${yy}-${mm}-${dd}` : null;
      // Objek customer membawa id + name + customerNo (fields=…,customer). Dulu hanya
      // `name` yang diambil, sehingga fitur hilir tak bisa menautkan ke
      // accurate_customer — lihat migrasi 162. `id` diambil defensif: 0/non-angka
      // diperlakukan sebagai "tak ada tautan" (id Accurate selalu positif).
      const co = v.customer && typeof v.customer === "object" ? (v.customer as { name?: unknown; id?: unknown }) : null;
      const custId = Number(co?.id);
      return {
        id: Number(v.id),
        number: v.number != null ? String(v.number) : undefined,
        trans_date: iso,
        customer_name: co?.name != null ? String(co.name) : undefined,
        customer_id: Number.isFinite(custId) && custId > 0 ? custId : undefined,
        status: v.statusName != null ? String(v.statusName) : undefined,
        total_amount: v.totalAmount != null ? Number(v.totalAmount) : undefined,
        raw: v,
      };
    });
    await upsertSalesOrders(mapped);
    synced += rows.length;
    cutoffReached = allOlderThan(mapped, sinceDays);
    if (rows.length < 100) break;
    await sleep(150);
  }
  return { ok: true, synced };
}

// Tarik delivery-order TERBARU (delivery-order/list.do, sort transDate desc) →
// mirror accurate_delivery_order utk menu Shipments. Volume ~11.9rb → recent saja.
export async function syncDeliveryOrders(opts: { maxPages?: number; sinceDays?: number } = {}): Promise<{ ok: boolean; synced: number; error?: string }> {
  const creds = loadCreds();
  if (!creds) return { ok: false, synced: 0, error: "kredensial Accurate tak tersedia" };
  const maxPages = opts.maxPages ?? 40;
  const sinceDays = opts.sinceDays ?? 120;
  let page = 1;
  let synced = 0;
  let cutoffReached = false;
  for (; page <= maxPages && !cutoffReached; page++) {
    const list = await accGet(
      creds,
      "/accurate/api/delivery-order/list.do",
      `sp.page=${page}&sp.pageSize=100&sp.sort=transDate|desc&fields=id,number,transDate,statusName,customer,toAddress`,
    );
    const rows = Array.isArray(list.d) ? (list.d as Array<Record<string, unknown>>) : [];
    if (rows.length === 0) break;
    const mapped = rows.map((v) => {
      const td = v.transDate != null ? String(v.transDate) : "";
      const [dd, mm, yy] = td.split("/");
      const iso = dd && mm && yy ? `${yy}-${mm}-${dd}` : null;
      // Sama dengan sales-order di atas: ambil id customer, bukan cuma namanya (migrasi 162).
      const co = v.customer && typeof v.customer === "object" ? (v.customer as { name?: unknown; id?: unknown }) : null;
      const custId = Number(co?.id);
      return {
        id: Number(v.id),
        number: v.number != null ? String(v.number) : undefined,
        trans_date: iso,
        customer_name: co?.name != null ? String(co.name) : undefined,
        customer_id: Number.isFinite(custId) && custId > 0 ? custId : undefined,
        ship_to: v.toAddress != null ? String(v.toAddress) : undefined,
        status: v.statusName != null ? String(v.statusName) : undefined,
        raw: v,
      };
    });
    await upsertDeliveryOrders(mapped);
    synced += rows.length;
    cutoffReached = allOlderThan(mapped, sinceDays);
    if (rows.length < 100) break;
    await sleep(150);
  }
  return { ok: true, synced };
}

// ── Tarik baris item SO/DO ke mirror (migrasi 081) ────────────────
//
// Satu panggilan detail.do PER dokumen, jadi sengaja inkremental + berbatas:
// hanya dokumen dalam `sinceDays` yang `items_synced_at`-nya masih NULL, maksimum
// `limit` per pemanggilan. Steady-state cuma dokumen baru (puluhan/hari);
// backfill awal habis bertahap tiap siklus tanpa memblokir job lain.
//
// Jalur field yang dibaca sama persis dengan getSalesOrderItems/
// getDeliveryOrderItems yang sudah dipakai dialog Orders/Shipments — jangan
// menambah field baru di sini tanpa memverifikasi payload aslinya.
async function syncDocItems(
  entity: "so" | "do",
  opts: { sinceDays?: number; limit?: number } = {},
): Promise<{ ok: boolean; docs: number; lines: number; pending: number; error?: string }> {
  const creds = loadCreds();
  if (!creds) return { ok: false, docs: 0, lines: 0, pending: 0, error: "kredensial Accurate tak tersedia" };
  const sinceDays = opts.sinceDays ?? 120;
  const limit = opts.limit ?? 150;
  const ids = await pendingItemDocs(entity, sinceDays, limit);
  const path = entity === "so" ? "/accurate/api/sales-order/detail.do" : "/accurate/api/delivery-order/detail.do";

  let docs = 0;
  let lines = 0;
  for (const id of ids) {
    const det = await accGet(creds, path, `id=${id}`);
    if (det?.s !== true) {
      // Dokumen bermasalah tak boleh menghentikan sisanya; biarkan
      // items_synced_at tetap NULL supaya dicoba lagi siklus berikutnya.
      await sleep(150);
      continue;
    }
    const d = det.d as Detail;
    const rows = ((d?.detailItem ?? []) as Detail[]).map((it, i) => ({
      line_no: it.lineNo != null ? Number(it.lineNo) : i + 1,
      item_no: it.item?.no ?? null,
      item_name: it.item?.name ?? it.detailName ?? null,
      qty: it.quantity != null ? Number(it.quantity) : null,
      unit: it.itemUnit?.name ?? it.itemUnitName ?? null,
      raw: it,
    }));
    lines += entity === "so" ? await replaceSalesOrderItems(id, rows) : await replaceDeliveryOrderItems(id, rows);
    docs += 1;
    await sleep(150);
  }
  const pending = await countPendingItemDocs(entity, sinceDays);
  return { ok: true, docs, lines, pending };
}

export const syncSalesOrderItems = (opts: { sinceDays?: number; limit?: number } = {}) => syncDocItems("so", opts);
export const syncDeliveryOrderItems = (opts: { sinceDays?: number; limit?: number } = {}) => syncDocItems("do", opts);

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

// Idem getDeliveryOrderItems, tapi utk sales-order (Orders) — sertakan ringkasan
// header (subtotal/diskon/PPN/total/DP/termin/salesman/PO) + diskon per-baris.
interface SoLine {
  no: string | null;
  name: string | null;
  quantity: number | null;
  unit: string | null;
  unit_price: number | null;
  disc_percent: string | null;
  disc_amount: number | null;
  total: number | null;
}
interface SoSummary {
  subtotal: number | null;
  discount: number | null;
  tax: number | null;
  total: number | null;
  down_payment: number | null;
  term: string | null;
  salesman: string | null;
  po_number: string | null;
  ship_date: string | null;
  note: string | null;
}
const numOrNull = (v: unknown): number | null => (v == null || v === "" ? null : Number(v) || 0);
const toIso = (v: unknown): string | null => {
  if (v == null) return null;
  const [dd, mm, yy] = String(v).split("/");
  return dd && mm && yy ? `${yy}-${mm}-${dd}` : null;
};
export async function getSalesOrderItems(
  id: number,
): Promise<{ ok: boolean; items: SoLine[]; summary?: SoSummary; error?: string }> {
  const creds = loadCreds();
  if (!creds) return { ok: false, items: [], error: "kredensial Accurate tak tersedia" };
  const det = await accGet(creds, "/accurate/api/sales-order/detail.do", `id=${id}`);
  if (det?.s !== true) return { ok: false, items: [], error: `detail gagal: ${JSON.stringify(det?.d).slice(0, 160)}` };
  const d = det.d as Detail;
  const lines = (d?.detailItem ?? []) as Detail[];
  const items: SoLine[] = lines.map((it) => {
    const dp = it.itemDiscPercent != null && String(it.itemDiscPercent).trim() !== "" && String(it.itemDiscPercent) !== "0" ? String(it.itemDiscPercent) : null;
    return {
      no: it.item?.no ?? null,
      name: it.item?.name ?? it.detailName ?? null,
      quantity: it.quantity != null ? Number(it.quantity) : null,
      unit: it.itemUnit?.name ?? it.itemUnitName ?? null,
      unit_price: numOrNull(it.unitPrice),
      disc_percent: dp,
      disc_amount: numOrNull(it.itemCashDiscount),
      total: numOrNull(it.totalPrice),
    };
  });
  const summary: SoSummary = {
    subtotal: numOrNull(d.subTotal),
    discount: numOrNull(d.cashDiscount),
    tax: numOrNull(d.tax1Amount),
    total: numOrNull(d.totalAmount),
    down_payment: numOrNull(d.totalDownPayment),
    term: d.paymentTerm?.name ?? null,
    salesman: lines.find((l) => l.salesmanName)?.salesmanName ?? d.salesmanName ?? null,
    po_number: d.poNumber != null && String(d.poNumber).trim() !== "" ? String(d.poNumber) : null,
    ship_date: toIso(d.shipDate),
    note: d.description != null && String(d.description).trim() !== "" ? String(d.description) : null,
  };
  return { ok: true, items, summary };
}

// Detail satu vendor (on-demand) utk rincian supplier — kontak/alamat/NPWP/notes.
export async function getVendorDetail(
  id: number,
): Promise<{ ok: boolean; vendor?: Record<string, string | null>; error?: string }> {
  const creds = loadCreds();
  if (!creds) return { ok: false, error: "kredensial Accurate tak tersedia" };
  const det = await accGet(creds, "/accurate/api/vendor/detail.do", `id=${id}`);
  if (det?.s !== true) return { ok: false, error: `detail gagal: ${JSON.stringify(det?.d).slice(0, 160)}` };
  const v = det.d as Detail;
  const s = (x: unknown): string | null => (x == null || String(x).trim() === "" ? null : String(x));
  const addr = [v.billStreet, v.billCity, v.billProvince].map(s).filter(Boolean).join(", ");
  return {
    ok: true,
    vendor: {
      name: s(v.name),
      no: s(v.vendorNo),
      branch: s(v.vendorBranchName),
      email: s(v.email),
      phone: s(v.mobilePhone) ?? s(v.phone),
      npwp: s(v.npwpNo),
      address: addr || null,
      notes: s(v.notes),
    },
  };
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
