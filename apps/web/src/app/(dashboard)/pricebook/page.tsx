import { gatewayFetch } from "@/lib/gateway";
import { sessionUser } from "@/lib/admin-guard";
import { canViewPricelist } from "@/lib/pricelist-access";
import { PageHeader } from "@/components/dashboard/page-header";
import { PricebookView } from "@/components/pricebook/pricebook-view";
import type { PublishedRow } from "@/components/pricebook/pricebook-view";

export const dynamic = "force-dynamic";

// Menu harga untuk SALES: daftar harga keagenan yang sudah DIPUBLIKASIKAN HoD
// Business dari Setup Harga (073 di atas basis 071). Muka lain sudah dilepas
// bertahap: "Di Luar Keagenan" (1 Agt 2026) dan "Katalog" (10 Agt 2026, setelah
// sumber harga pindah ke file Compilation FINAL — katalog & terpublikasi jadi
// daftar yang sama). Ringkasan portofolio & Setup HPP ada di menu sendiri
// (/pricebook/ringkasan, /pricebook/setup) karena pembacanya beda.
//
// Gate rute ditegakkan layout dashboard lewat katalog NAV (fitur 'pricebook' ATAU
// 'pricelist' — lihat NavItem.features di lib/nav.ts). Di sini yang menegakkan
// bukan tampilan: data yang user tak berhak lihat TIDAK diambil.
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
  const bolehHarga = canViewPricelist(me);

  // Endpoint ini SUDAH tanpa hpp/margin (dibatasi di query — lihat
  // repo/pricebook.ts listPublishedKeagenan), jadi tak ada penyaringan di server
  // yang bisa kelupaan seperti dulu waktu sumbernya tabel 043.
  const harga = bolehHarga
    ? await get<{ rows: PublishedRow[] }>("/pricebook/published?limit=20000")
    : null;

  const hargaPanel = bolehHarga && harga ? { rows: harga.rows ?? [] } : null;

  return (
    <>
      <PageHeader
        title="Price Book & Pricelist"
        description="Harga keagenan yang boleh dikutip ke faskes — yang sudah dipublikasikan HoD Business dari Setup Harga: Price List · Diskon Maks · Nett terendah (lantai) · Nett+PPN 11%. (F142)"
      />
      <PricebookView harga={hargaPanel} />
    </>
  );
}
