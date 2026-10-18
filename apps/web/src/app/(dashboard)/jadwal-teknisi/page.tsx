import { gatewayFetch } from "@/lib/gateway";
import { sessionUser } from "@/lib/admin-guard";
import { canEditJadwalTeknisi, canViewJadwalTeknisi } from "@/lib/jadwal-teknisi-access";
import { PageHeader } from "@/components/dashboard/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { JadwalTeknisiView, type DataJadwal } from "@/components/jadwal-teknisi/jadwal-view";

export const dynamic = "force-dynamic";

// F154 Jadwal Kunjungan Rutin Teknisi. Gerbang menu juga ditegakkan layout (navVisible).
export default async function JadwalTeknisiPage() {
  const me = await sessionUser();
  if (!canViewJadwalTeknisi(me)) {
    return (
      <>
        <PageHeader title="Jadwal Teknisi" />
        <EmptyState title="Tidak punya akses" description="Menu ini dibuka lewat matriks Akses Grup." />
      </>
    );
  }
  let data: DataJadwal | null = null;
  try {
    const r = await gatewayFetch("/jadwal-teknisi", { headers: me ? { "x-user-id": me.id } : {} });
    if (r.ok) data = (await r.json()) as DataJadwal;
  } catch { data = null; }
  return (
    <>
      <PageHeader
        title="Jadwal Teknisi"
        description="Jadwal kunjungan rutin teknisi ke faskes KSO — disusun otomatis per bulan, ditinjau HoD Aftersales, lalu diterbitkan ke WA teknisi sebelum tanggal 1."
      />
      {data ? <JadwalTeknisiView awal={data} bisaUbah={canEditJadwalTeknisi(me)} />
        : <EmptyState title="Backend tidak terjangkau" description="Coba muat ulang beberapa saat lagi." />}
    </>
  );
}
