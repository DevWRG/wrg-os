import { gatewayFetch } from "@/lib/gateway";
import { sessionUser } from "@/lib/admin-guard";
import { featureAllowed } from "@/lib/feature-guard";
import { canManageOnboardingTemplates } from "@/lib/onboarding-access";
import { PageHeader } from "@/components/dashboard/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { OnboardingView } from "@/components/onboarding/onboarding-view";
import type { OnboardingCase, Template } from "@/components/onboarding/types";

export const dynamic = "force-dynamic";

// F56 Onboarding Checklist Karyawan Baru — checklist akses sistem, training, NDA, alat, grup WA per
// jabatan. Baris di-scope apps/api (admin/Direktur semua, HoD cabang timnya); template hanya admin/Direktur.
export default async function OnboardingPage() {
  const me = await sessionUser();
  if (!me || !featureAllowed(me, "/onboarding", "view")) {
    return (
      <>
        <PageHeader title="Onboarding Karyawan" />
        <EmptyState title="Tidak punya akses" description="Menu ini dibuka lewat matriks Akses Grup." />
      </>
    );
  }
  const bolehTemplate = canManageOnboardingTemplates(me);
  let cases: OnboardingCase[] | null = null;
  let templates: Template[] | null = null;
  let dept: { key: string; label: string }[] = [];
  let pending = false;
  try {
    const h = { headers: { "x-user-id": me.id } };
    const [a, b] = await Promise.all([gatewayFetch("/onboarding", h), bolehTemplate ? gatewayFetch("/onboarding/templates", h) : null]);
    if (a.status === 503) pending = true;
    else if (a.ok) cases = ((await a.json()) as { items: OnboardingCase[] }).items;
    if (b?.ok) {
      const t = (await b.json()) as { templates: Template[]; dept: { key: string; label: string }[] };
      templates = t.templates;
      dept = t.dept;
    }
  } catch { cases = null; }

  return (
    <>
      <PageHeader
        title="Onboarding Karyawan"
        description="Checklist karyawan baru: akses sistem, training, NDA, alat, dan grup WA — dibentuk per jabatan dari template. Butir yang lewat tenggat ditandai terlambat. (F56)"
      />
      {pending
        ? <EmptyState title="Migrasi belum diterapkan" description="Tabel onboarding belum ada di database (migrasi 213)." />
        : !cases
          ? <EmptyState title="Backend tidak terjangkau" description="Coba muat ulang beberapa saat lagi." />
          : <OnboardingView cases={cases} templates={templates} dept={dept}
              bolehTambah={featureAllowed(me, "/onboarding", "create")}
              bolehUbah={featureAllowed(me, "/onboarding", "edit")}
              bolehTemplate={bolehTemplate} />}
    </>
  );
}
