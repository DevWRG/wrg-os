"use client";

import { useState } from "react";

import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { GaAssetsTable, type GaAsset } from "@/components/tables/ga-assets-table";
import { GaAssetCategoriesTable, type GaAssetCategory } from "@/components/tables/ga-asset-categories-table";
import { ItTicketsTable, type ItTicket } from "@/components/tables/it-tickets-table";
import { AddGaAssetButton } from "@/components/crm/add-ga-asset-button";
import { AddGaAssetCategoryButton } from "@/components/crm/add-ga-asset-category-button";
import { AddItTicketButton } from "@/components/crm/add-it-ticket-button";

// F132 — satu halaman, TIGA tab (Aset, Kategori, Tiket IT). F52 (tiket per
// aset IT) diserap ke sini bukan cuma di level tabel (asset_id FK ga_assets),
// tapi juga di level MENU — arahan Direktur eksplisit "1 menu, jangan
// terpisah" (koreksi dari percobaan awal yang bikin /it-asset route sendiri).
export function GaAssetView({
  assets, categories, tickets,
}: { assets: GaAsset[]; categories: GaAssetCategory[]; tickets: ItTicket[] | null }) {
  const [tab, setTab] = useState<"aset" | "kategori" | "tiket">("aset");
  const activeCategories = categories.filter((c) => c.active);
  const activeAssets = assets.filter((a) => a.active);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div role="tablist" aria-label="Tampilan Aset GA" className="flex w-fit gap-1 rounded-lg border p-1">
          {(
            [
              ["aset", "Aset"],
              ["kategori", "Kategori"],
              ["tiket", "Tiket IT"],
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
        {tab === "aset" ? <AddGaAssetButton categories={activeCategories} /> : null}
        {tab === "kategori" ? <AddGaAssetCategoryButton /> : null}
        {tab === "tiket" ? <AddItTicketButton assets={activeAssets} /> : null}
      </div>

      {tab === "aset" ? (
        <div role="tabpanel" id="panel-aset" aria-labelledby="tab-aset">
          <Card>
            <CardContent className="pt-6">
              {assets.length === 0 ? (
                <EmptyState
                  title="Belum ada aset terdaftar"
                  description={activeCategories.length === 0 ? 'Belum ada kategori aktif — tambah dulu di tab "Kategori".' : 'Klik "Tambah Aset" untuk mulai.'}
                />
              ) : (
                <GaAssetsTable assets={assets} categories={activeCategories} />
              )}
            </CardContent>
          </Card>
        </div>
      ) : tab === "kategori" ? (
        <div role="tabpanel" id="panel-kategori" aria-labelledby="tab-kategori">
          <Card>
            <CardContent className="pt-6">
              {categories.length === 0 ? (
                <EmptyState title="Belum ada kategori" description='Klik "Tambah Kategori" untuk mulai.' />
              ) : (
                <GaAssetCategoriesTable categories={categories} />
              )}
            </CardContent>
          </Card>
        </div>
      ) : (
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
      )}
    </div>
  );
}
