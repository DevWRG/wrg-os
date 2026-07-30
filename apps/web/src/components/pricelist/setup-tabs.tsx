"use client";

// Dua sumber harga hidup berdampingan di menu Pricelist Setup, dan sengaja tidak
// digabung jadi satu tabel:
//
//   • "Produk Accurate" (tabel pricelist, migrasi 043) — kalkulator internal:
//     HPP + margin + diskon + alokasi insentif diinput manual per item Accurate,
//     harga jual DIHITUNG, lalu di-publish ke menu Pricelist (AM).
//   • "Price Book keagenan" (product_pricelist + product_pricelist_setup, 071/073)
//     — snapshot 1.031 SKU yang HARGANYA sudah final dari Direktur; HPP menyusul
//     dari kroscek Compilation dan margin cuma turunan. Tidak ada publish di sini.
//
// Kunci produknya beda (item Accurate vs SKU price book) dan arah rumusnya
// berlawanan, jadi satu tabel gabungan hanya akan menyamarkan angka mana yang
// input dan mana yang turunan.

import { useState } from "react";

import { SetupPricelistClient } from "@/components/pricelist/setup-pricelist-client";
import {
  PricebookSetupTable,
  type PricebookSetupRow,
  type PricebookSetupSummary,
} from "@/components/pricelist/pricebook-setup-table";
import type { ProductOption } from "@/components/pricelist/pricelist-form-sheet";
import type { PricelistRow } from "@/lib/pricelist";

const TABS = [
  { key: "accurate", label: "Produk Accurate" },
  { key: "pricebook", label: "Price Book keagenan" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

export function PricelistSetupTabs({
  rows,
  products,
  canPublish,
  pricebookRows,
  pricebookRingkas,
}: {
  rows: PricelistRow[];
  products: ProductOption[];
  canPublish: boolean;
  pricebookRows: PricebookSetupRow[] | null;
  pricebookRingkas: PricebookSetupSummary | null;
}) {
  const [tab, setTab] = useState<TabKey>("accurate");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1 rounded-lg border p-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${tab === t.key ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
          >
            {t.label}
            {t.key === "pricebook" && pricebookRingkas ? (
              <span className="ml-1.5 text-xs opacity-80">{pricebookRingkas.total}</span>
            ) : null}
          </button>
        ))}
      </div>

      {tab === "accurate" && (
        <SetupPricelistClient rows={rows} products={products} canPublish={canPublish} />
      )}
      {tab === "pricebook" && (
        <PricebookSetupTable rows={pricebookRows} ringkas={pricebookRingkas} />
      )}
    </div>
  );
}
