import { gatewayFetch } from "@/lib/gateway";
import { sessionUser } from "@/lib/admin-guard";
import { canViewKsoKomite } from "@/lib/kso-komite-access";
import { PageHeader } from "@/components/dashboard/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { KomiteView } from "@/components/kso-komite/komite-view";
import type { TabBoleh } from "@/components/kso-komite/types";

export const dynamic = "force-dynamic";

// F170 Komite KSO (Tahap 4). Tab yang tampil = keputusan apps/api (/kso-komite/tab), bukan
// tebakan di sini: API memegang peta tab → fitur Akses Grup → peran database, dan memeriksa
// ulang setiap permintaan. Gate rute di layout sudah memastikan minimal satu tab boleh.
export default async function KsoKomitePage() {
  const me = await sessionUser();
  if (!me || !canViewKsoKomite(me)) {
    return (
      <>
        <PageHeader title="Komite KSO" />
        <EmptyState title="Tidak punya akses" description="Tab Komite KSO dibuka per peran lewat matriks Akses Grup." />
      </>
    );
  }
  let tabs: TabBoleh[] | null = null;
  let bottomLine = false;
  try {
    const [res, bl] = await Promise.all([
      gatewayFetch("/kso-komite/tab", { headers: { "x-user-id": me.id } }),
      // F172 Bottom Line Alat — izin fitur sendiri, diputuskan API (repo/kso-komite-bottomline.ts)
      gatewayFetch("/kso-komite/bottom-line/akses", { headers: { "x-user-id": me.id } }),
    ]);
    if (res.ok) tabs = ((await res.json()) as { tab: TabBoleh[] }).tab;
    if (bl.ok) bottomLine = ((await bl.json()) as { lihat: boolean }).lihat;
  } catch { tabs = null; }

  return (
    <>
      <PageHeader
        title="Komite KSO"
        description="Rencana KSO dari WhatsApp AM: tujuh gerbang, putusan HOD atau forum, mandat Direksi, penawaran, dan serah terima."
      />
      {tabs === null
        ? <EmptyState title="Backend tidak terjangkau" description="Coba muat ulang beberapa saat lagi." />
        : tabs.length === 0 && !bottomLine
          ? <EmptyState title="Belum ada tab yang terbuka" description="Akun ini belum tertaut ke AM/HOD atau belum diberi peran Komite KSO di Akses Grup." />
          : <KomiteView tabs={tabs} bottomLine={bottomLine} />}
    </>
  );
}
