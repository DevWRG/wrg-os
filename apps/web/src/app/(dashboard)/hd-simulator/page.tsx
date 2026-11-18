import { sessionUser } from "@/lib/admin-guard";
import { featureAllowed } from "@/lib/feature-guard";
import { canAturParamHd, canLihatMarginHd } from "@/lib/proyek-hd-access";
import { PageHeader } from "@/components/dashboard/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { SimulatorHd } from "@/components/proyek-hd/simulator-hd";

export const dynamic = "force-dynamic";

// Simulator HD — menu sendiri seperti Simulator KSO (kunci 'hd-simulator'). Tab Proyeksi RS
// untuk yang boleh membuka menu; tab Margin WRG hanya kunci 'proyek-hd-margin' (BFF juga tak
// mengirim data margin ke selain itu).
export default async function SimulatorHdPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await sessionUser();
  if (!me || !featureAllowed(me, "/hd-simulator", "view")) {
    return (
      <>
        <PageHeader title="Simulator KSO HD" />
        <EmptyState title="Tidak punya akses" description="Menu ini dibuka lewat matriks Akses Grup." />
      </>
    );
  }
  const sp = await searchParams;
  const proyek = typeof sp.proyek === "string" && /^\d{1,12}$/.test(sp.proyek) ? sp.proyek : null;
  return (
    <>
      <PageHeader
        title="Simulator KSO HD"
        description="Evaluasi calon mitra hemodialisa: proyeksi tindakan & omset untuk RS, dan (internal) biaya serta margin WRG per tindakan."
      />
      <SimulatorHd
        key={proyek ?? "-"}
        proyekId={proyek}
        bolehMargin={canLihatMarginHd(me)}
        bolehSimpan={featureAllowed(me, "/hd-simulator", "create")}
        bolehParam={canAturParamHd(me)}
        tabAwal={sp.tab === "margin" ? "margin_wrg" : "proyeksi_rs"}
      />
    </>
  );
}
