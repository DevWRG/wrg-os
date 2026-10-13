import { gatewayFetch } from "@/lib/gateway";
import { PageHeader } from "@/components/dashboard/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { GaRelocationTable, type GaRelocation } from "@/components/tables/ga-relocation-table";

export const dynamic = "force-dynamic";

async function getRelocations(): Promise<GaRelocation[] | null> {
  try {
    const res = await gatewayFetch("/ga-asset-relocations");
    if (!res.ok) return null;
    const data = (await res.json()) as { relocations: GaRelocation[] };
    return data.relocations ?? [];
  } catch {
    return null;
  }
}

// Relokasi aset GA (13 Okt 2026) — daftar semua pindah lokasi + berita acara.
// Relokasi dibuat dari tombol Relokasi di menu Aset GA (per aset).
export default async function GaRelokasiPage() {
  const rows = await getRelocations();
  return (
    <>
      <PageHeader
        title="Relokasi Aset"
        description="Riwayat pindah lokasi aset GA beserta berita acara bertanda tangan. Relokasi baru dibuat lewat tombol Relokasi di menu Aset GA."
      />
      <Card>
        <CardContent className="pt-6">
          {!rows ? (
            <EmptyState title="Data tidak tersedia" description="Pastikan apps/api jalan & DATABASE_URL terisi." />
          ) : rows.length === 0 ? (
            <EmptyState title="Belum ada relokasi" description="Buat relokasi dari menu Aset GA → tombol Relokasi pada aset yang dipindah." />
          ) : (
            <GaRelocationTable rows={rows} />
          )}
        </CardContent>
      </Card>
    </>
  );
}
