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

// Kolom urut yang diterima backend (ITEM_SORTS di apps/api repo/accurateMirror.ts);
// tab Katalog hanya punya 4 kolom, tab Stok semuanya.
const SORTS_KATALOG = ["no", "name", "category", "harga"];
const SORTS_STOK = ["no", "name", "category", "harga", "quantity", "available", "unit", "status"];
const PAGE_SIZES = [10, 25, 50, 100];
const DEFAULT_SIZE = 25;

interface ItemPage<T> { total_rows: number; rows: T[] }

// Satu halaman item dari backend (cari/urut/halaman di SQL). Dulu seluruh
// katalog (±5.900 item, limit 10.000) dikirim ke browser.
async function getItems<T>(qs: URLSearchParams): Promise<ItemPage<T> | null> {
  try {
    const res = await gatewayFetch(`/accurate/items/list?${qs.toString()}`);
    if (!res.ok) return null;
    const data = (await res.json()) as Partial<ItemPage<T>>;
    return { total_rows: Number(data.total_rows ?? 0), rows: data.rows ?? [] };
  } catch {
    return null;
  }
}

// Katalog & Stok (Accurate) (K2, evaluasi menu 19 Nov 2026): Products dan Inventory
// membaca sumber yang sama (cermin accurate_item), hanya kolomnya beda — dilebur
// jadi dua tab. Izin tetap dua key: tab Katalog = `products` (induk), tab Stok =
// `inventory` (entri features; /inventory → ?tab=stok). Harga di sini harga JUAL.
export default async function KatalogStokPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; q?: string; sort?: string; dir?: string; page?: string; size?: string }>;
}) {
  const [sp, me] = await Promise.all([searchParams, sessionUser()]);
  const { tab } = sp;
  const induk = findNavItem("/products");
  const fStok = induk?.features?.find((f) => f.key === "inventory");
  const tabs: DefTab[] = [];
  if (!induk || navOwnVisible(me, induk)) tabs.push({ key: "katalog", label: "Katalog" });
  if (fStok && tabVisible(me, fStok)) tabs.push({ key: "stok", label: "Stok" });
  const aktif = pilihTab(tabs, tab) ?? "katalog";

  const sorts = aktif === "stok" ? SORTS_STOK : SORTS_KATALOG;
  const query = {
    q: (sp.q ?? "").trim(),
    sort: sorts.includes(sp.sort ?? "") ? sp.sort! : "name",
    dir: (sp.dir === "desc" ? "desc" : "asc") as "asc" | "desc",
    size: PAGE_SIZES.includes(Number(sp.size)) ? Number(sp.size) : DEFAULT_SIZE,
    page: Math.max(0, Math.trunc(Number(sp.page)) || 0),
  };
  const qs = new URLSearchParams();
  if (query.q) qs.set("q", query.q);
  qs.set("sort", query.sort);
  qs.set("dir", query.dir);
  qs.set("limit", String(query.size));
  qs.set("offset", String(query.page * query.size));

  const kosong = (
    <EmptyState title="Belum ada item" description="Cermin item Accurate masih kosong — tunggu sinkron Accurate berikutnya." />
  );
  let isi: React.ReactNode;
  // Katalog benar-benar kosong (bukan cuma tak cocok kata kunci) → pesan sinkron.
  const benarKosong = (r: ItemPage<unknown>) => r.total_rows === 0 && !query.q;
  if (aktif === "stok") {
    const r = await getItems<InventoryItem>(qs);
    isi = !r ? null : benarKosong(r) ? kosong : <InventoryTable items={r.rows} totalRows={r.total_rows} query={query} />;
  } else {
    const r = await getItems<AccurateItem>(qs);
    isi = !r ? null : benarKosong(r) ? kosong : <ProductsTable items={r.rows} totalRows={r.total_rows} query={query} />;
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
