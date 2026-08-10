import { PageHeader } from "@/components/dashboard/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { InsentifPeriodePicker } from "@/components/insentif/insentif-periode-picker";
import { InsentifTimView } from "@/components/insentif/insentif-tim-view";
import { periodeLabel, periodeSah, type TimResult } from "@/components/insentif/insentif-format";
import { sessionUser } from "@/lib/admin-guard";
import { gatewayFetch } from "@/lib/gateway";

export const dynamic = "force-dynamic";

// F67 menu tim — SATU halaman untuk HoD, Finance, dan Direktur. Yang membedakan mereka
// adalah scope yang dihitung SERVER (resolveAkses), bukan route yang berbeda: rancangan
// awal /insentif/hod + /insentif/finance dibatalkan karena dua route berarti dua jalur
// query, dan yang versi "semua" itu yang berbahaya (PRD §C.2).
//
// AM murni tak punya menu ini (canViewInsentifTim) dan URL langsungnya di-redirect oleh
// layout dashboard. Backend tetap otoritas: /insentif/list membalas 403 untuk level "self".
async function fetchList(userId: string, periode: string): Promise<{ data: TimResult | null; status: number }> {
  try {
    const res = await gatewayFetch(`/insentif/list?periode=${encodeURIComponent(periode)}`, {
      headers: { "x-user-id": userId },
    });
    if (!res.ok) return { data: null, status: res.status };
    return { data: (await res.json()) as TimResult, status: res.status };
  } catch {
    return { data: null, status: 502 };
  }
}

export default async function InsentifTimPage({
  searchParams,
}: {
  searchParams: Promise<{ periode?: string }>;
}) {
  const [me, sp] = await Promise.all([sessionUser(), searchParams]);
  const periode = periodeSah(sp.periode);

  const header = (
    <PageHeader
      title="Insentif Tim"
      description="Rekap insentif per AM. Yang tampil dibatasi server sesuai peran Anda."
      action={<InsentifPeriodePicker periode={periode} />}
    />
  );

  if (!me) {
    return (
      <div className="flex flex-col gap-5">
        {header}
        <EmptyState title="Sesi berakhir" description="Masuk ulang untuk melanjutkan." />
      </div>
    );
  }

  const { data, status } = await fetchList(me.id, periode);

  // 403 dari backend = memang bukan hak akun ini. Bisa terjadi walau menunya tampil,
  // mis. akun HoD yang hod_territory-nya belum ter-map → server tak bisa memastikan
  // cabangnya, jadi menutup. Ditampilkan apa adanya, bukan sebagai "data kosong".
  if (status === 403) {
    return (
      <div className="flex flex-col gap-5">
        {header}
        <EmptyState
          title="Menu ini bukan untuk akun Anda"
          description="Insentif tim hanya untuk HoD (cabang timnya), Finance, dan Direktur. Kalau Anda HoD dan tetap melihat pesan ini, kemungkinan hod_territory akun Anda belum ter-map — hubungi admin."
        />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex flex-col gap-5">
        {header}
        <EmptyState
          title="Data insentif tak bisa dimuat"
          description={`Periode ${periodeLabel(periode)} gagal diambil dari backend. Coba lagi; kalau berulang, laporkan.`}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {header}
      <InsentifTimView data={data} />
    </div>
  );
}
