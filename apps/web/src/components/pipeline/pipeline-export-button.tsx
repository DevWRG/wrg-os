"use client";

import { useState } from "react";
import writeXlsxFile from "write-excel-file/browser";
import { FileSpreadsheet, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { PipelineDeal } from "./pipeline-board";

// Export board pipeline ke .xlsx (write-excel-file, sama seperti menu Revenue).
// Yang di-export = deal SETELAH filter toolbar, jadi apa yang dilihat = apa yang
// terunduh. Dua sheet: Deals (detail) + Ringkasan per Stage.

const HEAD = (v: string, right = false) =>
  ({ value: v, fontWeight: "bold" as const, ...(right ? { align: "right" as const } : {}) });

const COLS_DEAL = [
  { width: 16 }, // Stage
  { width: 34 }, // Faskes
  { width: 28 }, // Customer
  { width: 16 }, // Brand
  { width: 30 }, // Produk
  { width: 16 }, // Kategori Produk
  { width: 14 }, // Kategori Prospek
  { width: 14 }, // Forecast
  { width: 14 }, // Kerja Sama
  { width: 8 }, // Qty
  { width: 16 }, // Harga Satuan
  { width: 18 }, // Perkiraan Nilai
  { width: 10 }, // Peluang %
  { width: 18 }, // Nilai x Peluang
  { width: 20 }, // AM
  { width: 16 }, // HOD
  { width: 14 }, // Cabang
  { width: 16 }, // Kota
  { width: 16 }, // Provinsi
  { width: 16 }, // Estimasi Beli
  { width: 10 }, // Tahun Beli
  { width: 12 }, // Hari di Tahap
  { width: 10 }, // Mangkrak
  { width: 40 }, // Catatan
  { width: 18 }, // Update Terakhir
];
const COLS_STAGE = [{ width: 18 }, { width: 12 }, { width: 20 }, { width: 20 }];

const num = (v: number | null | undefined) =>
  v === null || v === undefined ? null : { type: Number, value: v, format: "#,##0" };
const str = (v: string | null | undefined) => (v ? { type: String, value: v } : null);

// Coop model → bahasa awam, samakan dengan tampilan board.
const coopLabel = (c: string | null) => (c == null ? null : /sale/i.test(c) ? "Beli Putus" : c);

// Nilai DB 'Closing-Won'/'Closing-Lost' ditampilkan "Won"/"Lost" di board —
// export ikut label yang dilihat user.
const STAGE_LABEL: Record<string, string> = { "Closing-Won": "Won", "Closing-Lost": "Lost" };
const stageLabel = (s: string) => STAGE_LABEL[s] ?? s;

// Estimasi beli "September 2026" — sama seperti buyEta di board (bulan/tahun bisa
// masing-masing kosong).
const MONTH_ID = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
const buyEta = (m: number | null, y: number | null) =>
  [m != null && m >= 1 && m <= 12 ? MONTH_ID[m - 1] : null, y != null ? String(y) : null]
    .filter(Boolean)
    .join(" ") || null;

export function PipelineExportButton({
  deals,
  stages,
}: {
  /** deal hasil filter toolbar (bukan seluruh board). */
  deals: PipelineDeal[];
  /** urutan stage untuk sheet ringkasan. */
  stages: string[];
}) {
  const [busy, setBusy] = useState(false);

  async function onExport() {
    setBusy(true);
    try {
      const header = [
        HEAD("Stage"), HEAD("Faskes"), HEAD("Customer"), HEAD("Brand"), HEAD("Produk"),
        HEAD("Kategori Produk"), HEAD("Kategori Prospek"), HEAD("Forecast"), HEAD("Kerja Sama"),
        HEAD("Qty", true), HEAD("Harga Satuan", true), HEAD("Perkiraan Nilai", true),
        HEAD("Peluang %", true), HEAD("Nilai x Peluang", true),
        HEAD("AM"), HEAD("HOD"), HEAD("Cabang"), HEAD("Kota"), HEAD("Provinsi"),
        HEAD("Estimasi Beli"), HEAD("Tahun Beli", true), HEAD("Hari di Tahap", true), HEAD("Mangkrak"),
        HEAD("Catatan"), HEAD("Update Terakhir"),
      ];
      const body = deals.map((d) => [
        str(stageLabel(d.stage)),
        str(d.facility_name),
        str(d.customer_name),
        str(d.brand),
        str(d.product),
        str(d.product_category),
        str(d.prospect_category),
        str(d.forecast_category),
        str(coopLabel(d.coop_model)),
        num(d.qty_num),
        num(d.unit_price),
        num(d.estimate_amount),
        d.probability != null ? { type: Number, value: Math.round(d.probability * 100) } : null,
        num(d.weighted),
        str(d.am_name ?? d.am_id),
        str(d.pic_hod),
        str(d.cabang),
        str(d.city),
        str(d.province),
        str(buyEta(d.purchase_month, d.purchase_year)),
        d.purchase_year != null ? { type: Number, value: d.purchase_year } : null,
        d.days_in_stage != null ? { type: Number, value: d.days_in_stage } : null,
        { type: String, value: d.stale ? "Ya" : "Tidak" },
        str(d.notes),
        // Kolom Date butuh format eksplisit; kirim string lokal saja biar aman
        // dari nilai updated_at yang tak terparse.
        str(
          d.updated_at && !isNaN(new Date(d.updated_at).getTime())
            ? new Date(d.updated_at).toLocaleString("id-ID", {
                day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
              })
            : null,
        ),
      ]);

      const perStage = stages
        .map((s) => {
          const ds = deals.filter((d) => d.stage === s);
          return {
            stage: s,
            count: ds.length,
            total: ds.reduce((a, d) => a + (d.estimate_amount ?? 0), 0),
            weighted: ds.reduce((a, d) => a + d.weighted, 0),
          };
        })
        .filter((r) => r.count > 0);
      const stageRows = perStage.map((r) => [
        { type: String, value: stageLabel(r.stage) },
        { type: Number, value: r.count },
        { type: Number, value: r.total, format: "#,##0" },
        { type: Number, value: Math.round(r.weighted), format: "#,##0" },
      ]);
      const totalRow = [
        { type: String, value: "TOTAL", fontWeight: "bold" as const },
        { type: Number, value: deals.length, fontWeight: "bold" as const },
        {
          type: Number,
          value: deals.reduce((a, d) => a + (d.estimate_amount ?? 0), 0),
          format: "#,##0",
          fontWeight: "bold" as const,
        },
        {
          type: Number,
          value: Math.round(deals.reduce((a, d) => a + d.weighted, 0)),
          format: "#,##0",
          fontWeight: "bold" as const,
        },
      ];

      const stamp = new Date().toISOString().slice(0, 10);
      const title = [
        { value: `Sales Pipeline — ${deals.length} deal (sesuai filter) · ${stamp}`, fontWeight: "bold" as const, span: COLS_DEAL.length },
      ];
      // Browser: writeXlsxFile([sheet, …]) → { toFile } untuk trigger download.
      await writeXlsxFile([
        { sheet: "Deals", data: [title, header, ...body], columns: COLS_DEAL },
        {
          sheet: "Ringkasan per Stage",
          data: [
            [HEAD("Stage"), HEAD("Jumlah Deal", true), HEAD("Total Nilai", true), HEAD("Nilai x Peluang", true)],
            ...stageRows,
            totalRow,
          ],
          columns: COLS_STAGE,
        },
      ]).toFile(`pipeline_${stamp}.xlsx`);
    } finally {
      setBusy(false);
    }
  }

  // variant `soft` (ber-fill), BUKAN `outline`: di toolbar ini tombolnya berdiri
  // di antara kotak cari & 7 dropdown filter yang semuanya putih — dengan outline
  // ia jadi kotak putih kesekian dan tak terbaca sebagai tombol. Tetap tidak solid
  // supaya tidak bersaing dengan aksi utama "+ Deal Baru" di sebelahnya.
  return (
    <Button variant="soft" size="sm" onClick={onExport} disabled={busy || deals.length === 0}>
      {busy ? <Loader2 className="animate-spin" /> : <FileSpreadsheet />}
      Export Excel
    </Button>
  );
}
