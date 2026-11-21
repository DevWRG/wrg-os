import { gatewayFetch } from "@/lib/gateway";
import { PageHeader } from "@/components/dashboard/page-header";
import { HodResolverView, type HodResolution } from "@/components/people/hod-resolver-view";

export const dynamic = "force-dynamic";

async function get<T>(path: string): Promise<T | null> {
  try { const r = await gatewayFetch(path); return r.ok ? ((await r.json()) as T) : null; } catch { return null; }
}

// F121 HoD Name Canonical Resolver — preview resolusi atasan_raw → HoD kanonik.
export default async function HodResolvePage() {
  const data = await get<HodResolution>("/employee-spine/hod-resolution");
  return (
    <>
      <PageHeader
        title="HoD Resolver"
        description="Menyelaraskan penulisan nama atasan di roster menjadi HoD baku — dasar Reporting Line di Org Chart."
      />
      {data ? (
        <HodResolverView data={data} />
      ) : (
        <p className="text-muted-foreground">Data belum bisa dimuat. Muat ulang halaman; kalau tetap kosong, laporkan ke admin sistem.</p>
      )}
    </>
  );
}
