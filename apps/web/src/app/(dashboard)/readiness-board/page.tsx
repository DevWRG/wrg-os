import { redirect } from "next/navigation";

// Readiness Board kini tiga tab di menu Instalasi Alat (K16, evaluasi menu 19 Nov
// 2026). Rute lama dipertahankan sebagai redirect — termasuk ?tab=jadwal /
// ?tab=laporan lama — supaya tautan yang sudah beredar tidak 404. Path ini tetap
// dimiliki entri features `readiness-board` (findNavItem).
export default async function ReadinessBoardRedirect({ searchParams }: { searchParams: Promise<{ tab?: string }> }): Promise<never> {
  const { tab } = await searchParams;
  redirect(`/installations?tab=${tab === "jadwal" || tab === "laporan" ? tab : "kapasitas"}`);
}
