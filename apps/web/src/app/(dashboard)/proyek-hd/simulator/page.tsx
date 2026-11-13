import Link from "next/link";
import { sessionUser } from "@/lib/admin-guard";
import { featureAllowed } from "@/lib/feature-guard";
import { canLihatMarginHd } from "@/lib/proyek-hd-access";
import { PageHeader } from "@/components/dashboard/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { SimulatorHd } from "@/components/proyek-hd/simulator-hd";

export const dynamic = "force-dynamic";

// Simulator HD — tab Proyeksi RS (semua yang boleh lihat menu) + tab Margin WRG
// (kunci 'proyek-hd-margin' saja; BFF juga tak mengirim data margin ke selain itu).
export default async function SimulatorHdPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await sessionUser();
  if (!me || !featureAllowed(me, "/proyek-hd", "view")) {
    return (
      <>
        <PageHeader title="Simulator HD" />
        <EmptyState title="Tidak punya akses" description="Menu ini dibuka lewat matriks Akses Grup." />
      </>
    );
  }
  const sp = await searchParams;
  const proyek = typeof sp.proyek === "string" && /^\d{1,12}$/.test(sp.proyek) ? sp.proyek : null;
  return (
    <>
      <PageHeader
        title="Simulator HD"
        description="Evaluasi calon mitra: proyeksi tindakan & omset untuk RS, dan (internal) biaya serta margin WRG per tindakan."
        action={<Link href={proyek ? `/proyek-hd/${proyek}` : "/proyek-hd"} className="text-primary text-sm font-semibold">← Kembali</Link>}
      />
      <SimulatorHd
        key={proyek ?? "-"}
        proyekId={proyek}
        bolehMargin={canLihatMarginHd(me)}
        bolehSimpan={featureAllowed(me, "/proyek-hd", "edit")}
        tabAwal={sp.tab === "margin" ? "margin_wrg" : "proyeksi_rs"}
      />
    </>
  );
}
