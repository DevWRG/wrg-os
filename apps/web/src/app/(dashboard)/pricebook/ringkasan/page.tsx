import { redirect } from "next/navigation";

import { gatewayFetch } from "@/lib/gateway";
import { sessionUser } from "@/lib/admin-guard";
import { canViewPricebookSummary } from "@/lib/pricebook-access";
import { PageHeader } from "@/components/dashboard/page-header";
import { RingkasanTab } from "@/components/pricebook/pricebook-view";
import type { PricebookSummary } from "@/components/pricebook/pricebook-view";

export const dynamic = "force-dynamic";

// Ringkasan Price Book — bacaan portofolio untuk Direktur + HoD. Menu sendiri,
// bukan tab di /pricebook: pembacanya beda dari sales, dan menu terpisah bikin
// izinnya punya baris sendiri di matriks Akses Grup (tab tidak bisa dicentang).
//
// Gate rute juga ditegakkan layout dashboard lewat katalog NAV, tapi redirect di
// sini tetap ada sebagai jaring kedua: kalau nanti item menunya di-rename atau
// findNavItem gagal mencocokkan path, halaman ini tidak boleh telanjur merender
// (payload RSC ikut terkirim walau tampilannya kosong).
export default async function PricebookRingkasanPage() {
  const me = await sessionUser();
  if (!canViewPricebookSummary(me)) {
    redirect("/akses-ditolak?menu=Ringkasan%20Price%20Book");
  }

  let summary: PricebookSummary | null = null;
  try {
    const res = await gatewayFetch("/pricebook/summary");
    if (res.ok) summary = (await res.json()) as PricebookSummary;
  } catch {
    summary = null;
  }

  return (
    <>
      <PageHeader
        title="Ringkasan Price Book"
        description="Bacaan portofolio keagenan: nilai katalog per lini, sebaran brand & principal, tier diskon, rentang harga, konsentrasi principal, dan cakupan terhadap item Accurate. Tanpa HPP/margin. (F142)"
      />
      <RingkasanTab s={summary} />
    </>
  );
}
