import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";

import { db } from "../db.js";
import { ingestAccurateWebhook, normalizeAccurateDate, refreshAgingFromAccurate, type AccurateInvoice } from "./ar.js";
import {
  upsertVendors, upsertItems, upsertSalesOrders, upsertDeliveryOrders, upsertCustomers,
  replaceSalesOrderItems, replaceDeliveryOrderItems, pendingItemDocs, countPendingItemDocs,
  warehouseAccurateMap, ringkasStokPerGudang, replaceItemStockBranch,
  pendingStockItems, countPendingStockItems,
} from "./accurateMirror.js";
import { upsertFixedAssetDetail, pruneFixedAssets, recordFixedAssetSyncState, markFixedAssetSyncStarted } from "./asetTetap.js";
import {
  upsertAccuratePurchaseOrders, pendingAccuratePoDetails, countPendingAccuratePoDetails, replaceAccuratePoItems,
  type AccuratePoHeader, type AccuratePoItem,
} from "./purchase-order.js";
import {
  upsertAccurateReceipts, pendingAccurateReceiptDetails, countPendingAccurateReceiptDetails, replaceAccurateReceiptLines,
  type AccurateReceiptHeader, type AccurateReceiptLine,
} from "./inbound-receiving.js";
import {
  upsertAccurateInvoices, pendingInvoiceDetails, countPendingInvoiceDetails, replaceInvoiceLines, petakanBarisDetail, pruneInvoices, AP_SYNC_ENTITY,
  type AccurateInvoiceHeader,
} from "./ap-three-way.js";

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
  /** true = berhenti karena batas halaman, BUKAN karena window habis. Artinya
   *  hasilnya TERPOTONG — jangan diperlakukan sebagai sapuan lengkap (#1177). */
  cappedByPages?: boolean;
  /** Jumlah baris yang dilewati karena id-nya sudah ada di mirror
   *  (`skipExisting`). Dicetak supaya "processed kecil" tak salah dibaca
   *  sebagai "sync tak jalan". */
  skippedExisting?: number;
}

// Sync sales-invoice. invoiceId → satu invoice; selainnya incremental (window
// `days` hari, recent-first, stop saat transDate < threshold).
// Batas halaman pada syncer master (vendor/customer/item) ADA supaya loop tak
// pernah tak berujung kalau API mengembalikan halaman penuh selamanya. Tapi
// sampai #1177 batas itu BERHENTI DIAM-DIAM: `break` karena batas dan `break`
// karena halaman terakhir sama-sama keluar dari loop dan sama-sama membalas
// `ok: true`, jadi hasil terpotong menyamar jadi sapuan lengkap.
//
// Itu bukan hipotesis — persis begitu yang terjadi pada backfill faktur:
// berhenti di 10.000 dari 11.323 baris, responsnya tetap ok, dan runner-nya
// mencetak hijau. Katalog item sekarang 5.893 dari kapasitas 10.000 (59%),
// jadi jarak ke batas itu tidak besar.
//
// Helper ini menyeragamkan pelaporannya: kalau batas yang menghentikan, hasilnya
// ditandai `cappedByPages` DAN dicatat ke log. Yang memotong wajib terlihat.
export function laporBatasHalaman(nama: string, page: number, maxPages: number, perPage: number): boolean {
  if (page < maxPages) return false;
  console.warn(
    `[accurate-sync] ${nama}: BERHENTI di batas ${maxPages} halaman (${maxPages * perPage} baris) — ` +
    "hasil kemungkinan TERPOTONG, bukan selesai. Naikkan batasnya kalau data memang lebih banyak.",
  );
  return true;
}

// Tarik master vendor (vendor/list.do) → mirror accurate_vendor. Paginated (100/hal).
export async function syncVendors(): Promise<{ ok: boolean; synced: number; error?: string; cappedByPages?: boolean }> {
  const creds = loadCreds();
  if (!creds) return { ok: false, synced: 0, error: "kredensial Accurate tak tersedia" };
  let page = 1;
  let synced = 0;
  let capped = false;
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
    if (rows.length < 100) break;
    if (laporBatasHalaman("vendor", page, 50, 100)) { capped = true; break; }
    page += 1;
  }
  return { ok: true, synced, ...(capped ? { cappedByPages: true } : {}) };
}

// Tarik master customer (customer/list.do) → mirror accurate_customer (id/no/name).
// Backfill nama yg kosong (mirror cuma diisi dari raw invoice yg kadang tanpa nama).
// Paginated 100/hal. Guard upsert COALESCE(NULLIF(...)) → gak nge-blank nama yg udah ada.
export async function syncCustomers(): Promise<{ ok: boolean; synced: number; error?: string; cappedByPages?: boolean }> {
  const creds = loadCreds();
  if (!creds) return { ok: false, synced: 0, error: "kredensial Accurate tak tersedia" };
  let page = 1;
  let synced = 0;
  let capped = false;
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
    if (rows.length < 100) break;
    if (laporBatasHalaman("customer", page, 100, 100)) { capped = true; break; }
    page += 1;
    await new Promise((r) => setTimeout(r, 150));
  }
  return { ok: true, synced, ...(capped ? { cappedByPages: true } : {}) };
}

// Tarik full katalog item (item/list.do) + STOK → mirror accurate_item.
// Paginated (100/hal, ~58 hal utk 5.794 item). Untuk menu Inventory & Products.
export async function syncItems(): Promise<{ ok: boolean; synced: number; error?: string; cappedByPages?: boolean }> {
  const creds = loadCreds();
  if (!creds) return { ok: false, synced: 0, error: "kredensial Accurate tak tersedia" };
  let page = 1;
  let synced = 0;
  let capped = false;
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
    if (rows.length < 100) break;
    if (laporBatasHalaman("item", page, 100, 100)) { capped = true; break; }
    page += 1;
    await new Promise((r) => setTimeout(r, 150));
  }
  return { ok: true, synced, ...(capped ? { cappedByPages: true } : {}) };
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

export async function syncSalesOrders(opts: { maxPages?: number; sinceDays?: number } = {}): Promise<{ ok: boolean; synced: number; error?: string; cappedByPages?: boolean }> {
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
  let capped = false;
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
    // Loop berhenti krn batas halaman TANPA pernah menyentuh cutoff = hasil
    // terpotong, bukan "sudah mundur cukup jauh". Bedanya penting: yang kedua
    // memang tujuannya (recent-only by design), yang pertama kehilangan data
    // dalam jendela yang diminta.
    if (page >= maxPages && !cutoffReached) capped = laporBatasHalaman("sales-order", page, maxPages, 100);
    await sleep(150);
  }
  return { ok: true, synced, ...(capped ? { cappedByPages: true } : {}) };
}

// Tarik delivery-order TERBARU (delivery-order/list.do, sort transDate desc) →
// mirror accurate_delivery_order utk menu Shipments. Volume ~11.9rb → recent saja.
export async function syncDeliveryOrders(opts: { maxPages?: number; sinceDays?: number } = {}): Promise<{ ok: boolean; synced: number; error?: string; cappedByPages?: boolean }> {
  const creds = loadCreds();
  if (!creds) return { ok: false, synced: 0, error: "kredensial Accurate tak tersedia" };
  const maxPages = opts.maxPages ?? 40;
  const sinceDays = opts.sinceDays ?? 120;
  let page = 1;
  let synced = 0;
  let capped = false;
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
    // Loop berhenti krn batas halaman TANPA pernah menyentuh cutoff = hasil
    // terpotong, bukan "sudah mundur cukup jauh". Bedanya penting: yang kedua
    // memang tujuannya (recent-only by design), yang pertama kehilangan data
    // dalam jendela yang diminta.
    if (page >= maxPages && !cutoffReached) capped = laporBatasHalaman("delivery-order", page, maxPages, 100);
    await sleep(150);
  }
  return { ok: true, synced, ...(capped ? { cappedByPages: true } : {}) };
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

/**
 * F37 (#836) — tarik stok PER GUDANG ke `item_stock_branch`.
 *
 * Jalur yang dipakai `item/detail.do` per SKU, dan itu bukan pilihan: probe di
 * prod membuktikan `item/list.do` dengan field/filter gudang mengabaikannya
 * DIAM-DIAM (balas 200 s=true, kunci baris tetap {id,no,name,quantity}), dan
 * seluruh varian endpoint mutasi/opname membalas 404. Rinciannya di migrasi 166.
 *
 * Karena itu sapuan penuh = ±5.900 panggilan. HARIAN, bukan tiap 5 menit —
 * jangan dipasang di cron pendek. Tiap run BERBATAS (`limit`) dan melanjutkan
 * dari SKU yang paling lama tak tersegarkan (`accurate_item.stock_synced_at`),
 * jadi run yang mati di tengah tidak mengulang dari awal.
 *
 * Satu panggilan detail membawa SEMUA gudang untuk SKU itu sekaligus, jadi
 * ongkosnya jumlah-item, BUKAN jumlah-item × jumlah-gudang.
 */
export async function syncItemStockBranch(
  opts: { limit?: number; jedaMs?: number } = {},
): Promise<{ ok: boolean; items: number; rows: number; pending: number; skipped: number; error?: string }> {
  const creds = loadCreds();
  if (!creds) return { ok: false, items: 0, rows: 0, pending: 0, skipped: 0, error: "kredensial Accurate tak tersedia" };

  const map = await warehouseAccurateMap();
  if (map.length === 0) {
    // Bukan sekadar "tak ada kerjaan": tanpa allowlist, puller yang naif akan
    // menulis SEMUA gudang termasuk 96 milik customer. Berhenti keras supaya
    // penyebabnya (seed migrasi 166 belum jalan) terbaca, bukan diam-diam
    // menghasilkan nol baris yang terlihat seperti "stok memang kosong".
    return {
      ok: false, items: 0, rows: 0, pending: 0, skipped: 0,
      error: "warehouse_accurate kosong — migrasi 166 belum jalan?",
    };
  }
  const kodeDipetakan = [...new Set(map.map((m) => m.warehouse_kode))];

  const limit = opts.limit ?? 600;
  const jeda = opts.jedaMs ?? 150;
  const ids = await pendingStockItems(limit);

  let items = 0;
  let rows = 0;
  let skipped = 0;
  let gagalBeruntun = 0;
  let galatTerakhir = "";
  for (const id of ids) {
    // accGet MELEMPAR kalau Accurate membalas bukan-JSON (halaman HTML error/
    // maintenance), timeout 30 dtk, atau jaringan putus. Tanpa try/catch ini satu
    // balasan HTML menggagalkan SELURUH sapuan ("[api] unhandled SyntaxError:
    // Unexpected token '<'", terbukti di prod 12 Okt 2026) — padahal kontraknya
    // "SKU bermasalah dilewati". Ditangkap DI SINI, bukan di accGet: pemanggil lain
    // (loop daftar + prune aset tetap) justru harus berhenti keras, bukan membaca
    // kegagalan sebagai "halaman habis".
    let det: { s?: boolean; d?: unknown } | null = null;
    try {
      det = await accGet(creds, "/accurate/api/item/detail.do", `id=${id}`);
    } catch (e) {
      galatTerakhir = String(e instanceof Error ? e.message : e).slice(0, 160);
    }
    if (det?.s !== true) {
      // SKU bermasalah tak boleh menghentikan sisanya. stock_synced_at
      // SENGAJA tidak disentuh → SKU ini tetap di antrean depan dan dicoba
      // lagi siklus berikutnya.
      skipped += 1;
      gagalBeruntun += 1;
      if (det != null) galatTerakhir = `s!=true: ${JSON.stringify(det.d).slice(0, 140)}`;
      // Pemutus: kalau Accurate sedang down, ratusan SKU sisanya hanya akan
      // menumpuk panggilan gagal. Berhenti dan laporkan; antrean aman karena
      // tak satu pun SKU gagal ditandai tersinkron.
      if (gagalBeruntun >= GAGAL_BERUNTUN_MAKS) {
        const pending = await countPendingStockItems();
        return {
          ok: false, items, rows, pending, skipped,
          error: `dihentikan: ${gagalBeruntun} SKU gagal berturut-turut — terakhir: ${galatTerakhir}`,
        };
      }
      await sleep(jeda);
      continue;
    }
    gagalBeruntun = 0;
    const d = det.d as Detail;
    const entries = (d?.detailWarehouseData ?? []) as Detail[];
    rows += await replaceItemStockBranch(id, ringkasStokPerGudang(entries, map), kodeDipetakan);
    items += 1;
    await sleep(jeda);
  }

  const pending = await countPendingStockItems();
  return { ok: true, items, rows, pending, skipped };
}

// Batas kegagalan BERTURUT-TURUT sebelum sapuan stok per gudang menyerah. Satu-dua
// SKU gagal itu biasa (dilewati); 25 beruntun berarti Accurate-nya yang bermasalah.
const GAGAL_BERUNTUN_MAKS = 25;

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

// BACKFILL (#1177): mirror tak pernah punya riwayat pra-2026 karena fungsi ini
// selalu jalan sebagai rolling window (`days`, default 7) dan backfill
// sekali-jalan tak pernah dilakukan. 7.234 faktur 2024-12 s/d 2025 (Rp 93 M
// bruto) ada di Accurate, nol di mirror — angka 2026-nya sendiri valid, yang
// hilang adalah pembanding YoY, tren multi-tahun, dan piutang 2025 di ar_aging_mv.
//
// Cara menariknya (di mesin berkredensial prod, faktur tertua 31/12/2024):
//   curl -X POST -H "x-service-token: $TOK" localhost:4100/accurate/sync \
//     -H 'content-type: application/json' \
//     -d '{"days":700,"max_pages":300,"skip_existing":true}'
//
// Perkiraan: ~7.234 detail.do × jeda 150ms ≈ 30-40 menit. `skip_existing`
// melewati 4.058 baris yang sudah ada supaya tak ditarik dua kali.
export async function syncAccurateInvoices(
  opts: { days?: number; invoiceId?: number; maxPages?: number; skipExisting?: boolean } = {},
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
  let skippedExisting = 0;
  let page = 1;

  // Batas halaman: 200 × 50 = 10.000 baris. Cukup untuk window harian, TIDAK
  // cukup untuk backfill — Accurate menyimpan 11.302 faktur (226 halaman), jadi
  // sapuan penuh dengan batas lama memotong 1.302 baris. Lebih buruk lagi,
  // `break` karena batas halaman dulu tak bisa dibedakan dari `break` karena
  // window habis: dua-duanya mengembalikan ok:true (#1177).
  const maxPages = Math.max(1, opts.maxPages ?? 200);
  let cappedByPages = false;

  // Backfill menarik ulang ribuan faktur yang sudah ada di mirror; tiap baris =
  // satu detail.do + jeda 150ms. Melewati yang sudah ada memangkas sapuan penuh
  // dari 11.302 panggilan jadi ~7.234 (yang benar-benar hilang).
  // Sengaja opt-in: untuk sync harian, faktur yang sudah ada MEMANG harus
  // ditarik ulang — statusnya bisa berubah (OPEN → PAID, pembayaran parsial).
  let existingIds: Set<number> | null = null;
  if (opts.skipExisting) {
    const sql = db();
    const rows = await sql<{ id: string }[]>`SELECT id FROM accurate_invoice`;
    existingIds = new Set(rows.map((r) => Number(r.id)));
  }

  for (; page <= maxPages; page++) {
    // `sp.sort=transDate|desc` — early-break di bawah bergantung pada urutan
    // terbaru-dulu. Urutan default TIDAK dijamin API; saat diuji ia kebetulan
    // sudah desc, tapi bergantung pada kebetulan berarti suatu hari window
    // harian berhenti di baris pertama dan sync diam-diam berhenti bekerja.
    const list = await accGet(creds, "/accurate/api/sales-invoice/list.do", `sp.page=${page}&sp.pageSize=50&sp.sort=transDate|desc&fields=id,transDate`);
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
      if (existingIds?.has(Number(row.id))) {
        skippedExisting += 1;
        continue;
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
    // Halaman terakhir yang diizinkan tercapai TANPA pernah menyentuh
    // threshold → hasilnya terpotong, bukan selesai.
    if (page === maxPages) cappedByPages = true;
  }

  if (detailRecs.length > 0) {
    try {
      await ingestAccurateWebhook(detailRecs);
    } catch {
      /* aging refresh opsional */
    }
  }
  await recordState(processed, days, true);
  if (cappedByPages) {
    console.warn(
      `[accurate-sync] TERPOTONG di batas ${maxPages} halaman (${maxPages * 50} baris) ` +
      `sebelum mencapai window ${days} hari — hasil TIDAK lengkap. Naikkan maxPages.`,
    );
  }
  return {
    ok: true,
    mode: "incremental",
    processed,
    days,
    pages: page,
    ...(cappedByPages ? { cappedByPages: true } : {}),
    ...(existingIds ? { skippedExisting } : {}),
  };
}

// Penyegaran faktur OPEN (#1840). syncAccurateInvoices harian cuma menarik faktur
// bertanggal 7 hari terakhir, jadi faktur yang lebih tua tak pernah dicek ulang:
// pelunasan sesudahnya tak tercatat (status OPEN, outstanding, lunas_at basi). Prod
// 21 Okt: 1.255 faktur OPEN (Rp 13,42 M) terakhir disinkron > 30 hari lalu.
// Sapuan ini menarik ulang detail SEMUA faktur OPEN yang belum disegarkan dalam
// `staleHours` jam — yang terlama dulu, dibatasi `maxCalls` per jalan.
// Catatan F67: lunas_at = saat sapuan MENGAMATI OPEN → PAID, bukan tanggal bayar.
//
// Faktur yang sudah DIHAPUS di Accurate (detail.do: "Faktur Penjualan tidak tepat") —
// biasanya dihapus lalu diinput ulang dengan id baru — dipindah ke accurate_invoice_hilang
// (migrasi 243) lalu dihapus dari mirror. Tanpa ini id lama tetap OPEN selamanya dan
// faktur terhitung dua kali di piutang & pendapatan. Pengaman: sebelum menghapus apa pun,
// satu faktur kontrol (yang paling baru disinkron) harus terbaca — kalau tidak, sesi/
// kredensial yang bermasalah, bukan fakturnya; dan maksimum `maxHilang` per jalan.
let openRefreshRunning = false;
export const openRefreshBusy = () => openRefreshRunning;

export interface OpenRefreshResult {
  ok: boolean;
  candidates?: number;
  refreshed?: number;
  nowPaid?: number;
  hilang?: number;
  hilangKembaran?: number;
  nilaiHilang?: number;
  failed?: number;
  firstError?: string;
  remaining?: number;
  error?: string;
}

/** Pesan detail.do yang berarti faktur sudah tak ada di Accurate, atau null. Sengaja sempit:
 *  galat lain (sesi, batas laju, jaringan) TIDAK boleh berujung penghapusan. */
export function pesanFakturHilang(d: unknown): string | null {
  const arr = Array.isArray(d) ? d : [d];
  const teks = arr.filter((x): x is string => typeof x === "string");
  return teks.some((t) => /faktur penjualan tidak tepat/i.test(t)) ? teks.join("; ") : null;
}

export async function arsipkanFakturHilang(id: string, pesan: string): Promise<{ outstanding: number; kembaran: boolean } | null> {
  const sql = db();
  return (await sql.begin(async (tx) => {
    const [inv] = await tx`
      WITH inv AS (DELETE FROM accurate_invoice WHERE id = ${id}::bigint RETURNING *),
           it  AS (DELETE FROM accurate_invoice_item WHERE invoice_id = ${id}::bigint RETURNING *)
      INSERT INTO accurate_invoice_hilang
        (id, number, customer_id, tanggal, total, outstanding, status, ada_kembaran, pesan_accurate, baris, items)
      SELECT inv.id, inv.number, inv.customer_id, inv.tanggal, inv.total, inv.outstanding, inv.status,
             EXISTS (SELECT 1 FROM accurate_invoice b WHERE b.number = inv.number AND b.id <> inv.id),
             ${pesan}, to_jsonb(inv), COALESCE((SELECT jsonb_agg(to_jsonb(it)) FROM it), '[]'::jsonb)
        FROM inv
      ON CONFLICT (id) DO NOTHING
      RETURNING number, customer_id, outstanding, ada_kembaran`;
    if (!inv) return null;
    // Baris aging ber-kunci nomor+customer: dibuang hanya bila tak ada lagi faktur bernomor sama.
    if (!inv.ada_kembaran) {
      await tx`
        DELETE FROM ar_aging_base
         WHERE invoice_no = ${inv.number} AND customer_id = ${String(inv.customer_id)}
           AND NOT EXISTS (SELECT 1 FROM accurate_invoice WHERE number = ${inv.number})`;
    }
    return { outstanding: Number(inv.outstanding ?? 0), kembaran: inv.ada_kembaran === true };
  })) as { outstanding: number; kembaran: boolean } | null;
}

export async function refreshOpenInvoices(
  opts: { staleHours?: number; maxCalls?: number; maxHilang?: number } = {},
): Promise<OpenRefreshResult> {
  if (openRefreshRunning) return { ok: false, error: "penyegaran faktur OPEN sedang berjalan" };
  const creds = loadCreds();
  if (!creds) return { ok: false, error: "kredensial Accurate tak tersedia" };
  openRefreshRunning = true;
  try {
    const sql = db();
    const staleHours = Math.max(1, opts.staleHours ?? 20);
    const maxCalls = Math.max(1, opts.maxCalls ?? 3000);
    const maxHilang = Math.max(0, opts.maxHilang ?? 500);

    // Kontrol: faktur yang paling baru disinkron PASTI ada di Accurate.
    const [kontrol] = await sql<{ id: string }[]>`SELECT id::text FROM accurate_invoice ORDER BY last_synced_at DESC NULLS LAST LIMIT 1`;
    if (kontrol) {
      const k = await accGet(creds, "/accurate/api/sales-invoice/detail.do", `id=${kontrol.id}`);
      if (k?.s !== true) return { ok: false, error: `faktur kontrol ${kontrol.id} tak terbaca — sapuan dibatalkan: ${JSON.stringify(k?.d).slice(0, 160)}` };
    }

    const rows = await sql<{ id: string }[]>`
      SELECT id::text FROM accurate_invoice
       WHERE status = 'OPEN' AND last_synced_at < now() - make_interval(hours => ${staleHours})
       ORDER BY last_synced_at ASC LIMIT ${maxCalls}`;
    let refreshed = 0;
    let nowPaid = 0;
    let hilang = 0;
    let hilangKembaran = 0;
    let nilaiHilang = 0;
    let failed = 0;
    let firstError: string | undefined;
    let batch: AccurateInvoice[] = [];
    for (const r of rows) {
      try {
        const det = await accGet(creds, "/accurate/api/sales-invoice/detail.do", `id=${r.id}`);
        if (det?.s === true) {
          if (await upsertInvoiceDetail(det.d as Detail)) {
            refreshed += 1;
            if (!(det.d as Detail).outstanding) nowPaid += 1;
            batch.push(det.d as AccurateInvoice);
            if (batch.length >= 200) {
              await refreshAgingFromAccurate(batch);
              batch = [];
            }
          }
        } else {
          const pesan = pesanFakturHilang(det?.d);
          const a = pesan && hilang < maxHilang ? await arsipkanFakturHilang(r.id, pesan) : null;
          if (a) {
            hilang += 1;
            nilaiHilang += a.outstanding;
            if (a.kembaran) hilangKembaran += 1;
          } else {
            failed += 1;
            firstError ??= `${r.id}: ${JSON.stringify(det?.d).slice(0, 160)}`;
          }
        }
      } catch (e) {
        failed += 1;
        firstError ??= `${r.id}: ${e instanceof Error ? e.message : String(e)}`.slice(0, 200);
      }
      await sleep(150);
    }
    if (batch.length > 0) await refreshAgingFromAccurate(batch);
    const [sisa] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM accurate_invoice
       WHERE status = 'OPEN' AND last_synced_at < now() - make_interval(hours => ${staleHours})`;
    const res: OpenRefreshResult = {
      ok: true, candidates: rows.length, refreshed, nowPaid, hilang, hilangKembaran, nilaiHilang, failed,
      ...(firstError ? { firstError } : {}), remaining: Number(sisa?.n ?? 0),
    };
    await sql`
      INSERT INTO accurate_sync_state (entity, last_synced_at, last_run_ok, last_run_summary)
      VALUES ('sales-invoice-open', now(), ${failed === 0},
              ${sql.json(res as unknown as Parameters<typeof sql.json>[0])})
      ON CONFLICT (entity) DO UPDATE SET last_synced_at = now(), last_run_ok = EXCLUDED.last_run_ok,
        last_run_summary = EXCLUDED.last_run_summary`;
    return res;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  } finally {
    openRefreshRunning = false;
  }
}

// F34 — cermin aset tetap (fixed-asset). Bentuk data dari probe prod
// (scripts/qa/probe-accurate-aset-tetap.mjs): list.do cuma bisa membawa 10
// field dan TIDAK bookValue/faType/metode/umur → wajib detail.do per aset.
// Prod 12 Okt: 1.394 aset, ≈0,26 dtk/detail + jeda 150ms ≈ 10 menit. Cukup
// untuk job harian; tak ada jalur inkremental yang terbukti (filter.lastUpdate
// belum diuji), jadi tiap jalan = sapuan penuh.
//
// Prune (hapus cermin yang tak ada lagi di Accurate) HANYA jika daftar id
// lengkap: tak kena batas halaman DAN jumlah terkumpul = sp.rowCount. Daftar
// parsial yang mem-prune akan menghapus aset yang sah tanpa suara.
export interface FixedAssetSyncResult {
  ok: boolean;
  listed?: number;
  rowCount?: number | null;
  synced?: number;
  failed?: number;
  pruned?: number;
  cappedByPages?: boolean;
  error?: string;
}

// Satu sapuan pada satu waktu: job harian dan tombol manual bisa bertabrakan,
// dan dua sapuan paralel = 2× beban ke Accurate untuk hasil yang sama.
let fixedAssetSyncRunning = false;
export const fixedAssetSyncBusy = () => fixedAssetSyncRunning;

export async function syncFixedAssets(opts: { maxPages?: number } = {}): Promise<FixedAssetSyncResult> {
  if (fixedAssetSyncRunning) return { ok: false, error: "sinkron aset tetap sedang berjalan" };
  fixedAssetSyncRunning = true;
  try {
    await markFixedAssetSyncStarted();
    return await syncFixedAssetsInner(opts);
  } finally {
    fixedAssetSyncRunning = false;
  }
}

async function syncFixedAssetsInner(opts: { maxPages?: number }): Promise<FixedAssetSyncResult> {
  const creds = loadCreds();
  if (!creds) return { ok: false, error: "kredensial Accurate tak tersedia" };
  const maxPages = opts.maxPages ?? 50;
  const perPage = 100;
  const ids: number[] = [];
  let rowCount: number | null = null;
  let capped = false;
  try {
    for (let page = 1; ; page++) {
      const list = (await accGet(creds, "/accurate/api/fixed-asset/list.do", `sp.page=${page}&sp.pageSize=${perPage}&fields=id`)) as {
        s?: boolean; d?: unknown; sp?: { rowCount?: unknown };
      };
      if (list?.s !== true) {
        const res = { ok: false, error: `list gagal hal ${page}: ${JSON.stringify(list?.d).slice(0, 160)}` };
        await recordFixedAssetSyncState(false, res);
        return res;
      }
      const rc = Number(list.sp?.rowCount);
      if (Number.isFinite(rc)) rowCount = rc;
      const rows = Array.isArray(list.d) ? (list.d as Array<{ id?: unknown }>) : [];
      for (const r of rows) {
        const id = Number(r.id);
        if (id > 0) ids.push(id);
      }
      if (rows.length < perPage || (rowCount != null && ids.length >= rowCount)) break;
      if (laporBatasHalaman("fixed-asset", page, maxPages, perPage)) { capped = true; break; }
      await sleep(150);
    }
  } catch (e) {
    const res = { ok: false, error: `list error: ${String((e as Error)?.message ?? e).slice(0, 160)}` };
    await recordFixedAssetSyncState(false, res);
    return res;
  }

  let synced = 0;
  let failed = 0;
  for (const id of ids) {
    try {
      const det = await accGet(creds, "/accurate/api/fixed-asset/detail.do", `id=${id}`);
      if (det?.s === true && (await upsertFixedAssetDetail(det.d))) synced += 1;
      else failed += 1;
    } catch {
      failed += 1; // satu aset gagal tak menggagalkan sapuan; dihitung & dilaporkan
    }
    await sleep(150);
  }

  const lengkap = !capped && rowCount != null && ids.length === rowCount;
  const pruned = lengkap ? await pruneFixedAssets(ids) : 0;
  if (!lengkap) {
    console.warn(`[accurate-sync] fixed-asset: daftar id TAK lengkap (${ids.length}/${rowCount ?? "?"}${capped ? ", kena batas halaman" : ""}) — prune dilewati`);
  }
  // ok=false kalau ada yang gagal: sebagian cermin basi harus terlihat, bukan hijau.
  const res: FixedAssetSyncResult = {
    ok: failed === 0 && lengkap, listed: ids.length, rowCount, synced, failed, pruned,
    ...(capped ? { cappedByPages: true } : {}),
  };
  await recordFixedAssetSyncState(res.ok, { ...res });
  return res;
}

// ── F13 PO Tracker = cermin Accurate (migrasi 205) ─────────────────────────
//
// Probe 12 Okt 2026: purchase-order/list.do MENGHORMATI fields= (number,
// vendor, transDate, shipDate, status, statusName, approvalStatus,
// percentShipped, totalAmount, lastUpdate) dan bisa di-sort lastUpdate desc —
// jadi sinkron header INKREMENTAL: berhenti begitu satu halaman seluruhnya
// lebih tua dari lastUpdate terbaru yang sudah tersimpan. Baris barang
// (detail.do, satu panggilan per PO) hanya ditarik untuk PO yang lastUpdate-nya
// berubah sejak tarikan detail terakhir.
//
// Cakupan (keputusan user 12 Okt): PO bertanggal 2026+ DITAMBAH PO lebih tua
// yang masih terbuka (Menunggu/Sebagian diproses — 91 PO 2025 saat probe;
// justru itu yang perlu dipantau), DITAMBAH PO yang sudah ada di cermin (supaya
// PO 2025 yang lalu ditutup ikut ter-update, bukan beku di status lama).
//
// shipDate TIDAK otomatis jadi ETA: 2.599/2.683 PO punya shipDate = transDate
// (nilai bawaan form Accurate). Dipakai sebagai eta_date hanya kalau diisi
// lebih lambat dari tanggal PO — kalau tidak, kartu "Telat" menggelembung.

const PO_SINCE = "2026-01-01";
const PO_OPEN_STATUSES = new Set(["Menunggu diproses", "Sebagian diproses"]);

/** "dd/mm/yyyy" → "yyyy-mm-dd" (null kalau bentuknya lain). */
function accDate(v: unknown): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(String(v ?? ""));
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

/** "dd/mm/yyyy HH:MM:SS" (WIB) → ISO dengan offset +07:00. */
function accDateTime(v: unknown): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2}):(\d{2})$/.exec(String(v ?? ""));
  return m ? `${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}:${m[6]}+07:00` : null;
}

export interface PurchaseOrderSyncResult {
  ok: boolean;
  error?: string;
  headers: number;
  skipped_scope: number;
  skipped_conflict: number;
  details: number;
  detail_failed: number;
  lines: number;
  pending_details: number;
  full: boolean;
  cappedByPages?: boolean;
}

let poSyncRunning = false;
export const purchaseOrderSyncBusy = () => poSyncRunning;

export async function syncPurchaseOrders(opts: { full?: boolean; detailLimit?: number; maxPages?: number } = {}): Promise<PurchaseOrderSyncResult> {
  const empty = { headers: 0, skipped_scope: 0, skipped_conflict: 0, details: 0, detail_failed: 0, lines: 0, pending_details: 0, full: !!opts.full };
  if (poSyncRunning) return { ok: false, error: "sinkron PO sedang berjalan", ...empty };
  const creds = loadCreds();
  if (!creds) return { ok: false, error: "kredensial Accurate tak tersedia", ...empty };
  poSyncRunning = true;
  try {
    const res = await syncPurchaseOrdersInner(creds, opts);
    await recordPoSyncState(res);
    return res;
  } catch (e) {
    const res = { ok: false, error: String((e as Error)?.message ?? e), ...empty };
    await recordPoSyncState(res).catch(() => {});
    return res;
  } finally {
    poSyncRunning = false;
  }
}

async function recordPoSyncState(res: PurchaseOrderSyncResult): Promise<void> {
  const sql = db();
  const summary = JSON.parse(JSON.stringify(res));
  await sql`
    INSERT INTO accurate_sync_state (entity, last_synced_at, last_run_ok, last_run_summary)
    VALUES ('purchase-order', now(), ${res.ok}, ${sql.json(summary)})
    ON CONFLICT (entity) DO UPDATE SET last_synced_at = now(), last_run_ok = ${res.ok},
      last_run_summary = ${sql.json(summary)}
  `;
}

async function syncPurchaseOrdersInner(
  creds: Creds,
  opts: { full?: boolean; detailLimit?: number; maxPages?: number },
): Promise<PurchaseOrderSyncResult> {
  const sql = db();
  const maxPages = opts.maxPages ?? 60;
  const detailLimit = opts.detailLimit ?? 300;
  const [wm] = await sql`SELECT max(accurate_last_update)::text AS w FROM purchase_order WHERE source = 'accurate'`;
  // Watermark mundur 1 jam: lastUpdate Accurate per detik, dua PO bisa
  // berbagi detik yang sama di batas halaman. Upsert idempoten, jadi tumpang
  // tindih kecil lebih murah daripada satu PO terlewat.
  const full = opts.full || !wm?.w;
  const watermark = full ? null : new Date(new Date(String(wm.w)).getTime() - 3600_000);

  let headers = 0;
  let skippedScope = 0;
  let skippedConflict = 0;
  let capped = false;
  let page = 1;
  for (; page <= maxPages; page++) {
    const list = await accGet(
      creds,
      "/accurate/api/purchase-order/list.do",
      `sp.page=${page}&sp.pageSize=100&sp.sort=lastUpdate|desc&fields=id,number,transDate,shipDate,status,statusName,approvalStatus,percentShipped,totalAmount,vendor,description,lastUpdate`,
    );
    if (list.s !== true) throw new Error(`purchase-order/list.do gagal di halaman ${page}`);
    const rows = Array.isArray(list.d) ? (list.d as Array<Record<string, unknown>>) : [];
    if (rows.length === 0) break;

    const ids = rows.map((r) => Number(r.id));
    const existing = new Set(
      (await sql`SELECT accurate_id FROM purchase_order WHERE accurate_id = ANY(${ids}::bigint[])`).map((r) => Number(r.accurate_id)),
    );
    const mapped: AccuratePoHeader[] = [];
    let allOlder = true;
    for (const v of rows) {
      const lastUpdate = accDateTime(v.lastUpdate);
      if (!watermark || !lastUpdate || new Date(lastUpdate) >= watermark) allOlder = false;
      const orderDate = accDate(v.transDate);
      const statusName = v.statusName != null ? String(v.statusName) : null;
      const inScope =
        existing.has(Number(v.id)) ||
        (orderDate != null && orderDate >= PO_SINCE) ||
        (statusName != null && PO_OPEN_STATUSES.has(statusName));
      if (!orderDate || !inScope) { skippedScope++; continue; }
      const shipDate = accDate(v.shipDate);
      const vendor = v.vendor && typeof v.vendor === "object" ? (v.vendor as { id?: unknown; name?: unknown }) : null;
      const vendorId = Number(vendor?.id);
      mapped.push({
        accurate_id: Number(v.id),
        po_number: String(v.number ?? `ACC-${v.id}`),
        vendor_id: Number.isFinite(vendorId) && vendorId > 0 ? vendorId : null,
        vendor_name: vendor?.name != null ? String(vendor.name) : "(vendor tak diketahui)",
        order_date: orderDate,
        eta_date: shipDate && shipDate > orderDate ? shipDate : null,
        accurate_status: statusName,
        accurate_approval: v.approvalStatus != null ? String(v.approvalStatus) : null,
        percent_shipped: v.percentShipped != null ? Number(v.percentShipped) : null,
        total_amount: v.totalAmount != null ? Number(v.totalAmount) : null,
        description: v.description != null && String(v.description).trim() ? String(v.description) : null,
        last_update: lastUpdate,
      });
    }
    const up = await upsertAccuratePurchaseOrders(mapped);
    headers += up.upserted;
    skippedConflict += up.skipped;
    if (rows.length < 100) break;
    if (!full && allOlder) break;
    if (page >= maxPages) capped = laporBatasHalaman("purchase-order", page, maxPages, 100);
    await sleep(150);
  }

  let details = 0;
  let detailFailed = 0;
  let lines = 0;
  for (const po of await pendingAccuratePoDetails(detailLimit)) {
    const det = await accGet(creds, "/accurate/api/purchase-order/detail.do", `id=${po.accurate_id}`);
    if (det?.s !== true) {
      // PO bermasalah (mis. dihapus di Accurate) tak boleh menghentikan sisanya;
      // items_last_update tetap basi → dicoba lagi siklus berikutnya.
      detailFailed++;
      await sleep(150);
      continue;
    }
    const d = det.d as Detail;
    const items: AccuratePoItem[] = ((d?.detailItem ?? []) as Detail[])
      .filter((it) => Number(it.quantity) > 0 && it.id != null)
      .map((it) => ({
        accurate_detail_id: Number(it.id),
        item_no: it.item?.no != null ? String(it.item.no) : null,
        item_desc: String(it.detailName ?? it.item?.name ?? "(tanpa nama)"),
        qty_ordered: Number(it.quantity),
        qty_shipped: num(it.shipQuantity),
        unit: it.itemUnit?.name != null ? String(it.itemUnit.name) : null,
        unit_price: it.unitPrice != null ? Number(it.unitPrice) : null,
        disc_raw: it.itemDiscPercent != null ? String(it.itemDiscPercent).trim() : null,
        warehouse_name: it.warehouse?.name != null ? String(it.warehouse.name) : null,
        notes: it.detailNotes != null && String(it.detailNotes).trim() ? String(it.detailNotes) : null,
      }));
    lines += await replaceAccuratePoItems(po.id, po.last_update, items);
    details++;
    await sleep(150);
  }

  return {
    ok: true,
    headers,
    skipped_scope: skippedScope,
    skipped_conflict: skippedConflict,
    details,
    detail_failed: detailFailed,
    lines,
    pending_details: await countPendingAccuratePoDetails(),
    full,
    ...(capped ? { cappedByPages: true } : {}),
  };
}

// ── F36 Inbound = Penerimaan Barang Accurate (migrasi 206) ─────────────────
//
// Probe 12 Okt 2026: receive-item/list.do menghormati fields (number =
// nomor INBOUND, receiveNumber = surat jalan vendor, transDate, shipDate,
// statusName Diajukan/Diterima/Difaktur, approvalStatus, vendor, lastUpdate)
// dan sort lastUpdate — pola inkremental yang sama dengan syncPurchaseOrders.
// detail.do membawa baris barang + nomor & id PO + gudang + catatan LOT/ED.
//
// Cakupan: penerimaan bertanggal >= INBOUND_ACCURATE_SINCE (default
// 2026-10-01) + yang sudah ada di cermin. Penerimaan lebih tua sudah lama
// diperiksa fisik; membuatkan checklist untuknya hanya menimbun "Proses".

export interface ReceiveItemSyncResult {
  ok: boolean;
  error?: string;
  headers: number;
  created: number;
  skipped_scope: number;
  details: number;
  detail_failed: number;
  lines: number;
  pending_details: number;
  full: boolean;
  since: string;
  cappedByPages?: boolean;
}

let receiveSyncRunning = false;
export const receiveItemSyncBusy = () => receiveSyncRunning;

function inboundSince(): string {
  const v = process.env.INBOUND_ACCURATE_SINCE ?? "";
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : "2026-10-01";
}

export async function syncReceiveItems(opts: { full?: boolean; detailLimit?: number; maxPages?: number } = {}): Promise<ReceiveItemSyncResult> {
  const since = inboundSince();
  const empty = { headers: 0, created: 0, skipped_scope: 0, details: 0, detail_failed: 0, lines: 0, pending_details: 0, full: !!opts.full, since };
  if (receiveSyncRunning) return { ok: false, error: "sinkron penerimaan barang sedang berjalan", ...empty };
  const creds = loadCreds();
  if (!creds) return { ok: false, error: "kredensial Accurate tak tersedia", ...empty };
  receiveSyncRunning = true;
  try {
    const res = await syncReceiveItemsInner(creds, since, opts);
    await recordReceiveSyncState(res);
    return res;
  } catch (e) {
    const res = { ok: false, error: String((e as Error)?.message ?? e), ...empty };
    await recordReceiveSyncState(res).catch(() => {});
    return res;
  } finally {
    receiveSyncRunning = false;
  }
}

async function recordReceiveSyncState(res: ReceiveItemSyncResult): Promise<void> {
  const sql = db();
  const summary = JSON.parse(JSON.stringify(res));
  await sql`
    INSERT INTO accurate_sync_state (entity, last_synced_at, last_run_ok, last_run_summary)
    VALUES ('receive-item', now(), ${res.ok}, ${sql.json(summary)})
    ON CONFLICT (entity) DO UPDATE SET last_synced_at = now(), last_run_ok = ${res.ok},
      last_run_summary = ${sql.json(summary)}
  `;
}

async function syncReceiveItemsInner(
  creds: Creds,
  since: string,
  opts: { full?: boolean; detailLimit?: number; maxPages?: number },
): Promise<ReceiveItemSyncResult> {
  const sql = db();
  const maxPages = opts.maxPages ?? 60;
  const detailLimit = opts.detailLimit ?? 300;
  const [wm] = await sql`SELECT max(accurate_last_update)::text AS w FROM inbound_receiving WHERE source = 'accurate'`;
  const full = opts.full || !wm?.w;
  const watermark = full ? null : new Date(new Date(String(wm.w)).getTime() - 3600_000);

  let headers = 0;
  let created = 0;
  let skippedScope = 0;
  let capped = false;
  for (let page = 1; page <= maxPages; page++) {
    const list = await accGet(
      creds,
      "/accurate/api/receive-item/list.do",
      `sp.page=${page}&sp.pageSize=100&sp.sort=lastUpdate|desc&fields=id,number,receiveNumber,transDate,shipDate,statusName,approvalStatus,vendor,description,lastUpdate`,
    );
    if (list.s !== true) throw new Error(`receive-item/list.do gagal di halaman ${page}`);
    const rows = Array.isArray(list.d) ? (list.d as Array<Record<string, unknown>>) : [];
    if (rows.length === 0) break;

    const ids = rows.map((r) => Number(r.id));
    const existing = new Set(
      (await sql`SELECT accurate_id FROM inbound_receiving WHERE accurate_id = ANY(${ids}::bigint[])`).map((r) => Number(r.accurate_id)),
    );
    const mapped: AccurateReceiptHeader[] = [];
    let allOlder = true;
    for (const v of rows) {
      const lastUpdate = accDateTime(v.lastUpdate);
      if (!watermark || !lastUpdate || new Date(lastUpdate) >= watermark) allOlder = false;
      const recvDate = accDate(v.transDate);
      if (!recvDate || !(existing.has(Number(v.id)) || recvDate >= since)) { skippedScope++; continue; }
      const vendor = v.vendor && typeof v.vendor === "object" ? (v.vendor as { id?: unknown; name?: unknown }) : null;
      const vendorId = Number(vendor?.id);
      mapped.push({
        accurate_id: Number(v.id),
        accurate_number: String(v.number ?? `RI-${v.id}`),
        supplier_doc_number: v.receiveNumber != null && String(v.receiveNumber).trim() ? String(v.receiveNumber) : null,
        vendor_id: Number.isFinite(vendorId) && vendorId > 0 ? vendorId : null,
        vendor_name: vendor?.name != null ? String(vendor.name) : "(vendor tak diketahui)",
        received_date: recvDate,
        ship_date: accDate(v.shipDate),
        accurate_status: v.statusName != null ? String(v.statusName) : null,
        accurate_approval: v.approvalStatus != null ? String(v.approvalStatus) : null,
        description: v.description != null && String(v.description).trim() ? String(v.description) : null,
        last_update: lastUpdate,
      });
    }
    const up = await upsertAccurateReceipts(mapped);
    headers += up.upserted;
    created += up.created;
    if (rows.length < 100) break;
    if (!full && allOlder) break;
    if (page >= maxPages) capped = laporBatasHalaman("receive-item", page, maxPages, 100);
    await sleep(150);
  }

  let details = 0;
  let detailFailed = 0;
  let lines = 0;
  for (const rc of await pendingAccurateReceiptDetails(detailLimit)) {
    const det = await accGet(creds, "/accurate/api/receive-item/detail.do", `id=${rc.accurate_id}`);
    if (det?.s !== true) {
      detailFailed++;
      await sleep(150);
      continue;
    }
    const d = det.d as Detail;
    const items: AccurateReceiptLine[] = ((d?.detailItem ?? []) as Detail[])
      .filter((it) => it.id != null)
      .map((it) => {
        const poId = Number(it.purchaseOrderId ?? it.purchaseOrder?.id);
        return {
          accurate_detail_id: Number(it.id),
          item_no: it.item?.no != null ? String(it.item.no) : null,
          item_desc: String(it.detailName ?? it.item?.name ?? "(tanpa nama)"),
          qty: num(it.quantity),
          unit: it.itemUnit?.name != null ? String(it.itemUnit.name) : null,
          warehouse_name: it.warehouse?.name != null ? String(it.warehouse.name) : null,
          po_number: it.purchaseOrder?.number != null ? String(it.purchaseOrder.number) : null,
          accurate_po_id: Number.isFinite(poId) && poId > 0 ? poId : null,
          notes: it.detailNotes != null && String(it.detailNotes).trim() ? String(it.detailNotes) : null,
        };
      });
    lines += await replaceAccurateReceiptLines(rc.id, rc.last_update, items);
    details++;
    await sleep(150);
  }

  return {
    ok: true,
    headers,
    created,
    skipped_scope: skippedScope,
    details,
    detail_failed: detailFailed,
    lines,
    pending_details: await countPendingAccurateReceiptDetails(),
    full,
    since,
    ...(capped ? { cappedByPages: true } : {}),
  };
}

// ── F152 Faktur Pembelian Accurate → cermin 3-way match (migrasi 240) ──────
//
// Probe 19 Okt 2026: purchase-invoice/list.do menghormati fields= (id, number, billNumber, transDate,
// dueDate, lastUpdate, statusName, approvalStatus, totalAmount, vendor, description) dan sort
// lastUpdate|desc — pola inkremental sama dengan syncPurchaseOrders/syncReceiveItems.
// detail.do membawa id PO & penerimaan sampai tingkat BARIS (purchaseOrderDetailId, receiveItemDetailId).
//
// Cakupan: faktur bertanggal >= AP_ACCURATE_SINCE (default = INBOUND_ACCURATE_SINCE, 2026-10-01) + yang sudah
// ada di cermin. Disamakan dengan cakupan penerimaan: faktur atas penerimaan yang tak tercermin hanya
// akan jadi "belum sinkron".

export interface PurchaseInvoiceSyncResult {
  ok: boolean;
  error?: string;
  headers: number;
  skipped_scope: number;
  details: number;
  detail_failed: number;
  lines: number;
  pending_details: number;
  full: boolean;
  since: string;
  pruned?: number;
  prune_skipped?: boolean;
  cappedByPages?: boolean;
}

let invoiceSyncRunning = false;
export const purchaseInvoiceSyncBusy = () => invoiceSyncRunning;

function invoiceSince(): string {
  const v = process.env.AP_ACCURATE_SINCE ?? "";
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : inboundSince();
}

export async function syncPurchaseInvoices(opts: { full?: boolean; detailLimit?: number; maxPages?: number } = {}): Promise<PurchaseInvoiceSyncResult> {
  const since = invoiceSince();
  const empty = { headers: 0, skipped_scope: 0, details: 0, detail_failed: 0, lines: 0, pending_details: 0, full: !!opts.full, since };
  if (invoiceSyncRunning) return { ok: false, error: "sinkron faktur pembelian sedang berjalan", ...empty };
  const creds = loadCreds();
  if (!creds) return { ok: false, error: "kredensial Accurate tak tersedia", ...empty };
  invoiceSyncRunning = true;
  try {
    const res = await syncPurchaseInvoicesInner(creds, since, opts);
    await recordInvoiceSyncState(res);
    return res;
  } catch (e) {
    const res = { ok: false, error: String((e as Error)?.message ?? e), ...empty };
    await recordInvoiceSyncState(res).catch(() => {});
    return res;
  } finally {
    invoiceSyncRunning = false;
  }
}

async function recordInvoiceSyncState(res: PurchaseInvoiceSyncResult): Promise<void> {
  const sql = db();
  const summary = JSON.parse(JSON.stringify(res));
  await sql`
    INSERT INTO accurate_sync_state (entity, last_synced_at, last_run_ok, last_run_summary)
    VALUES (${AP_SYNC_ENTITY}, now(), ${res.ok}, ${sql.json(summary)})
    ON CONFLICT (entity) DO UPDATE SET last_synced_at = now(), last_run_ok = ${res.ok},
      last_run_summary = ${sql.json(summary)}
  `;
}

const textOrNull = (v: unknown): string | null => (v != null && String(v).trim() ? String(v) : null);
const idOrNull = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

async function syncPurchaseInvoicesInner(
  creds: Creds,
  since: string,
  opts: { full?: boolean; detailLimit?: number; maxPages?: number },
): Promise<PurchaseInvoiceSyncResult> {
  const sql = db();
  const maxPages = opts.maxPages ?? 60;
  const detailLimit = opts.detailLimit ?? 300;
  const [wm] = await sql`SELECT max(accurate_last_update)::text AS w FROM accurate_purchase_invoice`;
  const full = opts.full || !wm?.w;
  // Mundur 1 jam: lastUpdate per detik, dua faktur bisa berbagi detik di batas halaman (upsert idempoten).
  const watermark = full ? null : new Date(new Date(String(wm.w)).getTime() - 3600_000);

  let headers = 0;
  let skippedScope = 0;
  let capped = false;
  // Sapuan penuh yang tuntas (halaman habis, tak terpotong) → boleh prune faktur yang hilang di Accurate.
  let tuntas = false;
  const seen: number[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const list = await accGet(
      creds,
      "/accurate/api/purchase-invoice/list.do",
      `sp.page=${page}&sp.pageSize=100&sp.sort=lastUpdate|desc&fields=id,number,billNumber,transDate,dueDate,lastUpdate,statusName,approvalStatus,totalAmount,vendor,description`,
    );
    if (list.s !== true) throw new Error(`purchase-invoice/list.do gagal di halaman ${page}`);
    const rows = Array.isArray(list.d) ? (list.d as Array<Record<string, unknown>>) : [];
    if (rows.length === 0) { tuntas = true; break; }
    for (const r of rows) seen.push(Number(r.id));

    const ids = rows.map((r) => Number(r.id));
    const existing = new Set(
      (await sql`SELECT accurate_id FROM accurate_purchase_invoice WHERE accurate_id = ANY(${ids}::bigint[])`).map((r) => Number(r.accurate_id)),
    );
    const mapped: AccurateInvoiceHeader[] = [];
    let allOlder = true;
    for (const v of rows) {
      const lastUpdate = accDateTime(v.lastUpdate);
      if (!watermark || !lastUpdate || new Date(lastUpdate) >= watermark) allOlder = false;
      const transDate = accDate(v.transDate);
      if (!transDate || !(existing.has(Number(v.id)) || transDate >= since)) { skippedScope++; continue; }
      const vendor = v.vendor && typeof v.vendor === "object" ? (v.vendor as { id?: unknown; name?: unknown }) : null;
      mapped.push({
        accurate_id: Number(v.id),
        number: String(v.number ?? `PI-${v.id}`),
        bill_number: textOrNull(v.billNumber),
        vendor_id: idOrNull(vendor?.id),
        vendor_name: vendor?.name != null ? String(vendor.name) : "(vendor tak diketahui)",
        trans_date: transDate,
        due_date: accDate(v.dueDate),
        status_name: textOrNull(v.statusName),
        approval_status: textOrNull(v.approvalStatus),
        total_amount: v.totalAmount != null && v.totalAmount !== "" ? Number(v.totalAmount) : null,
        description: textOrNull(v.description),
        last_update: lastUpdate,
        opt_lock: null,
      });
    }
    headers += await upsertAccurateInvoices(mapped);
    if (rows.length < 100) { tuntas = true; break; }
    if (!full && allOlder) break;
    if (page >= maxPages) capped = laporBatasHalaman("purchase-invoice", page, maxPages, 100);
    await sleep(150);
  }

  let pruned = 0;
  let pruneSkipped = false;
  if (full && tuntas && !capped) {
    const p = await pruneInvoices(seen, since);
    pruned = p.pruned;
    pruneSkipped = p.skipped && seen.length > 0;
  }

  let details = 0;
  let detailFailed = 0;
  let lines = 0;
  for (const inv of await pendingInvoiceDetails(detailLimit)) {
    const det = await accGet(creds, "/accurate/api/purchase-invoice/detail.do", `id=${inv.accurate_id}`);
    if (det?.s !== true) {
      // Faktur bermasalah tak boleh menghentikan sisanya; items_last_update tetap basi → dicoba lagi.
      detailFailed++;
      await sleep(150);
      continue;
    }
    const d = det.d as Detail;
    const items = petakanBarisDetail(d);
    lines += await replaceInvoiceLines(inv.accurate_id, inv.last_update, d?.optLock != null ? Number(d.optLock) : null, items);
    details++;
    await sleep(150);
  }

  return {
    ok: true,
    headers,
    skipped_scope: skippedScope,
    details,
    detail_failed: detailFailed,
    lines,
    pending_details: await countPendingInvoiceDetails(),
    full,
    since,
    ...(pruned ? { pruned } : {}),
    ...(pruneSkipped ? { prune_skipped: true } : {}),
    ...(capped ? { cappedByPages: true } : {}),
  };
}
