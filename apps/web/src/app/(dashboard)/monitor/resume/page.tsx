import { redirect } from "next/navigation";

// Kini tab "Resume Harian (AI)" di menu Monitor Grup WA (K1, evaluasi menu 19 Nov 2026). Rute lama
// dipertahankan sebagai redirect supaya tautan yang sudah beredar tidak 404. Path ini
// tetap dimiliki entri features `monitor-resume` (findNavItem), jadi gerbang izinnya sama.
export default function Redirect(): never {
  redirect("/monitor/rekap?tab=resume");
}
