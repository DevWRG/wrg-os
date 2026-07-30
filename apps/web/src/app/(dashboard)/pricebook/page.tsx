import { gatewayFetch } from "@/lib/gateway";
import { sessionUser } from "@/lib/admin-guard";
import { canViewPricebook, canViewPricebookSummary } from "@/lib/pricebook-access";
import { canViewPricelist } from "@/lib/pricelist-access";
import { PageHeader } from "@/components/dashboard/page-header";
import { PricebookView, type PricebookTabKey } from "@/components/pricebook/pricebook-view";
import type { PricebookItem, PricebookSummary } from "@/components/pricebook/pricebook-view";
import { toAmRow, type PricelistRow } from "@/lib/pricelist";

export const dynamic = "force-dynamic";

// Menu harga untuk SALES: katalog keagenan (071) + harga produk Accurate
// terpublikasi (043) + item di luar keagenan. Ringkasan portofolio dan Setup
// HPP/margin ada di menu sendiri (/pricebook/ringkasan, /pricebook/setup) karena
// pembacanya beda — lihat lib/pricebook-access.ts.
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

const TAB_VALID: PricebookTabKey[] = ["katalog", "harga", "luar"];

export default async function PricebookPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const me = await sessionUser();
  const bolehKatalog = canViewPricebook(me);
  const bolehHarga = canViewPricelist(me);

  const [items, summary, harga] = await Promise.all([
    bolehKatalog ? get<{ rows: PricebookItem[] }>("/pricebook/items?limit=20000") : null,
    // Dipakai hanya untuk statistik cakupan di tab Di Luar Keagenan. Endpoint-nya
    // sama dengan yang dipakai menu Ringkasan, jadi ikut hak yang sama.
    canViewPricebookSummary(me) ? get<PricebookSummary>("/pricebook/summary") : null,
    bolehHarga ? get<{ rows: PricelistRow[] }>("/pricelist?status=published") : null,
  ]);

  // toAmRow membuang hpp / margin_pct / alokasi insentif DI SERVER. Kalau baris
  // mentah diteruskan ke komponen klien, HPP & margin ikut ter-serialisasi ke HTML
  // dan payload RSC milik AM — terbaca lewat view-source walau tak ada kolomnya.
  const hargaPanel = bolehHarga && harga ? { rows: (harga.rows ?? []).map(toAmRow) } : null;

  const tabParam = (await searchParams)?.tab;
  const initialTab = TAB_VALID.find((t) => t === tabParam);

  return (
    <>
      <PageHeader
        title="Price Book & Pricelist"
        description="Harga yang boleh dikutip ke faskes: katalog keagenan (Price List · Diskon Maks · Nett terendah lantai · Nett+PPN 11%) dan harga produk Accurate terpublikasi. Item Accurate di luar katalog keagenan ditandai terpisah. (F142)"
      />
      <PricebookView
        items={bolehKatalog ? (items?.rows ?? null) : null}
        summary={summary}
        harga={hargaPanel}
        initialTab={initialTab}
      />
    </>
  );
}
