"use client";

import { useState } from "react";
import writeXlsxFile from "write-excel-file/browser";
import { FileSpreadsheet, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";

interface RankRow {
  key: string;
  label: string;
  sub?: string;
  total: number;
  count: number;
  target?: number;
}
export interface RevenueExport {
  from: string;
  to: string;
  per_customer: RankRow[];
  per_salesman: RankRow[];
  per_cabang: RankRow[];
  per_product: RankRow[];
}

// Sheet terpisah sesuai tab tabel Revenue. withTarget → tambah kolom Target & Capai.
const SHEETS: { name: string; field: keyof Omit<RevenueExport, "from" | "to">; nameCol: string; withTarget?: boolean }[] = [
  { name: "Per Customer", field: "per_customer", nameCol: "Customer" },
  { name: "Per Sales", field: "per_salesman", nameCol: "Sales", withTarget: true },
  { name: "Per Cabang", field: "per_cabang", nameCol: "Cabang", withTarget: true },
  { name: "Per Produk", field: "per_product", nameCol: "Produk" },
];
const COLS = [{ width: 40 }, { width: 24 }, { width: 18 }, { width: 10 }];
const COLS_TARGET = [{ width: 40 }, { width: 24 }, { width: 18 }, { width: 10 }, { width: 18 }, { width: 8 }];

export function RevenueExportButton({ data }: { data: RevenueExport }) {
  const [busy, setBusy] = useState(false);

  async function onExport() {
    setBusy(true);
    try {
      const sheets = SHEETS.map((s) => {
        const rows = data[s.field] ?? [];
        const cols = s.withTarget ? COLS_TARGET : COLS;
        const header = [
          { value: s.nameCol, fontWeight: "bold" as const },
          { value: "Detail", fontWeight: "bold" as const },
          { value: "Total (Rp)", fontWeight: "bold" as const, align: "right" as const },
          { value: "Faktur", fontWeight: "bold" as const, align: "right" as const },
          ...(s.withTarget
            ? [
                { value: "Target (Rp)", fontWeight: "bold" as const, align: "right" as const },
                { value: "Capai %", fontWeight: "bold" as const, align: "right" as const },
              ]
            : []),
        ];
        const body = rows.map((r) => [
          { type: String, value: r.label || "—" },
          r.sub ? { type: String, value: r.sub } : null,
          { type: Number, value: r.total, format: "#,##0" },
          { type: Number, value: r.count },
          ...(s.withTarget
            ? [
                r.target ? { type: Number, value: r.target, format: "#,##0" } : null,
                r.target ? { type: Number, value: Math.round((r.total / r.target) * 100) } : null,
              ]
            : []),
        ]);
        // Baris judul periode (rentang tanggal aktif) di atas tabel.
        const title = [{ value: `Periode: ${data.from} → ${data.to}`, fontWeight: "bold" as const, span: cols.length }];
        return { sheet: s.name, data: [title, header, ...body], columns: cols };
      });
      // Browser: writeXlsxFile(...) → { toFile } untuk trigger download.
      await writeXlsxFile(sheets).toFile(`revenue_${data.from}_${data.to}.xlsx`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button variant="outline" size="sm" onClick={onExport} disabled={busy}>
      {busy ? <Loader2 className="animate-spin" /> : <FileSpreadsheet />}
      Export Excel
    </Button>
  );
}
