import { gatewayFetch } from "@/lib/gateway";
import { sessionUser } from "@/lib/admin-guard";
import { canViewKso } from "@/lib/kso-access";
import { PageHeader } from "@/components/dashboard/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { KsoAlatView, type KsoAlat } from "@/components/kso/alat-view";

export const dynamic = "force-dynamic";

// Daftar Alat — SEMUA alat yang dikelola WRG (kso_asset), dengan status dan SUMBER
// status itu (migrasi 197). Status ditetapkan di SQL oleh aturan yang sama yang
// menentukan baris Produktivitas KSO, jadi "Operasional" di sini = alat yang
// dihitung di sana (kecuali faskesnya belum terpetakan ke Accurate — ditandai).
//
// Gate sama dengan Produktivitas KSO: canViewKso, kunci 'kso-simulator'. Kalau
// akses dipisah kelak, ganti di sini, di nav.ts, dan di BFF bersamaan.
export default async function KsoAlatPage() {
  const me = await sessionUser();
  if (!canViewKso(me)) {
    return (
      <>
        <PageHeader title="Daftar Alat" />
        <EmptyState title="Tidak punya akses" description="Fitur ini dibuka lewat matriks Akses Grup." />
      </>
    );
  }

  let data: KsoAlat | null = null;
  try {
    const r = await gatewayFetch("/kso/alat");
    if (r.ok) data = (await r.json()) as KsoAlat;
  } catch { data = null; }

  if (!data || data.rows.length === 0) {
    return (
      <>
        <PageHeader title="Daftar Alat" description="Semua alat yang dikelola WRG beserta statusnya." />
        <EmptyState
          title={data ? "Belum ada data" : "Backend tidak terjangkau"}
          description={data ? "Master aset KSO belum terisi." : "Coba muat ulang beberapa saat lagi."}
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Daftar Alat"
        description="Semua alat yang dikelola WRG. Arahkan kursor ke status untuk melihat dari mana status itu berasal."
      />
      <KsoAlatView data={data} />
    </>
  );
}
