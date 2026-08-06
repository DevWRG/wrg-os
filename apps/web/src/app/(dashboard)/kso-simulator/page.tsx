import { gatewayFetch } from "@/lib/gateway";
import { PageHeader } from "@/components/dashboard/page-header";
import { KsoView } from "@/components/kso/kso-view";
import type { KsoMaster } from "@/lib/kso/types";

export const dynamic = "force-dynamic";

// Simulator KSO — running cost alat lab per test (penggabungan aplikasi
// runningcost-zybio). Gate rute ditegakkan layout dashboard lewat katalog NAV
// (fitur 'kso-simulator'); di sini cukup ambil masternya.
//
// Perhitungannya sengaja jalan di browser: user mengubah harga nego & jumlah
// test terus-menerus saat menyusun penawaran, dan tidak ada satu pun angka
// hasil yang disimpan. Server cuma menyediakan master.
async function getMaster(): Promise<KsoMaster | null> {
  try {
    const res = await gatewayFetch("/kso/master");
    if (!res.ok) return null;
    return (await res.json()) as KsoMaster;
  } catch {
    return null;
  }
}

export default async function KsoSimulatorPage() {
  const master = await getMaster();

  return (
    <>
      <PageHeader
        title="Simulator KSO"
        description="Hitung running cost alat lab per test untuk menyusun skema KSO/CPRR: CAPEX alat, reagen, consumable, dan overhead QC — sampai harga jual per test setelah markup."
      />
      <KsoView master={master} />
    </>
  );
}
