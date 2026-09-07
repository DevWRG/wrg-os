import { gatewayFetch } from "@/lib/gateway";
import { PageHeader } from "@/components/dashboard/page-header";
import { RaciMatrix, type RaciMatrixData } from "@/components/people/raci-matrix";
import { RaciPosisiBridge, type RaciKaryawan } from "@/components/picform/raci-posisi-bridge";

export const dynamic = "force-dynamic";

async function get<T>(path: string): Promise<T | null> {
  try { const r = await gatewayFetch(path); return r.ok ? ((await r.json()) as T) : null; } catch { return null; }
}

// F120 RACI Matrix global — proses × karyawan (R/A/C/I) dari raci_assignment (spine F118).
//
// 2026-09-07: ditambahi bagian KEDUA di bawahnya — jembatan orang → posisi →
// proses dari form PIC (F157). Matriks F120 di atas TIDAK diubah sama sekali;
// keduanya sengaja berdampingan karena menjawab pertanyaan berbeda atas sumber
// berbeda (transkrip wawancara vs form PIC). Dua panggilan ini independen: satu
// gagal tidak mengosongkan yang lain.
export default async function RaciMatrixPage() {
  const [data, jembatan] = await Promise.all([
    get<RaciMatrixData>("/employee-spine/raci-matrix"),
    get<RaciKaryawan>("/picform/raci-karyawan"),
  ]);

  return (
    <>
      <PageHeader
        title="RACI Matrix"
        description="Matriks tanggung jawab lintas proses × karyawan (Responsible/Accountable/Consulted/Informed). (F120) — plus jembatan posisi dari form PIC (F157)."
      />
      <div className="space-y-6">
        {data ? (
          <RaciMatrix data={data} />
        ) : (
          <p className="text-muted-foreground">Data tidak tersedia. Pastikan <code>apps/api</code> jalan &amp; spine ter-seed.</p>
        )}
        <RaciPosisiBridge data={jembatan} />
      </div>
    </>
  );
}
