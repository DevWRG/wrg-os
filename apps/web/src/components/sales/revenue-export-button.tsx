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
}
export interface RevenueExport {
  from: string;
  to: string;
  per_customer: RankRow[];
  per_salesman: RankRow[];
  per_cabang: RankRow[];
  per_product: RankRow[];
}

// 4 sheet terpisah sesuai tab tabel Revenue.
const SHEETS: { name: string; field: keyof Omit<RevenueExport, "from" | "to">; nameCol: string }[] = [
  { name: "Per Customer", field: "per_customer", nameCol: "Customer" },
  { name: "Per Sales", field: "per_salesman", nameCol: "Sales" },
  { name: "Per Cabang", field: "per_cabang", nameCol: "Cabang" },
  { name: "Per Produk", field: "per_product", nameCol: "Produk" },
];
const COLS = [{ width: 40 }, { width: 24 }, { width: 18 }, { width: 10 }];

export function RevenueExportButton({ data }: { data: RevenueExport }) {
  const [busy, setBusy] = useState(false);

  async function onExport() {
    setBusy(true);
    try {
      const sheets = SHEETS.map((s) => {
        const rows = data[s.field] ?? [];
        const header = [
          { value: s.nameCol, fontWeight: "bold" as const },
          { value: "Detail", fontWeight: "bold" as const },
          { value: "Total (Rp)", fontWeight: "bold" as const, align: "right" as const },
          { value: "Faktur", fontWeight: "bold" as const, align: "right" as const },
        ];
        const body = rows.map((r) => [
          { type: String, value: r.label || "—" },
          r.sub ? { type: String, value: r.sub } : null,
          { type: Number, value: r.total, format: "#,##0" },
          { type: Number, value: r.count },
        ]);
        return { sheet: s.name, data: [header, ...body], columns: COLS };
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
