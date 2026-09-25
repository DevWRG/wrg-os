"use client";

import { useMemo, useState } from "react";

import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { DocKlaimTable, type DocKlaim } from "@/components/tables/doc-klaim-table";
import { AddDocKlaimButton, type EmployeeOption } from "./add-doc-klaim-button";

const STATUS_FILTERS = [
  ["all", "Semua"],
  ["baru", "Baru"],
  ["disetujui", "Disetujui"],
  ["ditolak", "Ditolak"],
  ["dibayar", "Dibayar"],
] as const;

// DOC #KLAIM — normalnya ingestion cuma dari WA, tapi "Tambah Klaim (manual)"
// disediakan buat coba tanpa kirim WA sungguhan (tanpa OCR).
export function DocKlaimView({ klaim, employees }: { klaim: DocKlaim[]; employees: EmployeeOption[] }) {
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const filtered = useMemo(
    () => klaim.filter((k) => statusFilter === "all" || k.status === statusFilter),
    [klaim, statusFilter],
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex flex-wrap items-center gap-1.5">
          {STATUS_FILTERS.map(([k, lbl]) => (
            <Button
              key={k}
              size="sm"
              variant={statusFilter === k ? "default" : "outline"}
              aria-pressed={statusFilter === k}
              onClick={() => setStatusFilter(k)}
            >
              {lbl}
            </Button>
          ))}
        </div>
        <AddDocKlaimButton employees={employees} />
      </div>
      <Card>
        <CardContent className="pt-6">
          {klaim.length === 0 ? (
            <EmptyState title="Belum ada klaim masuk" description='Klaim masuk otomatis dari WA (#KLAIM+foto), atau klik "Tambah Klaim (manual)" buat coba.' />
          ) : filtered.length === 0 ? (
            <EmptyState title="Tak ada klaim yang cocok filter" description="Coba ganti filter status." />
          ) : (
            <DocKlaimTable klaim={filtered} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
