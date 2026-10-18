import { gatewayFetch } from "@/lib/gateway";
import { sessionUser } from "@/lib/admin-guard";
import { actorName, featureAllowed } from "@/lib/feature-guard";
import { canKelolaKontrakCn } from "@/lib/cn-access";
import { PageHeader } from "@/components/dashboard/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { CnView } from "@/components/cn/cn-view";
import type { CnRow, KontrakRow, Ringkasan } from "@/components/cn/types";

export const dynamic = "force-dynamic";

// F151 CN (Kredit Note) Lifecycle — kontrak rebate per customer + pengajuan CN per faktur:
// Sales → [HoD Business] → HoD Sales → Finance → GA. Kunci izin 'cn' (view/create/edit), tertutup default.
export default async function CnPage() {
  const me = await sessionUser();
  if (!me || !featureAllowed(me, "/cn", "view")) {
    return (
      <>
        <PageHeader title="Kredit Note (CN)" />
        <EmptyState title="Tidak punya akses" description="Menu ini dibuka lewat matriks Akses Grup." />
      </>
    );
  }
  let peng: { items: CnRow[]; ringkasan: Ringkasan } | null = null;
  let kontrak: KontrakRow[] = [];
  let pending = false;
  try {
    const [a, b] = await Promise.all([gatewayFetch("/cn/pengajuan"), gatewayFetch("/cn/kontrak")]);
    if (a.status === 503 || b.status === 503) pending = true;
    else if (a.ok && b.ok) {
      peng = (await a.json()) as { items: CnRow[]; ringkasan: Ringkasan };
      kontrak = ((await b.json()) as { items: KontrakRow[] }).items;
    }
  } catch { peng = null; }

  return (
    <>
      <PageHeader
        title="Kredit Note (CN)"
        description="Rebate customer berdasarkan kontrak, dihitung dari DPP faktur. Alur: Sales → (HoD Business) → HoD Sales → Finance → GA. (F151)"
      />
      {pending
        ? <EmptyState title="Migrasi belum diterapkan" description="Tabel CN belum ada di database (migrasi 230)." />
        : !peng
          ? <EmptyState title="Backend tidak terjangkau" description="Coba muat ulang beberapa saat lagi." />
          : <CnView pengajuan={peng.items} ringkasan={peng.ringkasan} kontrak={kontrak}
              bolehBuat={featureAllowed(me, "/cn", "create")} bolehUbah={featureAllowed(me, "/cn", "edit")}
              bolehKelolaKontrak={canKelolaKontrakCn(me)} pelaku={actorName(me)}
              me={{ role: me.role, superuser: me.superuser ?? null, hod_key: me.hod_key ?? null, title: me.title ?? null }} />}
    </>
  );
}
