import { gatewayFetch } from "@/lib/gateway";
import { PageHeader } from "@/components/dashboard/page-header";
import { InventoryTabs } from "@/components/inventory/inventory-tabs";
import { type InventoryItem } from "@/components/tables/inventory-table";

export const dynamic = "force-dynamic";

async function getItems(): Promise<InventoryItem[] | null> {
  try {
    const res = await gatewayFetch(`/accurate/items?limit=10000`);
    if (!res.ok) return null;
    const data = (await res.json()) as { rows: InventoryItem[] };
    return data.rows ?? [];
  } catch {
    return null;
  }
}

// Data tab "Per Gudang" (F37) SENGAJA tidak diambil di sini — komponen tab yang
// mengambilnya saat tab dibuka, lewat proxy /api/stock/*. Dua alasan:
//   1. Matriksnya ~1,3 MB pada katalog 5.800 item, dan tabnya default tertutup.
//      Prefetch berarti pemakai tab "Semua Stok" ikut menanggungnya.
//   2. Gate `!items` di bawah dulu menyembunyikan SELURUH halaman (termasuk tab
//      2) ketika /accurate/items gagal — padahal itu request terberat di halaman
//      dan paling mungkin timeout, sementara data F37 bisa jadi sehat.
export default async function InventoryPage() {
  const items = await getItems();

  return (
    <>
      <PageHeader
        title="Inventory"
        description="Dua fungsi dalam satu menu: cek stok agregat per SKU (dari Accurate) dan stok per gudang cabang beserta korelasinya ke angka total."
      />
      <InventoryTabs items={items} />
    </>
  );
}
