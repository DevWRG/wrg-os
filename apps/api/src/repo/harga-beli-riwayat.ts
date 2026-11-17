// F172 (330, #2382) — riwayat faktur pembelian Accurate untuk HPP rata-rata beli 12 bulan.
//
// Cermin F152 (accurate_purchase_invoice) baru mulai AP_ACCURATE_SINCE (1 Okt 2026). Faktur yang lebih tua
// ditarik ke tabel terpisah accurate_purchase_line_riwayat — HANYA sebagai bahan harga (harga_beli_rata_v),
// tidak masuk daftar 3-way match. Sinkronnya (accurateSync.syncPurchaseInvoiceRiwayat) dijalankan manual;
// jendela 12 bulan bergulir, jadi begitu cermin F152 sudah berumur 12 bulan tabel ini tak dibaca lagi.

import { db } from "../db.js";
import type { AccurateInvoiceLine } from "./ap-three-way.js";

export const RIWAYAT_SYNC_ENTITY = "purchase-invoice-riwayat";

export interface FakturRiwayat {
  accurate_id: number;
  number: string;
  trans_date: string;
  vendor_name: string | null;
  last_update: string | null;
}

/** Tanggal awal jendela: `bulan` bulan sebelum `hariIni` (yyyy-mm-dd). Tanggal 31 → akhir bulan tujuan. */
export function awalJendela(hariIni: string, bulan: number): string {
  const [y, m, d] = hariIni.split("-").map(Number);
  const total = y * 12 + (m - 1) - bulan;
  const ty = Math.floor(total / 12), tm = total % 12;
  const akhir = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
  return `${ty}-${String(tm + 1).padStart(2, "0")}-${String(Math.min(d, akhir)).padStart(2, "0")}`;
}

/** Faktur yang perlu (ulang) ditarik detailnya: dalam [dari, sampai) dan lastUpdate-nya beda dari yang tersimpan. */
export function perluDetail(f: FakturRiwayat, dari: string, sampai: string, tersimpan: Map<number, string | null>): boolean {
  if (f.trans_date < dari || f.trans_date >= sampai) return false;
  if (!tersimpan.has(f.accurate_id)) return true;
  const lama = tersimpan.get(f.accurate_id);
  return f.last_update == null || lama == null || new Date(lama).getTime() !== new Date(f.last_update).getTime();
}

/** lastUpdate faktur yang sudah tersimpan di riwayat (per faktur). */
export async function riwayatTersimpan(ids: number[]): Promise<Map<number, string | null>> {
  if (ids.length === 0) return new Map();
  const rows = await db()`
    SELECT invoice_id, max(invoice_last_update)::text AS lu FROM accurate_purchase_line_riwayat
     WHERE invoice_id = ANY(${ids}::bigint[]) GROUP BY invoice_id`;
  return new Map(rows.map((r) => [Number(r.invoice_id), (r.lu as string | null) ?? null]));
}

/** Ganti seluruh baris satu faktur. Faktur tanpa baris barang tak meninggalkan jejak (ditarik ulang di sapuan berikut — murah). */
export async function gantiBarisRiwayat(f: FakturRiwayat, lines: AccurateInvoiceLine[]): Promise<number> {
  return db().begin(async (tx) => {
    await tx`DELETE FROM accurate_purchase_line_riwayat WHERE invoice_id = ${f.accurate_id}`;
    for (const l of lines) {
      await tx`
        INSERT INTO accurate_purchase_line_riwayat (
          accurate_detail_id, invoice_id, invoice_number, trans_date, vendor_name, item_no, item_desc, qty, return_qty,
          unit_name, unit_ratio, unit_price, disc_amount, total_price, invoice_last_update
        )
        VALUES (
          ${l.accurate_detail_id}, ${f.accurate_id}, ${f.number}, ${f.trans_date}, ${f.vendor_name}, ${l.item_no}, ${l.item_desc},
          ${l.qty}, ${l.return_qty}, ${l.unit_name}, ${l.unit_ratio}, ${l.unit_price}, ${l.disc_amount}, ${l.total_price}, ${f.last_update}
        )
        ON CONFLICT (accurate_detail_id) DO UPDATE SET
          invoice_id = EXCLUDED.invoice_id, invoice_number = EXCLUDED.invoice_number, trans_date = EXCLUDED.trans_date,
          vendor_name = EXCLUDED.vendor_name, item_no = EXCLUDED.item_no, item_desc = EXCLUDED.item_desc, qty = EXCLUDED.qty,
          return_qty = EXCLUDED.return_qty, unit_name = EXCLUDED.unit_name, unit_ratio = EXCLUDED.unit_ratio,
          unit_price = EXCLUDED.unit_price, disc_amount = EXCLUDED.disc_amount, total_price = EXCLUDED.total_price,
          invoice_last_update = EXCLUDED.invoice_last_update, synced_at = now()
      `;
    }
    return lines.length;
  });
}

export async function catatSinkronRiwayat(res: object, ok: boolean): Promise<void> {
  const sql = db();
  const summary = JSON.parse(JSON.stringify(res));
  await sql`
    INSERT INTO accurate_sync_state (entity, last_synced_at, last_run_ok, last_run_summary)
    VALUES (${RIWAYAT_SYNC_ENTITY}, now(), ${ok}, ${sql.json(summary)})
    ON CONFLICT (entity) DO UPDATE SET last_synced_at = now(), last_run_ok = ${ok}, last_run_summary = ${sql.json(summary)}
  `;
}
