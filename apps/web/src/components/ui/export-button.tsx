"use client";

import { Download } from "lucide-react";

import { Button } from "@/components/ui/button";

export interface ExportColumn<T> {
  header: string;
  value: (row: T) => string | number | null | undefined;
}

function csvCell(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// Export client-side ke CSV yang dibuka mulus di Excel (BOM UTF-8 + directive
// sep=, agar Excel lokal apa pun pakai koma sbg pemisah kolom).
export function ExportButton<T>({
  filename,
  columns,
  data,
  label = "Export Excel",
}: {
  filename: string;
  columns: ExportColumn<T>[];
  data: T[];
  label?: string;
}) {
  function exportCsv() {
    const head = columns.map((c) => csvCell(c.header)).join(",");
    const body = data.map((row) => columns.map((c) => csvCell(c.value(row))).join(",")).join("\n");
    const stamp = new Date().toISOString().slice(0, 10);
    const csv = `sep=,\n${head}\n${body}`;
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${filename}-${stamp}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }
  return (
    <Button size="sm" variant="outline" onClick={exportCsv} disabled={data.length === 0}>
      <Download className="size-4" /> {label}
    </Button>
  );
}
