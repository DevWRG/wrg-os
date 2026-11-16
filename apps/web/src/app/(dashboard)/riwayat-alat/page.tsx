import { sessionUser } from "@/lib/admin-guard";
import { canViewRiwayatAlat } from "@/lib/riwayat-alat-access";
import { PageHeader } from "@/components/dashboard/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { RiwayatAlatView } from "@/components/riwayat-alat/riwayat-alat-view";

export const dynamic = "force-dynamic";

// F176 Riwayat Alat (Aftersales): riwayat PM / servis / install per alat (SN), ikut alatnya ke faskes mana pun
// ia dipasang. Sumber: #REPORT teknisi, Google Form "Kegiatan Teknisi" (impor), jadwal rutin, PM & Kalibrasi.
export default async function RiwayatAlatPage() {
  const me = await sessionUser();
  if (!canViewRiwayatAlat(me)) {
    return (
      <>
        <PageHeader title="Riwayat Alat" />
        <EmptyState title="Tidak punya akses" description="Fitur ini dibuka lewat matriks Akses Grup." />
      </>
    );
  }
  return (
    <>
      <PageHeader
        title="Riwayat Alat"
        description="Riwayat maintenance, servis, install, dan kalibrasi per alat (SN) — di faskes mana pun alat itu pernah dipasang."
      />
      <RiwayatAlatView />
    </>
  );
}
