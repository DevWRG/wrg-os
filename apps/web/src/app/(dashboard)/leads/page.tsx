import { gatewayFetch } from "@/lib/gateway";
import { sessionUser } from "@/lib/admin-guard";
import { featureAllowed } from "@/lib/feature-guard";
import { PageHeader } from "@/components/dashboard/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { LeadsView } from "@/components/leads/leads-view";
import type { AmOpsi, Lead } from "@/components/leads/types";

export const dynamic = "force-dynamic";

// F65 Leads Capture & Qualification. Lead = prospek SEBELUM jadi deal; lolos
// BANT ≥3 dari 4 → konversi ke Pipeline. Baris di-scope apps/api dari x-user-id
// (AM = miliknya, HoD = cabang timnya, admin = semua).
export default async function LeadsPage() {
  const me = await sessionUser();
  if (!me || !featureAllowed(me, "/leads", "view")) {
    return (
      <>
        <PageHeader title="Leads" />
        <EmptyState title="Tidak punya akses" description="Menu ini dibuka lewat matriks Akses Grup." />
      </>
    );
  }
  let leads: Lead[] | null = null;
  let am: AmOpsi[] = [];
  try {
    const h = { headers: { "x-user-id": me.id } };
    const [a, b] = await Promise.all([gatewayFetch("/leads", h), gatewayFetch("/leads-am", h)]);
    if (a.ok) leads = ((await a.json()) as { leads: Lead[] }).leads;
    if (b.ok) am = ((await b.json()) as { am: AmOpsi[] }).am;
  } catch { leads = null; }

  return (
    <>
      <PageHeader
        title="Leads"
        description="Prospek baru sebelum masuk Pipeline: dari WhatsApp #LEADS, input web, dan pameran. Lengkapi BANT — minimal 3 dari 4 untuk dikonversi jadi deal."
      />
      {!leads
        ? <EmptyState title="Backend tidak terjangkau" description="Coba muat ulang beberapa saat lagi." />
        : <LeadsView leads={leads} amOpsi={am}
            bolehTambah={featureAllowed(me, "/leads", "create")}
            bolehUbah={featureAllowed(me, "/leads", "edit")} />}
    </>
  );
}
