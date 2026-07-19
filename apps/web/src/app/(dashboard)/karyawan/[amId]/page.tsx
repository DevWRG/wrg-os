import Link from "next/link";

import { PageHeader } from "@/components/dashboard/page-header";
import { RaportView } from "@/components/raport/raport-view";
import { sessionUser } from "@/lib/admin-guard";
import { canViewRaportList } from "@/lib/raport-access";

export const dynamic = "force-dynamic";

// Drilldown raport 1 karyawan (dari hub Karyawan 360) — HoD/admin.
export default async function KaryawanDetailPage({ params }: { params: Promise<{ amId: string }> }) {
  const { amId } = await params;
  const me = await sessionUser();
  if (!canViewRaportList(me)) {
    return (
      <>
        <PageHeader title="Karyawan 360" description="Raport karyawan." />
        <p className="text-muted-foreground">Hanya HoD/admin yang dapat mengakses halaman ini.</p>
      </>
    );
  }
  return (
    <>
      <PageHeader
        title="Karyawan 360"
        description="Scorecard lengkap karyawan."
        action={<Link href="/karyawan" className="text-primary text-sm hover:underline">← Kembali ke daftar</Link>}
      />
      <RaportView endpoint={`/api/raport/${encodeURIComponent(amId)}`} />
    </>
  );
}
