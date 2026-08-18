import { gatewayFetch } from "@/lib/gateway";
import { sessionUser } from "@/lib/admin-guard";
import { canViewKso } from "@/lib/kso-access";
import { PageHeader } from "@/components/dashboard/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { KsoRingkasanView } from "@/components/kso/ringkasan-view";
import type { KsoProduktivitas } from "@/components/kso/produktivitas-shared";

export const dynamic = "force-dynamic";

// Sub-menu Ringkasan Produktivitas KSO — kartu angka + grafik (tren bulanan,
// 10 besar, sebaran Rp/tes). Tabelnya di route induk /kso-produktivitas.
//
// Gate PERSIS SAMA dengan induknya (canViewKso, terikat flag fitur 'kso-simulator').
// Kalau dibedakan, halaman ini bisa terbuka bagi orang yang tidak boleh melihat
// tabelnya padahal keduanya menyajikan revenue per faskes dari sumber yang sama —
// pemisahan yang terlihat rapi di menu tapi bocor di data. Lihat catatan `feature`
// pada dua entri nav di apps/web/src/lib/nav.ts.
export default async function KsoRingkasanPage() {
  const me = await sessionUser();
  if (!canViewKso(me)) {
    return (
      <>
        <PageHeader title="Ringkasan KSO" />
        <EmptyState title="Tidak punya akses" description="Fitur ini dibuka lewat matriks Akses Grup." />
      </>
    );
  }

  // Endpoint yang sama dengan halaman tabel — payload penuh (±520 baris + tren
  // bulanan) memang kecil, dan memakai satu sumber menjamin dua muka ini tidak
  // pernah menampilkan angka yang berbeda.
  let data: KsoProduktivitas | null = null;
  try {
    const r = await gatewayFetch("/kso/produktivitas");
    if (r.ok) data = (await r.json()) as KsoProduktivitas;
  } catch { data = null; }

  if (!data || data.rows.length === 0) {
    return (
      <>
        <PageHeader title="Ringkasan KSO" description="Tren dan sebaran produktivitas aset KSO." />
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

  const { ringkasan } = data;
  return (
    <>
      <PageHeader
        title="Ringkasan KSO"
        description="Tren bulanan, 10 besar, dan sebaran Rp/tes. Tabel per faskes ada di menu Produktivitas KSO."
      />
      {/* Tiga angka ini TIDAK ikut filter — sengaja: ia menggambarkan cakupan data
          secara keseluruhan (berapa aset berhasil dipetakan ke Accurate), bukan
          irisan yang sedang dilihat. Kartu yang ikut filter ada di bawah, di dalam
          KsoRingkasanView. */}
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Aset terpetakan" value={ringkasan.aset.toLocaleString("id-ID")} />
        <Stat label="Faskes" value={ringkasan.faskes.toLocaleString("id-ID")} />
        <Stat
          label="Layak diperingkat"
          value={`${ringkasan.layakDiperingkat.toLocaleString("id-ID")} / ${ringkasan.aset.toLocaleString("id-ID")}`}
          hint="penyebut ≥ 100 tes/thn & Rp/tes ada"
        />
      </div>
      <KsoRingkasanView data={data} />
    </>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card>
      <CardContent className="py-4">
        <div className="text-muted-foreground text-xs">{label}</div>
        <div className="text-2xl font-semibold tracking-tight">{value}</div>
        {hint ? <div className="text-muted-foreground text-xs">{hint}</div> : null}
      </CardContent>
    </Card>
  );
}
