import { PageHeader } from "@/components/dashboard/page-header";
import { PageTabs } from "@/components/layout/page-tabs";
import { sessionUser } from "@/lib/admin-guard";
import { findNavItem, navOwnVisible, tabVisible } from "@/lib/nav";
import { pilihTab, type DefTab } from "@/lib/page-tabs";
import { AtkMasterSection } from "./master-section";
import { AtkMasukSection } from "./masuk-section";
import { AtkOpnameSection } from "./opname-section";

export const dynamic = "force-dynamic";

// Kelola ATK (K5 opsi B, evaluasi menu 19 Nov 2026): ATK Master, Stock In, dan Stock
// Opname — pekerjaan tim GA — dilebur jadi satu menu tiga tab. Stock Out sengaja
// TETAP menu sendiri ("Ambil ATK", self-service karyawan, F49): karyawan tak pernah
// masuk ke halaman milik GA. Izin tetap tiga key; hanya tab aktif mengambil data.
export default async function KelolaAtkPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const [{ tab }, me] = await Promise.all([searchParams, sessionUser()]);
  const induk = findNavItem("/atk-master");
  const f = (k: string) => induk?.features?.find((x) => x.key === k);
  const tabs: DefTab[] = [];
  if (!induk || navOwnVisible(me, induk)) tabs.push({ key: "master", label: "Master Barang" });
  const fMasuk = f("atk-stock-in");
  if (fMasuk && tabVisible(me, fMasuk)) tabs.push({ key: "masuk", label: "Barang Masuk" });
  const fOpname = f("atk-stock-opname");
  if (fOpname && tabVisible(me, fOpname)) tabs.push({ key: "opname", label: "Stock Opname" });
  const aktif = pilihTab(tabs, tab) ?? "master";

  return (
    <>
      <PageHeader
        title="Kelola ATK"
        description="Pekerjaan tim GA untuk ATK & Materai: master barang/kategori/pemasok, pencatatan barang masuk dengan audit mutasi, dan hitung fisik (stock opname). Pengambilan barang oleh karyawan ada di menu Ambil ATK."
      />
      <PageTabs tabs={tabs.length ? tabs : [{ key: "master", label: "Master Barang" }]} aktif={aktif} />
      {aktif === "masuk" ? <AtkMasukSection /> : aktif === "opname" ? <AtkOpnameSection /> : <AtkMasterSection />}
    </>
  );
}
