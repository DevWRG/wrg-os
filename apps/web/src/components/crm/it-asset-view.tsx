"use client";

import { useState } from "react";

import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ItTicketsTable, type ItTicket } from "@/components/tables/it-tickets-table";
import { ItAssetsTable, type ItAsset } from "@/components/tables/it-assets-table";
import { AddItTicketButton } from "@/components/crm/add-it-ticket-button";
import { AddItAssetButton } from "@/components/crm/add-it-asset-button";

// F52 — satu halaman, dua tab (Tiket + Aset). BEDA dari kasus F37/F38 (tab
// digabung ke halaman ASING yg domainnya beda, lalu dipisah per arahan
// Direktur soal domain grouping): di sini kedua tab sama-sama domain OPS &
// fitur yang sama (F52), jadi digabung 1 menu itu wajar — bukan pelanggaran
// prinsip yang sama.
export function ItAssetView({ tickets, assets }: { tickets: ItTicket[] | null; assets: ItAsset[] }) {
  const [tab, setTab] = useState<"tiket" | "aset">("tiket");
  // Picker "Buat Tiket" cuma boleh nawarin aset AKTIF — backend menolak
  // ticket ke aset nonaktif, jadi jangan sodorkan pilihan yg pasti ditolak.
  const activeAssets = assets.filter((a) => a.active);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div role="tablist" aria-label="Tampilan IT Asset" className="flex w-fit gap-1 rounded-lg border p-1">
          {(
            [
              ["tiket", "Tiket"],
              ["aset", "Aset"],
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
        {tab === "tiket" ? <AddItTicketButton assets={activeAssets} /> : <AddItAssetButton />}
      </div>

      {tab === "tiket" ? (
        <div role="tabpanel" id="panel-tiket" aria-labelledby="tab-tiket">
          <Card>
            <CardContent className="pt-6">
              {!tickets ? (
                <EmptyState title="Data tidak tersedia" description="Pastikan apps/api jalan & DATABASE_URL terisi." />
              ) : tickets.length === 0 ? (
                <EmptyState
                  title="Belum ada tiket"
                  description={activeAssets.length === 0 ? 'Belum ada aset aktif — tambah dulu di tab "Aset".' : 'Klik "Buat Tiket" untuk mulai.'}
                />
              ) : (
                <ItTicketsTable tickets={tickets} />
              )}
            </CardContent>
          </Card>
        </div>
      ) : (
        <div role="tabpanel" id="panel-aset" aria-labelledby="tab-aset">
          <Card>
            <CardContent className="pt-6">
              {assets.length === 0 ? (
                <EmptyState title="Belum ada aset terdaftar" description='Klik "Tambah Aset" untuk mulai.' />
              ) : (
                <ItAssetsTable assets={assets} />
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
