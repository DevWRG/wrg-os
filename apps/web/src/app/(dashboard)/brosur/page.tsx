import { gatewayFetch } from "@/lib/gateway";
import { sessionUser } from "@/lib/admin-guard";
import { featureAllowed } from "@/lib/feature-guard";
import { PageHeader } from "@/components/dashboard/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { BrosurView } from "@/components/brosur/brosur-view";
import type { Materi } from "@/components/brosur/types";

export const dynamic = "force-dynamic";

// F130 Brosur & Video — brosur diunggah dari sini (file disimpan di Google
// Drive, dibuka "siapa pun dengan tautan"), video = tautan YouTube/Drive.
export default async function BrosurPage() {
  const me = await sessionUser();
  if (!me || !featureAllowed(me, "/brosur", "view")) {
    return (
      <>
        <PageHeader title="Brosur & Video" />
        <EmptyState title="Tidak punya akses" description="Menu ini dibuka lewat matriks Akses Grup." />
      </>
    );
  }
  const bolehUbah = featureAllowed(me, "/brosur", "edit");
  let data: Materi[] | null = null;
  let driveSiap = false;
  try {
    const res = await gatewayFetch(`/materi${bolehUbah ? "?semua=1" : ""}`, { headers: { "x-user-id": me.id } });
    if (res.ok) {
      const d = (await res.json()) as { materi: Materi[]; drive_siap: boolean };
      data = d.materi;
      driveSiap = d.drive_siap;
    }
  } catch { data = null; }

  return (
    <>
      <PageHeader title="Brosur & Video" description="Brosur produk (file di Google Drive) dan video training per produk — siap diteruskan ke customer." />
      {!data
        ? <EmptyState title="Backend tidak terjangkau" description="Coba muat ulang beberapa saat lagi." />
        : <BrosurView data={data} driveSiap={driveSiap} bolehTambah={featureAllowed(me, "/brosur", "create")} bolehUbah={bolehUbah} />}
    </>
  );
}
