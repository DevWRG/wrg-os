import { gatewayFetch } from "@/lib/gateway";
import { sessionUser } from "@/lib/admin-guard";
import { canViewPricebookSummary } from "@/lib/pricebook-access";
import { PageHeader } from "@/components/dashboard/page-header";
import { PricebookView } from "@/components/pricebook/pricebook-view";
import type { PricebookItem, PricebookSummary } from "@/components/pricebook/pricebook-view";

export const dynamic = "force-dynamic";

// F142 Price Book — katalog harga produk KEAGENAN WRG (handover Direktur).
// Gate rute ditegakkan layout dashboard lewat katalog NAV; di sini hanya sub-gate
// tab Ringkasan (Direktur/admin) — datanya memang tidak diambil kalau tak berhak.
async function get<T>(path: string): Promise<T | null> {
  try {
    const res = await gatewayFetch(path);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export default async function PricebookPage() {
  const me = await sessionUser();
  const canSummary = canViewPricebookSummary(me);

  const [items, summary] = await Promise.all([
    get<{ rows: PricebookItem[] }>("/pricebook/items?limit=20000"),
    canSummary ? get<PricebookSummary>("/pricebook/summary") : Promise.resolve(null),
  ]);

  return (
    <>
      <PageHeader
        title="Price Book Keagenan"
        description="Harga jual resmi produk keagenan WRG per periode — Price List, Diskon Maks, Harga Nett Terendah (lantai), dan Nett + PPN 11%. Item Accurate di luar katalog ini ditandai terpisah. (F142)"
      />
      <PricebookView items={items?.rows ?? null} summary={summary} canSummary={canSummary} />
    </>
  );
}
