"use client";

import { useState } from "react";

import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { AssetTagsTable, type AssetTag } from "@/components/tables/asset-tags-table";
import { AddAssetTagButton } from "@/components/crm/add-asset-tag-button";
import { PrintStickerTab } from "@/components/crm/print-sticker-tab";

// F53 — satu halaman, dua tab (Aset + Cetak Stiker), sama pola F52: dua
// sub-view dari fitur & domain yang SAMA, jadi 1 menu wajar.
export function AssetTagView({ assets }: { assets: AssetTag[] }) {
  const [tab, setTab] = useState<"aset" | "cetak">("aset");
  const activeAssets = assets.filter((a) => a.active);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div role="tablist" aria-label="Tampilan Stiker Aset" className="flex w-fit gap-1 rounded-lg border p-1">
          {(
            [
              ["aset", "Aset"],
              ["cetak", "Cetak Stiker"],
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
        {tab === "aset" && <AddAssetTagButton />}
      </div>

      {tab === "aset" ? (
        <div role="tabpanel" id="panel-aset" aria-labelledby="tab-aset">
          <Card>
            <CardContent className="pt-6">
              {assets.length === 0 ? (
                <EmptyState title="Belum ada aset terdaftar" description='Klik "Tambah Aset" untuk mulai.' />
              ) : (
                <AssetTagsTable assets={assets} />
              )}
            </CardContent>
          </Card>
        </div>
      ) : (
        <div role="tabpanel" id="panel-cetak" aria-labelledby="tab-cetak">
          <PrintStickerTab assets={activeAssets} />
        </div>
      )}
    </div>
  );
}
