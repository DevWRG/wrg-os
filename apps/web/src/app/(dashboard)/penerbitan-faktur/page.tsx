import { sessionUser } from "@/lib/admin-guard";
import { featureAllowed } from "@/lib/feature-guard";
import { PageHeader } from "@/components/dashboard/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { PenerbitanFakturView } from "@/components/penerbitan-faktur/penerbitan-faktur-view";

export const dynamic = "force-dynamic";

// F10 Penerbitan Faktur (alarm fakturis diam). Data dimuat di klien; gerbang rute di layout
// + gerbang BFF per aksi.
export default async function PenerbitanFakturPage() {
  const me = await sessionUser();
  if (!me || !featureAllowed(me, "/penerbitan-faktur", "view")) {
    return (
      <>
        <PageHeader title="Penerbitan Faktur" />
        <EmptyState title="Tidak punya akses" description="Menu ini dibuka lewat matriks Akses Grup." />
      </>
    );
  }
  return (
    <>
      <PageHeader
        title="Penerbitan Faktur"
        description="Memantau apakah faktur penjualan masih terbit di Accurate. Kalau di jam kerja lama tidak ada faktur baru (komputer atau akun fakturis bermasalah), grup Finance diberi tahu."
      />
      <PenerbitanFakturView bolehUbah={featureAllowed(me, "/penerbitan-faktur", "edit")} />
    </>
  );
}
