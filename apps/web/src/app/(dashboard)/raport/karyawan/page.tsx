import { PageHeader } from "@/components/dashboard/page-header";
import { RaportList } from "@/components/raport/raport-list";
import { sessionUser } from "@/lib/admin-guard";
import { canViewRaportList } from "@/lib/raport-access";

export const dynamic = "force-dynamic";

// List Raport Karyawan — untuk HoD/admin, melihat semua karyawan. Gate di WEB
// (sidebar + halaman) & ditegakkan lagi di BFF/apps/api.
export default async function RaportKaryawanPage() {
  const me = await sessionUser();
  if (!canViewRaportList(me)) {
    return (
      <>
        <PageHeader title="Raport Karyawan" description="Daftar raport seluruh karyawan." />
        <p className="text-muted-foreground">Hanya HoD/admin yang dapat mengakses halaman ini.</p>
      </>
    );
  }
  return (
    <>
      <PageHeader
        title="Raport Karyawan"
        description="Daftar scorecard seluruh karyawan — klik nama untuk raport lengkap."
      />
      <RaportList />
    </>
  );
}
