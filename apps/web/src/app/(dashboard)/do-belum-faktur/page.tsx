import { sessionUser } from "@/lib/admin-guard";
import { featureAllowed } from "@/lib/feature-guard";
import { pilihTab, type DefTab } from "@/lib/page-tabs";
import { PageHeader } from "@/components/dashboard/page-header";
import { PageTabs } from "@/components/layout/page-tabs";
import { EmptyState } from "@/components/ui/empty-state";
import { DoBelumFakturView } from "@/components/do-belum-faktur/do-belum-faktur-view";
import { PenerbitanFakturView } from "@/components/penerbitan-faktur/penerbitan-faktur-view";

export const dynamic = "force-dynamic";

// Faktur (K7, evaluasi menu 19 Nov 2026): DO Belum Difaktur (F149) dan Penerbitan
// Faktur (F10) dilebur jadi satu meja kerja fakturis, dua tab. Izin tetap dua key:
// tab DO = `do-belum-faktur` (izin induk), tab Penerbitan = `penerbitan-faktur`
// (entri features, /penerbitan-faktur di-redirect ke ?tab=penerbitan). featureAllowed
// ke path masing-masing = gerbang yang sama dengan BFF-nya. Data dimuat di klien
// oleh view masing-masing, jadi hanya tab aktif yang memuat data.
export default async function FakturPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const [{ tab }, me] = await Promise.all([searchParams, sessionUser()]);
  const bolehDo = !!me && featureAllowed(me, "/do-belum-faktur", "view");
  const bolehTerbit = !!me && featureAllowed(me, "/penerbitan-faktur", "view");

  const tabs: DefTab[] = [];
  if (bolehDo) tabs.push({ key: "do", label: "DO Belum Difaktur" });
  if (bolehTerbit) tabs.push({ key: "penerbitan", label: "Penerbitan & Revisi Faktur" });
  const aktif = pilihTab(tabs, tab);

  return (
    <>
      <PageHeader
        title="Faktur"
        description="Meja kerja fakturis: DO/Surat Jalan yang sudah dikirim tapi belum difaktur, alarm penerbitan faktur di jam kerja, beban akun fakturis, dan permintaan revisi faktur beserta SLA-nya. Disalin dari Accurate beberapa kali sehari."
      />
      {!aktif || !me ? (
        <EmptyState title="Tidak punya akses" description="Menu ini dibuka lewat matriks Akses Grup." />
      ) : (
        <>
          <PageTabs tabs={tabs} aktif={aktif} />
          {aktif === "penerbitan" ? (
            <PenerbitanFakturView bolehUbah={featureAllowed(me, "/penerbitan-faktur", "edit")} />
          ) : (
            <DoBelumFakturView bolehUbah={featureAllowed(me, "/do-belum-faktur", "edit")} />
          )}
        </>
      )}
    </>
  );
}
