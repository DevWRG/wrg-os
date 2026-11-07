import { sessionUser } from "@/lib/admin-guard";
import { featureAllowed } from "@/lib/feature-guard";
import { PageHeader } from "@/components/dashboard/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { DoBelumFakturView } from "@/components/do-belum-faktur/do-belum-faktur-view";

export const dynamic = "force-dynamic";

// F149 (dipersempit) DO Belum Difaktur. Data dimuat di klien; gerbang rute di layout
// + gerbang BFF per aksi.
export default async function DoBelumFakturPage() {
  const me = await sessionUser();
  if (!me || !featureAllowed(me, "/do-belum-faktur", "view")) {
    return (
      <>
        <PageHeader title="DO Belum Difaktur" />
        <EmptyState title="Tidak punya akses" description="Menu ini dibuka lewat matriks Akses Grup." />
      </>
    );
  }
  return (
    <>
      <PageHeader
        title="DO Belum Difaktur"
        description="Surat Jalan / DO yang barangnya sudah dikirim tapi belum dibuatkan faktur di Accurate — tagihannya tertunda. Disalin dari Accurate beberapa kali sehari; yang lewat ambang hari kerja ditandai terlambat."
      />
      <DoBelumFakturView bolehUbah={featureAllowed(me, "/do-belum-faktur", "edit")} />
    </>
  );
}
