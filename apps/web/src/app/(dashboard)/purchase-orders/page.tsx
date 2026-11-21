import { PageHeader } from "@/components/dashboard/page-header";
import { PageTabs } from "@/components/layout/page-tabs";
import { sessionUser } from "@/lib/admin-guard";
import { findNavItem, navOwnVisible, tabVisible } from "@/lib/nav";
import { pilihTab, type DefTab } from "@/lib/page-tabs";
import { InboundSection } from "./inbound-section";
import { PoSection, type PoSearchParams } from "./po-section";

export const dynamic = "force-dynamic";

// PO & Penerimaan Barang (K3, evaluasi menu 19 Nov 2026): PO Tracker dan Inbound
// Receiving dilebur jadi dua tab — satu alur PO → barang diterima. Izin tetap dua
// key: tab PO = `purchase-orders` (izin induk), tab Penerimaan = `inbound-receiving`
// (entri features, path lama /inbound-receiving di-redirect ke ?tab=penerimaan).
// Hanya tab yang diizinkan yang dirender, dan hanya tab AKTIF yang mengambil data.
export default async function PoPenerimaanPage({ searchParams }: { searchParams: Promise<PoSearchParams & { tab?: string }> }) {
  const sp = await searchParams;
  const me = await sessionUser();
  const induk = findNavItem("/purchase-orders");
  const fPenerimaan = induk?.features?.find((f) => f.key === "inbound-receiving");

  const tabs: DefTab[] = [];
  if (induk && navOwnVisible(me, induk)) tabs.push({ key: "po", label: "PO ke Vendor" });
  if (fPenerimaan && tabVisible(me, fPenerimaan)) tabs.push({ key: "penerimaan", label: "Checklist Penerimaan" });
  // Gerbang rute sudah menolak yang tak punya keduanya; fallback aman untuk mode
  // izin tak tersedia (auth mati) — tampilkan PO seperti perilaku lama.
  const aktif = pilihTab(tabs, sp.tab) ?? "po";
  const daftar = tabs.length ? tabs : [{ key: "po", label: "PO ke Vendor" }];

  return (
    <>
      <PageHeader
        title="PO & Penerimaan Barang"
        description="Pantau PO ke vendor sampai barang diterima & dicek gudang. PO, approval, dan penerimaan dibuat di Accurate — halaman ini menyalinnya otomatis."
      />
      <PageTabs tabs={daftar} aktif={aktif} />
      {aktif === "penerimaan" ? <InboundSection q={sp.q} /> : <PoSection sp={sp} />}
    </>
  );
}
