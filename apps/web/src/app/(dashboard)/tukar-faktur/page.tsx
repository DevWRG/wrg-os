import { gatewayFetch } from "@/lib/gateway";
import { sessionUser } from "@/lib/admin-guard";
import { canViewTukarFaktur } from "@/lib/tukar-faktur-access";
import { PageHeader } from "@/components/dashboard/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { TukarFakturView } from "@/components/tukar-faktur/tukar-faktur-view";
import type { TukarFakturHasil } from "@/components/tukar-faktur/types";

export const dynamic = "force-dynamic";

// F31 Tukar Faktur Tracker + Klinik Calendar (Fase 1) — status faktur dari Accurate
// (Terbit → Dicetak → Lunas) dengan penanda TUA, plus kalender jatuh tempo/bayar customer klinik.
// Hanya membaca; reminder cukup di dashboard (keputusan Direktur 16 Okt 2026).
// Kunci izin sendiri 'tukar-faktur' (lib/tukar-faktur-access.ts).
export default async function TukarFakturPage() {
  const me = await sessionUser();
  if (!canViewTukarFaktur(me)) {
    return (
      <>
        <PageHeader title="Tukar Faktur" />
        <EmptyState title="Tidak punya akses" description="Fitur ini dibuka lewat matriks Akses Grup." />
      </>
    );
  }
  let data: TukarFakturHasil | null = null;
  try {
    const r = await gatewayFetch("/tukar-faktur");
    if (r.ok) data = (await r.json()) as TukarFakturHasil;
  } catch { data = null; }

  return (
    <>
      <PageHeader
        title="Tukar Faktur"
        description="Pantau tahap faktur dari Accurate dan jatuh tempo customer klinik — faktur yang menua ditandai TUA."
      />
      {!data
        ? <EmptyState title="Data tidak dapat dimuat" description="Backend tidak terjangkau atau migrasi belum diterapkan. Coba muat ulang beberapa saat lagi." />
        : <TukarFakturView data={data} />}
    </>
  );
}
