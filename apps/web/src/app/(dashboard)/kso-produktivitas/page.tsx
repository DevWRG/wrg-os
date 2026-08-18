import { gatewayFetch } from "@/lib/gateway";
import { sessionUser } from "@/lib/admin-guard";
import { canViewKso } from "@/lib/kso-access";
import { PageHeader } from "@/components/dashboard/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import {
  KsoProduktivitasView,
  type KsoProduktivitas,
} from "@/components/kso/produktivitas-view";

export const dynamic = "force-dynamic";

// Produktivitas aset KSO — realisasi tes vs revenue Accurate (migrasi 097-105).
//
// Gate sama dengan Simulator KSO atas keputusan user 2026-08-18. Perlu diingat
// halaman ini memuat REVENUE PER FASKES, sementara Simulator hanya harga alat &
// reagen; kalau kelak perlu dipisah, buat flag fitur sendiri dan ganti gate di
// sini serta di BFF (apps/web/src/app/api/kso/[...path]/route.ts).
export default async function KsoProduktivitasPage() {
  const me = await sessionUser();
  if (!canViewKso(me)) {
    return (
      <>
        <PageHeader title="Produktivitas KSO" />
        <EmptyState title="Tidak punya akses" description="Fitur ini dibuka lewat matriks Akses Grup." />
      </>
    );
  }

  let data: KsoProduktivitas | null = null;
  try {
    const r = await gatewayFetch("/kso/produktivitas");
    if (r.ok) data = (await r.json()) as KsoProduktivitas;
  } catch { data = null; }

  if (!data || data.rows.length === 0) {
    return (
      <>
        <PageHeader
          title="Produktivitas KSO"
          description="Realisasi tes vs revenue Accurate per faskes."
        />
        <EmptyState
          title={data ? "Belum ada data" : "Backend tidak terjangkau"}
          description={
            data
              ? "Master aset KSO belum terisi, atau belum ada aset yang terpetakan ke customer Accurate."
              : "Coba muat ulang beberapa saat lagi."
          }
        />
      </>
    );
  }

  // Kartu angka & grafik pindah ke sub-menu Ringkasan KSO (2026-08-18) — halaman ini
  // fokus menelusuri satu faskes, dan menumpuk keduanya mendorong tabel jauh ke bawah
  // lipatan.
  return (
    <>
      <PageHeader
        title="Produktivitas KSO"
        description="Realisasi tes vs revenue Accurate per faskes. Rp/tes dihitung di level customer."
      />
      <KsoProduktivitasView data={data} />
    </>
  );
}
