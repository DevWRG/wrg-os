import { gatewayFetch } from "@/lib/gateway";
import { sessionUser } from "@/lib/admin-guard";
import { canEditKsoKontrak, canViewKsoKontrak } from "@/lib/kso-kontrak-access";
import { PageHeader } from "@/components/dashboard/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { KontrakView } from "@/components/kso-kontrak/kontrak-view";
import type { DaftarKontrak, Kelengkapan } from "@/components/kso-kontrak/types";

export const dynamic = "force-dynamic";

// F47 Kontrak KSO & Renewal (fase 1). Kunci izin sendiri 'kso-kontrak'
// (view = lihat papan, edit = ubah kontrak) — lihat lib/kso-kontrak-access.ts.
// Fase 2 (belum): alert WA 30/60/90/120 hari, realisasi volume vs MMV,
// penalti NPK, draf surat perpanjangan.
export default async function KsoKontrakPage() {
  const me = await sessionUser();
  if (!canViewKsoKontrak(me)) {
    return (
      <>
        <PageHeader title="Kontrak KSO" />
        <EmptyState title="Tidak punya akses" description="Fitur ini dibuka lewat matriks Akses Grup." />
      </>
    );
  }
  let daftar: DaftarKontrak | null = null;
  let kelengkapan: Kelengkapan | null = null;
  try {
    const [a, b] = await Promise.all([gatewayFetch("/kso-kontrak"), gatewayFetch("/kso-kontrak/kelengkapan")]);
    if (a.ok) daftar = (await a.json()) as DaftarKontrak;
    if (b.ok) kelengkapan = (await b.json()) as Kelengkapan;
  } catch { daftar = null; }

  return (
    <>
      <PageHeader
        title="Kontrak KSO"
        description="Kontrak KSO per faskes: kapan MoU berakhir, status perpanjangan, dan data yang masih perlu dilengkapi."
      />
      {!daftar || !kelengkapan
        ? <EmptyState title="Backend tidak terjangkau" description="Coba muat ulang beberapa saat lagi." />
        : <KontrakView daftar={daftar} kelengkapan={kelengkapan} canEdit={canEditKsoKontrak(me)} />}
    </>
  );
}
