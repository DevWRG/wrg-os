import { redirect } from "next/navigation";

import { sessionUser } from "@/lib/admin-guard";
import { canViewAdoption } from "@/lib/adoption-access";
import { PageHeader } from "@/components/dashboard/page-header";
import { AdoptionView } from "@/components/adoption/adoption-view";

export const dynamic = "force-dynamic";

// Adopsi Fitur (F58) — champion vs laggard pemakaian fitur → daftar "perlu training".
// Hanya untuk adopsi & training, BUKAN KPI/NPK. Gate rute juga ditegakkan layout via NAV;
// redirect di sini jaring kedua (payload RSC tak boleh terkirim ke yang tak berhak).
export default async function AdoptionPage() {
  const me = await sessionUser();
  if (!canViewAdoption(me)) redirect("/akses-ditolak?menu=Adopsi%20Fitur");
  return (
    <>
      <PageHeader
        title="Adopsi Fitur"
        description="Siapa yang aktif memakai fitur dan siapa yang perlu training. Dinilai dari AKSI (bukan sekadar membuka halaman), dibanding sesama jabatan yang berizin fitur itu. Untuk adopsi & training — bukan penilaian kinerja. (F58)"
      />
      <AdoptionView />
    </>
  );
}
