"use client";

import { useMemo, useState } from "react";

import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { GaTicketsTable, type GaTicket } from "@/components/tables/ga-tickets-table";
import { GaTicketCategoriesTable, type GaTicketCategory } from "@/components/tables/ga-ticket-categories-table";
import { AddGaTicketButton, type AppUserOption } from "./add-ga-ticket-button";
import { AddGaTicketCategoryButton } from "./add-ga-ticket-category-button";

const STATUS_FILTERS = [
  ["all", "Semua"],
  ["open", "Open"],
  ["in_progress", "In Progress"],
  ["waiting", "Waiting"],
  ["completed", "Completed"],
  ["closed", "Closed"],
  ["cancelled", "Cancelled"],
] as const;

// F139 — satu halaman, dua tab (Tiket + Kategori), pola sama F132 (2
// sub-view domain & fitur yang SAMA, bukan pelanggaran prinsip domain-grouping).
export function GaHelpdeskView({
  tickets, categories, users,
}: { tickets: GaTicket[]; categories: GaTicketCategory[]; users: AppUserOption[] }) {
  const [tab, setTab] = useState<"tiket" | "kategori">("tiket");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [overdueOnly, setOverdueOnly] = useState(false);
  const activeCategories = categories.filter((c) => c.active);

  const filtered = useMemo(
    () =>
      tickets.filter((t) => (statusFilter === "all" || t.status === statusFilter) && (!overdueOnly || t.sla_overdue)),
    [tickets, statusFilter, overdueOnly],
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div role="tablist" aria-label="Tampilan Helpdesk" className="flex w-fit gap-1 rounded-lg border p-1">
          {(
            [
              ["tiket", "Tiket"],
              ["kategori", "Kategori"],
            ] as const
          ).map(([k, lbl]) => (
            <button
              key={k}
              role="tab"
              aria-selected={tab === k}
              aria-controls={`panel-${k}`}
              id={`tab-${k}`}
              onClick={() => setTab(k)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${tab === k ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
            >
              {tab === k ? <span aria-hidden="true">• </span> : null}
              {lbl}
            </button>
          ))}
        </div>
        {tab === "tiket" ? <AddGaTicketButton categories={activeCategories} users={users} /> : <AddGaTicketCategoryButton />}
      </div>

      {tab === "tiket" ? (
        <div role="tabpanel" id="panel-tiket" aria-labelledby="tab-tiket" className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            {STATUS_FILTERS.map(([k, lbl]) => (
              <Button key={k} size="sm" variant={statusFilter === k ? "secondary" : "ghost"} onClick={() => setStatusFilter(k)}>
                {lbl}
              </Button>
            ))}
            <Button size="sm" variant={overdueOnly ? "destructive" : "ghost"} onClick={() => setOverdueOnly((v) => !v)}>
              Overdue saja
            </Button>
          </div>
          <Card>
            <CardContent className="pt-6">
              {tickets.length === 0 ? (
                <EmptyState
                  title="Belum ada tiket"
                  description={activeCategories.length === 0 ? 'Belum ada kategori aktif — tambah dulu di tab "Kategori".' : 'Klik "Buat Tiket" untuk mulai.'}
                />
              ) : filtered.length === 0 ? (
                <EmptyState title="Tak ada tiket yang cocok filter" description="Coba ganti filter status/overdue." />
              ) : (
                <GaTicketsTable tickets={filtered} users={users} />
              )}
            </CardContent>
          </Card>
        </div>
      ) : (
        <div role="tabpanel" id="panel-kategori" aria-labelledby="tab-kategori">
          <Card>
            <CardContent className="pt-6">
              {categories.length === 0 ? (
                <EmptyState title="Belum ada kategori" description='Klik "Tambah Kategori" untuk mulai.' />
              ) : (
                <GaTicketCategoriesTable categories={categories} />
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
