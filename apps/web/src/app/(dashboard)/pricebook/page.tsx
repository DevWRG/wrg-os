import { gatewayFetch } from "@/lib/gateway";
import { sessionUser } from "@/lib/admin-guard";
import { canViewPricebook, canViewPricebookSummary } from "@/lib/pricebook-access";
import {
  canEditPricelistSetup, canPublishPricelist, canViewPricelist,
} from "@/lib/pricelist-access";
import { PageHeader } from "@/components/dashboard/page-header";
import { PricebookView, type PricebookTabKey } from "@/components/pricebook/pricebook-view";
import type { PricebookItem, PricebookSummary } from "@/components/pricebook/pricebook-view";
import type {
  PricebookSetupRow, PricebookSetupSummary,
} from "@/components/pricelist/pricebook-setup-table";
import type { ProductOption } from "@/components/pricelist/pricelist-form-sheet";
import { toAmRow, type PricelistRow } from "@/lib/pricelist";

export const dynamic = "force-dynamic";

// Satu pintu untuk semua harga jual: Price Book keagenan (071) + Pricelist (043)
// + lapisan kroscek HPP (073) — dulu tiga menu untuk satu kebutuhan.
//
// Gate rute ditegakkan layout dashboard lewat katalog NAV (fitur 'pricebook' ATAU
// 'pricelist' — lihat NavItem.features di lib/nav.ts). Di sini gate-nya per-tab,
// dan yang menegakkan bukan tampilan: data yang user tak berhak lihat TIDAK
// diambil sama sekali. Paling penting untuk /pricebook/setup — isinya HPP & margin
// yang HANDOVER §1/§9 larang keluar ke sales.
async function get<T>(path: string): Promise<T | null> {
  try {
    const res = await gatewayFetch(path);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

const TAB_VALID: PricebookTabKey[] = ["ringkasan", "katalog", "harga", "setup", "luar"];

export default async function PricebookPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const me = await sessionUser();
  const bolehKatalog = canViewPricebook(me);
  const bolehRingkasan = canViewPricebookSummary(me);
  const bolehHarga = canViewPricelist(me);
  const bolehSetup = canEditPricelistSetup(me);

  const [items, summary, harga, setupPl, setupProd, setupPb] = await Promise.all([
    bolehKatalog ? get<{ rows: PricebookItem[] }>("/pricebook/items?limit=20000") : null,
    bolehRingkasan ? get<PricebookSummary>("/pricebook/summary") : null,
    bolehHarga ? get<{ rows: PricelistRow[] }>("/pricelist?status=published") : null,
    bolehSetup ? get<{ rows: PricelistRow[] }>("/pricelist") : null,
    bolehSetup
      ? get<{ rows: { id: string | number; no: string | null; name: string | null }[] }>(
        "/accurate/items?limit=10000")
      : null,
    bolehSetup
      ? get<{ rows: PricebookSetupRow[]; ringkas: PricebookSetupSummary }>("/pricebook/setup")
      : null,
  ]);

  const products: ProductOption[] = (setupProd?.rows ?? []).map((p) => ({
    id: String(p.id), no: p.no, name: p.name,
  }));

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
        description="Semua harga jual dalam satu menu: katalog harga keagenan (Price List · Diskon Maks · Nett terendah lantai · Nett+PPN 11%), harga produk Accurate terpublikasi, dan setup HPP/margin untuk yang berhak. Item Accurate di luar katalog keagenan ditandai terpisah. (F142)"
      />
      <PricebookView
        items={bolehKatalog ? (items?.rows ?? null) : null}
        summary={summary}
        canSummary={bolehRingkasan}
        harga={hargaPanel}
        setup={
          bolehSetup && setupPl
            ? {
              rows: setupPl.rows ?? [],
              products,
              canPublish: canPublishPricelist(me),
              pricebookRows: setupPb?.rows ?? null,
              pricebookRingkas: setupPb?.ringkas ?? null,
            }
            : null
        }
        initialTab={initialTab}
      />
    </>
  );
}
