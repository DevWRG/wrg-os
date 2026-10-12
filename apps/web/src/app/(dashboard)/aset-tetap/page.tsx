import { gatewayFetch } from "@/lib/gateway";
import { sessionUser } from "@/lib/admin-guard";
import { canEditAsetTetap, canViewAsetTetap } from "@/lib/aset-tetap-access";
import { PageHeader } from "@/components/dashboard/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { AsetTetapView } from "@/components/aset-tetap/aset-tetap-view";
import type { Ringkasan } from "@/components/aset-tetap/types";

export const dynamic = "force-dynamic";

// F34 Aset Tetap & Depresiasi (fase 1: cermin Accurate, migrasi 203). Kunci
// izin sendiri 'aset-tetap' (view = lihat, edit = catatan Finance + picu
// sinkron) — lihat lib/aset-tetap-access.ts. Jurnal resmi tetap di Accurate
// (ADR-019); fase 2 (belum): rekonsiliasi ke revenue KSO per alat.
export default async function AsetTetapPage() {
  const me = await sessionUser();
  if (!canViewAsetTetap(me)) {
    return (
      <>
        <PageHeader title="Aset Tetap" />
        <EmptyState title="Tidak punya akses" description="Fitur ini dibuka lewat matriks Akses Grup." />
      </>
    );
  }
  let ringkasan: Ringkasan | null = null;
  try {
    const r = await gatewayFetch("/aset-tetap/ringkasan");
    if (r.ok) ringkasan = (await r.json()) as Ringkasan;
  } catch { ringkasan = null; }

  return (
    <>
      <PageHeader
        title="Aset Tetap"
        description="Register aset tetap dari Accurate: nilai perolehan, penyusutan, nilai buku, dan jadwal depresiasi per aset."
      />
      {!ringkasan
        ? <EmptyState title="Backend tidak terjangkau" description="Coba muat ulang beberapa saat lagi." />
        : <AsetTetapView ringkasan={ringkasan} canEdit={canEditAsetTetap(me)} />}
    </>
  );
}
