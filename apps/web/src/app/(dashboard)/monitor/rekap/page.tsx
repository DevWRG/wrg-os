import { sessionUser } from "@/lib/admin-guard";
import { findNavItem, navOwnVisible, tabVisible } from "@/lib/nav";
import { pilihTab, type DefTab } from "@/lib/page-tabs";
import { PageHeader } from "@/components/dashboard/page-header";
import { PageTabs } from "@/components/layout/page-tabs";
import { AnggotaSection, PolaSection, RekapSection, ResumeSection, RiwayatSection } from "./sections";

export const dynamic = "force-dynamic";

// Monitor Grup WA (K1, evaluasi menu 19 Nov 2026): Rekap, Resume, Pola Komunikasi,
// Members, dan Digest History memakai repo/proxy monitor yang sama (Digest = tabel
// monitor_digest yang sama dengan Rekap/Resume) — dilebur jadi satu menu lima tab.
// Izin tetap lima key; URL lama di-redirect ke ?tab=. Komite (hanya monitor-resume)
// hanya melihat tab Resume — tabKetat menjaga data Rekap & digest dari pemegang tab lain.
const TAB_FITUR: { key: string; label: string; fitur: string }[] = [
  { key: "resume", label: "Resume Harian (AI)", fitur: "monitor-resume" },
  { key: "pola", label: "Pola Komunikasi", fitur: "monitor-pola" },
  { key: "anggota", label: "Anggota Grup WA", fitur: "monitor-members" },
  { key: "riwayat", label: "Riwayat Digest", fitur: "digests" },
];

export default async function MonitorGrupWaPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const [{ tab }, me] = await Promise.all([searchParams, sessionUser()]);
  const induk = findNavItem("/monitor/rekap");
  const tabs: DefTab[] = [];
  if (!induk || navOwnVisible(me, induk)) tabs.push({ key: "rekap", label: "Rekap" });
  for (const t of TAB_FITUR) {
    const f = induk?.features?.find((x) => x.key === t.fitur);
    if (f && tabVisible(me, f)) tabs.push({ key: t.key, label: t.label });
  }
  const aktif = pilihTab(tabs, tab) ?? "rekap";

  return (
    <>
      <PageHeader
        title="Monitor Grup WA"
        description="Ringkasan AI percakapan grup WhatsApp: rekap kolektif tiap ~5 jam, resume harian, profil pola komunikasi per grup, direktori anggota, dan riwayat digest + infografis."
      />
      <PageTabs tabs={tabs.length ? tabs : [{ key: "rekap", label: "Rekap" }]} aktif={aktif} />
      {aktif === "resume" ? <ResumeSection />
        : aktif === "pola" ? <PolaSection />
        : aktif === "anggota" ? <AnggotaSection />
        : aktif === "riwayat" ? <RiwayatSection />
        : <RekapSection />}
    </>
  );
}
