import { gatewayFetch } from "@/lib/gateway";
import { sessionUser } from "@/lib/admin-guard";
import { canViewPricebook } from "@/lib/pricebook-access";
import { canViewPricelist } from "@/lib/pricelist-access";
import { PageHeader } from "@/components/dashboard/page-header";
import { PricebookView, type PricebookTabKey } from "@/components/pricebook/pricebook-view";
import type { PublishedRow } from "@/components/pricebook/pricebook-view";
import type { PricebookItem } from "@/components/pricebook/pricebook-view";

export const dynamic = "force-dynamic";

// Menu harga untuk SALES: katalog keagenan (071) + harga keagenan yang sudah
// DIPUBLIKASIKAN HoD Business dari Setup Harga (073). Sejak 1 Agt 2026 menu ini
// fokus produk keagenan: tab "Di Luar Keagenan" dilepas dan "Harga per Produk"
// tidak lagi mengambil tabel Accurate 043. Ringkasan portofolio & Setup HPP ada
// di menu sendiri (/pricebook/ringkasan, /pricebook/setup) karena pembacanya beda.
//
// Gate rute ditegakkan layout dashboard lewat katalog NAV (fitur 'pricebook' ATAU
// 'pricelist' — lihat NavItem.features di lib/nav.ts). Di sini gate-nya per-tab, dan
// yang menegakkan bukan tampilan: data yang user tak berhak lihat TIDAK diambil.
async function get<T>(path: string): Promise<T | null> {
  try {
    const res = await gatewayFetch(path);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

const TAB_VALID: PricebookTabKey[] = ["katalog", "harga"];

export default async function PricebookPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const me = await sessionUser();
  const bolehKatalog = canViewPricebook(me);
  const bolehHarga = canViewPricelist(me);

  // Ringkasan portofolio tidak lagi diambil di sini — pemakainya (tab Di Luar
  // Keagenan) sudah dilepas, dan menu Ringkasan Price Book punya halaman sendiri.
  const [items, harga] = await Promise.all([
    bolehKatalog ? get<{ rows: PricebookItem[] }>("/pricebook/items?limit=20000") : null,
    // Endpoint ini SUDAH tanpa hpp/margin (dibatasi di query, lihat
    // repo/pricebook.ts listPublishedKeagenan) — tak ada lagi penyaringan di
    // server yang bisa kelupaan seperti waktu sumbernya tabel 043.
    bolehHarga ? get<{ rows: PublishedRow[] }>("/pricebook/published?limit=20000") : null,
  ]);

  const hargaPanel = bolehHarga && harga ? { rows: harga.rows ?? [] } : null;

  const tabParam = (await searchParams)?.tab;
  const initialTab = TAB_VALID.find((t) => t === tabParam);

  return (
    <>
      <PageHeader
        title="Price Book & Pricelist"
        description="Harga keagenan yang boleh dikutip ke faskes: Price List · Diskon Maks · Nett terendah (lantai) · Nett+PPN 11%. Tab Harga per Produk = yang sudah dipublikasikan HoD Business. (F142)"
      />
      <PricebookView
        items={bolehKatalog ? (items?.rows ?? null) : null}
        harga={hargaPanel}
        initialTab={initialTab}
      />
    </>
  );
}
