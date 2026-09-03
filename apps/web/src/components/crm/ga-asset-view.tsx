"use client";

import { useState } from "react";

import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { GaAssetsTable, type GaAsset } from "@/components/tables/ga-assets-table";
import { GaAssetCategoriesTable, type GaAssetCategory } from "@/components/tables/ga-asset-categories-table";
import { ItTicketsTable, type ItTicket } from "@/components/tables/it-tickets-table";
import { GaMaintenanceTable, type GaMaintenance } from "@/components/tables/ga-maintenance-table";
import { GaVendorTable, type GaVendor } from "@/components/tables/ga-vendor-table";
import { AddGaAssetButton } from "@/components/crm/add-ga-asset-button";
import { AddGaAssetCategoryButton } from "@/components/crm/add-ga-asset-category-button";
import { AddItTicketButton } from "@/components/crm/add-it-ticket-button";
import { AddGaMaintenanceButton } from "@/components/crm/add-ga-maintenance-button";
import { AddGaVendorButton } from "@/components/crm/add-ga-vendor-button";
import type { AppUserOption } from "@/components/crm/ga-asset-pic-actions";

// Satu menu, LIMA tab: Aset + Kategori (F132), Tiket IT (F52), Maintenance &
// Vendor GA (F137) — arahan Direktur eksplisit "1 menu, jangan terpisah".
// F133 (assignment PIC) tidak menambah tab: itu aksi inline di tabel Aset,
// karena itu `users` dipakai dua tab sekaligus (picker PIC & approver).
// `AppUserOption` di ga-maintenance-actions bentuknya identik dengan yang di
// ga-asset-pic-actions ({ id, name }), jadi satu prop cukup untuk keduanya.
export function GaAssetView({
  assets, categories, tickets, users, schedules, vendors, canApproveFinance,
}: {
  assets: GaAsset[];
  categories: GaAssetCategory[];
  tickets: ItTicket[] | null;
  users: AppUserOption[];
  schedules: GaMaintenance[];
  vendors: GaVendor[];
  canApproveFinance: boolean;
}) {
  const [tab, setTab] = useState<"aset" | "kategori" | "tiket" | "maintenance" | "vendor">("aset");
  const activeCategories = categories.filter((c) => c.active);
  const activeAssets = assets.filter((a) => a.active);
  const activeVendors = vendors.filter((v) => v.status === "active");
  const assetOptions = activeAssets.map((a) => ({
    id: a.id, asset_code: a.asset_code, nama: a.nama, category_id: a.category_id,
  }));
  const TABS = [
    ["aset", "Aset"],
    ["kategori", "Kategori"],
    ["tiket", "Tiket IT"],
    ["maintenance", "Maintenance"],
    ["vendor", "Vendor GA"],
  ] as const;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div role="tablist" aria-label="Tampilan Aset GA" className="flex w-fit gap-1 rounded-lg border p-1">
          {TABS.map(([k, lbl]) => (
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
        {tab === "aset" && <AddGaAssetButton categories={activeCategories} />}
        {tab === "kategori" && <AddGaAssetCategoryButton />}
        {/* `users` sudah ditarik halaman ini (GET /app-users) untuk picker PIC
            aset & approver — dipakai ulang di sini, tanpa fetch baru. */}
        {tab === "tiket" && <AddItTicketButton assets={activeAssets} users={users} />}
        {tab === "maintenance" && (
          <AddGaMaintenanceButton
            assets={assetOptions}
            vendors={activeVendors}
            categories={categories.map((c) => ({ id: c.id, default_recur_months: c.default_recur_months }))}
          />
        )}
        {tab === "vendor" && <AddGaVendorButton />}
      </div>

      {tab === "aset" && (
        <div role="tabpanel" id="panel-aset" aria-labelledby="tab-aset">
          <Card>
            <CardContent className="pt-6">
              {assets.length === 0 ? (
                <EmptyState
                  title="Belum ada aset terdaftar"
                  description={activeCategories.length === 0 ? 'Belum ada kategori aktif — tambah dulu di tab "Kategori".' : 'Klik "Tambah Aset" untuk mulai.'}
                />
              ) : (
                <GaAssetsTable assets={assets} categories={activeCategories} users={users} />
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {tab === "kategori" && (
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
      )}

      {tab === "tiket" && (
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

      {tab === "maintenance" && (
        <div role="tabpanel" id="panel-maintenance" aria-labelledby="tab-maintenance">
          <Card>
            <CardContent className="pt-6">
              {schedules.length === 0 ? (
                <EmptyState
                  title="Belum ada jadwal maintenance"
                  description={assetOptions.length === 0 ? 'Belum ada aset aktif — tambah dulu di tab "Aset".' : 'Klik "Jadwalkan Maintenance" untuk mulai.'}
                />
              ) : (
                <GaMaintenanceTable schedules={schedules} canApproveFinance={canApproveFinance} users={users} />
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {tab === "vendor" && (
        <div role="tabpanel" id="panel-vendor" aria-labelledby="tab-vendor">
          <Card>
            <CardContent className="pt-6">
              {vendors.length === 0 ? (
                <EmptyState title="Belum ada vendor" description='Klik "Tambah Vendor" untuk mulai.' />
              ) : (
                <GaVendorTable vendors={vendors} />
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
