import { PageHeader } from "@/components/dashboard/page-header";
import { RaportView } from "@/components/raport/raport-view";

export const dynamic = "force-dynamic";

// Raport Saya — setiap karyawan hanya melihat kinerjanya sendiri (identitas dari
// sesi login; data di-scope di BFF + apps/api).
export default function RaportSayaPage() {
  return (
    <>
      <PageHeader
        title="Raport Saya"
        description="Scorecard kinerja pribadi — plan & report, KPI/BSC, absensi, coaching (revenue & AR untuk AM)."
      />
      <RaportView endpoint="/api/raport/me" />
    </>
  );
}
