import { gatewayFetch } from "@/lib/gateway";
import { PageHeader } from "@/components/dashboard/page-header";
import {
  SopOtomasiView,
  type Summary,
  type KelengkapanRow,
} from "@/components/picform/sop-otomasi-view";

export const dynamic = "force-dynamic";

async function get<T>(path: string): Promise<T | null> {
  try {
    const r = await gatewayFetch(path);
    return r.ok ? ((await r.json()) as T) : null;
  } catch {
    return null;
  }
}

// Muka data 6 form PIC Divisi (migrasi 168/170/171) — SOP & tingkat otomasi,
// RACI grain posisi, dan kelengkapan pengisian form.
//
// Yang diambil di server hanya yang KECIL & selalu dipakai: ringkasan (agregat
// atas 436 langkah), daftar divisi, dan kelengkapan (6 baris). Tabel langkah
// (436) & RACI (283) diambil client-side per halaman lewat /api/picform/*, jadi
// payload halaman tak menanggung keduanya untuk orang yang cuma melihat kartu.
export default async function SopOtomasiPage() {
  const [summary, divisi, kelengkapan] = await Promise.all([
    get<Summary>("/picform/summary"),
    get<{ divisi: { key: string; label: string }[] }>("/picform/divisi"),
    get<{ rows: KelengkapanRow[] }>("/picform/kelengkapan"),
  ]);

  return (
    <>
      <PageHeader
        title="SOP & Otomasi"
        description="Hasil bedah SOP 6 divisi dari form PIC: tingkat otomasi sekarang vs target, RACI per posisi, dan kelengkapan pengisian form. (F157)"
      />
      <SopOtomasiView
        summary={summary}
        divisiOpts={(divisi?.divisi ?? []).map((d) => ({ value: d.key, label: d.label }))}
        kelengkapan={kelengkapan?.rows ?? []}
      />
    </>
  );
}
