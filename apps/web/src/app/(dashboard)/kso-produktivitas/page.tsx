import { gatewayFetch } from "@/lib/gateway";
import { sessionUser } from "@/lib/admin-guard";
import { canViewKso } from "@/lib/kso-access";
import { PageHeader } from "@/components/dashboard/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Card, CardContent } from "@/components/ui/card";
import { KsoProduktivitasTabs } from "@/components/kso/produktivitas-tabs";
import type { KsoProduktivitas } from "@/components/kso/produktivitas-shared";

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

  const { ringkasan } = data;
  return (
    <>
      <PageHeader
        title="Produktivitas KSO"
        description="Realisasi tes vs revenue Accurate per faskes. Rp/tes dihitung di level customer."
      />
      {/* Tiga angka ini TIDAK ikut filter — sengaja: ia menggambarkan cakupan data
          secara keseluruhan (berapa aset berhasil dipetakan ke Accurate), bukan irisan
          yang sedang dilihat. Karena itu ia berada di LUAR tab: nilainya sama di
          dua-duanya, dan menaruhnya di dalam salah satu tab membuatnya terlihat milik
          tab itu saja. */}
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Aset terpetakan" value={ringkasan.aset.toLocaleString("id-ID")} />
        <Stat label="Faskes" value={ringkasan.faskes.toLocaleString("id-ID")} />
        <Stat
          label="Layak diperingkat"
          value={`${ringkasan.layakDiperingkat.toLocaleString("id-ID")} / ${ringkasan.aset.toLocaleString("id-ID")}`}
          hint="penyebut ≥ 100 tes/thn & Rp/tes ada"
        />
      </div>
      <KsoProduktivitasTabs data={data} />
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
