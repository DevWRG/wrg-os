import { gatewayFetch } from "@/lib/gateway";
import { sessionUser } from "@/lib/admin-guard";
import { findNavItem, navOwnVisible, tabVisible } from "@/lib/nav";
import { pilihTab, type DefTab } from "@/lib/page-tabs";
import { PageHeader } from "@/components/dashboard/page-header";
import { PageTabs } from "@/components/layout/page-tabs";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ProductsTable, type AccurateItem } from "@/components/tables/products-table";
import { InventoryTable, type InventoryItem } from "@/components/tables/inventory-table";

export const dynamic = "force-dynamic";

async function getItems<T>(): Promise<T[] | null> {
  try {
    const res = await gatewayFetch(`/accurate/items?limit=10000`);
    if (!res.ok) return null;
    const data = (await res.json()) as { rows: T[] };
    return data.rows ?? [];
  } catch {
    return null;
  }
}

// Katalog & Stok (Accurate) (K2, evaluasi menu 19 Nov 2026): Products dan Inventory
// membaca sumber yang sama (cermin accurate_item), hanya kolomnya beda — dilebur
// jadi dua tab. Izin tetap dua key: tab Katalog = `products` (induk), tab Stok =
// `inventory` (entri features; /inventory → ?tab=stok). Harga di sini harga JUAL.
export default async function KatalogStokPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const [{ tab }, me] = await Promise.all([searchParams, sessionUser()]);
  const induk = findNavItem("/products");
  const fStok = induk?.features?.find((f) => f.key === "inventory");
  const tabs: DefTab[] = [];
  if (!induk || navOwnVisible(me, induk)) tabs.push({ key: "katalog", label: "Katalog" });
  if (fStok && tabVisible(me, fStok)) tabs.push({ key: "stok", label: "Stok" });
  const aktif = pilihTab(tabs, tab) ?? "katalog";

  const kosong = (
    <EmptyState title="Belum ada item" description="Cermin item Accurate masih kosong — tunggu sinkron Accurate berikutnya." />
  );
  let isi: React.ReactNode;
  if (aktif === "stok") {
    const items = await getItems<InventoryItem>();
    isi = !items ? null : items.length === 0 ? kosong : <InventoryTable items={items} />;
  } else {
    const items = await getItems<AccurateItem>();
    isi = !items ? null : items.length === 0 ? kosong : <ProductsTable items={items} />;
  }

  return (
    <>
      <PageHeader title="Katalog & Stok (Accurate)" description="Katalog item, harga jual, dan stok (quantity & available) dari cermin Accurate." />
      <PageTabs tabs={tabs.length ? tabs : [{ key: "katalog", label: "Katalog" }]} aktif={aktif} />
      <Card>
        <CardContent className="pt-6">
          {isi ?? <EmptyState title="Data tidak tersedia" description="Data item gagal dimuat. Coba muat ulang halaman." />}
        </CardContent>
      </Card>
    </>
  );
}
