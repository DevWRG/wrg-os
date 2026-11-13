import { sessionUser } from "@/lib/admin-guard";
import { featureAllowed } from "@/lib/feature-guard";
import { PageHeader } from "@/components/dashboard/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { ProyekView } from "@/components/proyek-hd/proyek-view";

export const dynamic = "force-dynamic";

// Proyek HD — tracker proyek hemodialisa (KSO) Deal → layanan berjalan. Data dimuat di
// klien; gerbang rute di layout + gerbang BFF per aksi. Tombol hanya tampil bila boleh.
export default async function ProyekHdPage() {
  const me = await sessionUser();
  if (!me || !featureAllowed(me, "/proyek-hd", "view")) {
    return (
      <>
        <PageHeader title="Proyek HD" />
        <EmptyState title="Tidak punya akses" description="Menu ini dibuka lewat matriks Akses Grup." />
      </>
    );
  }
  return (
    <>
      <PageHeader
        title="Proyek HD"
        description="Pantau tiap proyek hemodialisa (KSO) dari Deal sampai layanan berjalan: tahap, catatan & lampiran, unit terinstal/running, dan Simulator HD."
      />
      <ProyekView
        bolehBuat={featureAllowed(me, "/proyek-hd", "create")}
        bolehParam
      />
    </>
  );
}
