import { sessionUser } from "@/lib/admin-guard";
import { actorName, featureAllowed } from "@/lib/feature-guard";
import { PageHeader } from "@/components/dashboard/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { RegisterCekView } from "@/components/register-cek/register-cek-view";

export const dynamic = "force-dynamic";

// F10 Register Cek keluar (ambil alih F29). Data dimuat di klien; gerbang rute di layout + gerbang BFF per aksi.
export default async function RegisterCekPage() {
  const me = await sessionUser();
  if (!me || !featureAllowed(me, "/register-cek", "view")) {
    return (
      <>
        <PageHeader title="Register Cek" />
        <EmptyState title="Tidak punya akses" description="Menu ini dibuka lewat matriks Akses Grup." />
      </>
    );
  }
  return (
    <>
      <PageHeader
        title="Register Cek"
        description="Catatan cek & giro yang diterbitkan WRG: diajukan kasir, disetujui HoD Finance, lalu diserahkan dan dipantau sampai cair. Saldo pembanding diambil dari rekening koran terakhir (#KORAN)."
      />
      <RegisterCekView
        bolehInput={featureAllowed(me, "/register-cek", "create")}
        bolehSetujui={featureAllowed(me, "/register-cek", "edit")}
        saya={actorName(me)}
      />
    </>
  );
}
