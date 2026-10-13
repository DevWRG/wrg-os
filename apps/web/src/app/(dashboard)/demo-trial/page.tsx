import { gatewayFetch } from "@/lib/gateway";
import { sessionUser } from "@/lib/admin-guard";
import { featureAllowed } from "@/lib/feature-guard";
import { PageHeader } from "@/components/dashboard/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { DemoTrialView } from "@/components/demo-trial/demo-trial-view";
import type { AmOpsi, DaftarDT } from "@/components/demo-trial/types";

export const dynamic = "force-dynamic";

// F18 Demo & Trial. Hasil dinilai AM (positif/netral/negatif) saat menutup;
// konversi per produk = positif ÷ yang sudah ditutup. Baris di-scope apps/api.
export default async function DemoTrialPage() {
  const me = await sessionUser();
  if (!me || !featureAllowed(me, "/demo-trial", "view")) {
    return (
      <>
        <PageHeader title="Demo & Trial" />
        <EmptyState title="Tidak punya akses" description="Menu ini dibuka lewat matriks Akses Grup." />
      </>
    );
  }
  let daftar: DaftarDT | null = null;
  let am: AmOpsi[] = [];
  try {
    const h = { headers: { "x-user-id": me.id } };
    const [a, b] = await Promise.all([gatewayFetch("/demo-trial", h), gatewayFetch("/demo-trial-am", h)]);
    if (a.ok) daftar = (await a.json()) as DaftarDT;
    if (b.ok) am = ((await b.json()) as { am: AmOpsi[] }).am;
  } catch { daftar = null; }

  return (
    <>
      <PageHeader
        title="Demo & Trial"
        description="Demo alat (sekali datang) dan trial (alat dipinjamkan) beserta hasilnya. Tutup tiap demo/trial dengan penilaian positif / netral / negatif — dari situ angka konversi per produk dihitung."
      />
      {!daftar
        ? <EmptyState title="Backend tidak terjangkau" description="Coba muat ulang beberapa saat lagi." />
        : <DemoTrialView daftar={daftar} amOpsi={am}
            bolehTambah={featureAllowed(me, "/demo-trial", "create")}
            bolehUbah={featureAllowed(me, "/demo-trial", "edit")} />}
    </>
  );
}
