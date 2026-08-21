"use client";

import { useMemo, useState } from "react";

import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { LpseTenderTable, type LpseTender } from "@/components/tables/lpse-tender-table";
import { AddLpseTenderButton, type EmployeeOption } from "./add-lpse-tender-button";

const STATUS_FILTERS = [
  ["all", "Semua"],
  ["pesan_masuk", "Pesan Masuk"],
  ["barang_dikirim", "Barang Dikirim"],
  ["selesai", "Selesai"],
] as const;

// F20 — E-Catalog/LPSE Compliance Tracker. Satu entity, tak perlu tab
// (beda dari F139 yang punya 2 sub-view tiket+kategori).
export function LpseTenderView({ tenders, employees }: { tenders: LpseTender[]; employees: EmployeeOption[] }) {
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const filtered = useMemo(
    () => tenders.filter((t) => statusFilter === "all" || t.status === statusFilter),
    [tenders, statusFilter],
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
        <AddLpseTenderButton employees={employees} />
      </div>
      <Card>
        <CardContent className="pt-6">
          {tenders.length === 0 ? (
            <EmptyState title="Belum ada tender" description='Klik "Tambah Tender" untuk mulai.' />
          ) : filtered.length === 0 ? (
            <EmptyState title="Tak ada tender yang cocok filter" description="Coba ganti filter status." />
          ) : (
            <LpseTenderTable tenders={filtered} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
