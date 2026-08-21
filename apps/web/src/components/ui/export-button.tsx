"use client";

import { useState } from "react";
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
//
// Tombolnya SOLID (variant default), bukan outline. Di toolbar tabel, tombol ini
// berdiri di antara kotak cari & dropdown filter yang semuanya putih — dengan
// outline ia tampak sebagai kotak putih keempat dan orang tidak sadar itu bisa
// diklik. Aturan umumnya: kontrol masukan putih, AKSI berwarna.
export function ExportButton<T>({
  filename,
  columns,
  data,
  fetchData,
  label = "Export Excel",
}: {
  filename: string;
  columns: ExportColumn<T>[];
  data?: T[];
  /** kalau di-set, data diambil saat klik (mis. detail dari API), bukan dari prop. */
  fetchData?: () => Promise<T[]>;
  label?: string;
}) {
  const [busy, setBusy] = useState(false);

  async function exportCsv() {
    setBusy(true);
    let rows: T[] = [];
    try {
      rows = fetchData ? await fetchData() : (data ?? []);
    } catch {
      rows = [];
    } finally {
      setBusy(false);
    }
    if (rows.length === 0) return;
    const head = columns.map((c) => csvCell(c.header)).join(",");
    const body = rows.map((row) => columns.map((c) => csvCell(c.value(row))).join(",")).join("\n");
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
    <Button size="sm" variant="default" onClick={exportCsv} disabled={busy || (!fetchData && (data?.length ?? 0) === 0)}>
      <Download className="size-4" /> {busy ? "Menyiapkan…" : label}
    </Button>
  );
}
