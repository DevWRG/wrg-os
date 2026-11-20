import { redirect } from "next/navigation";

// Relokasi Aset kini tab "Riwayat Relokasi" di menu Aset GA (K6, evaluasi menu
// 19 Nov 2026). Rute lama dipertahankan sebagai redirect supaya tautan yang sudah
// beredar tidak 404. Path ini tetap dimiliki entri features `ga-relokasi`
// (findNavItem), jadi gerbang izinnya sama seperti dulu.
export default function GaRelokasiRedirect(): never {
  redirect("/ga-aset?tab=relokasi");
}
