import Link from "next/link";

import { PageHeader } from "@/components/dashboard/page-header";
import { RaportView } from "@/components/raport/raport-view";
import { sessionUser } from "@/lib/admin-guard";
import { canViewRaportList } from "@/lib/raport-access";

export const dynamic = "force-dynamic";

// Drilldown raport 1 karyawan (dari daftar) — HoD/admin.
export default async function RaportKaryawanDetailPage({ params }: { params: Promise<{ amId: string }> }) {
  const { amId } = await params;
  const me = await sessionUser();
  if (!canViewRaportList(me)) {
    return (
      <>
        <PageHeader title="Raport Karyawan" description="Raport karyawan." />
        <p className="text-muted-foreground">Hanya HoD/admin yang dapat mengakses halaman ini.</p>
      </>
    );
  }
  return (
    <>
      <PageHeader
        title="Raport Karyawan"
        description="Scorecard lengkap karyawan."
        action={<Link href="/raport/karyawan" className="text-primary text-sm hover:underline">← Kembali ke daftar</Link>}
      />
      <RaportView endpoint={`/api/raport/${encodeURIComponent(amId)}`} />
    </>
  );
}
