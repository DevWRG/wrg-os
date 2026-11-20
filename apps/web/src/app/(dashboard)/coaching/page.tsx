import { redirect } from "next/navigation";

// Coaching Notes kini tab "Catatan Coaching" di Raport Karyawan 360 (K18 opsi C,
// evaluasi menu 19 Nov 2026). Rute lama dipertahankan sebagai redirect supaya
// tautan yang sudah beredar tidak 404. Path ini tetap dimiliki entri features
// `coaching` (findNavItem), dan /api/coaching/notes tetap requireFeature("/coaching").
export default function CoachingRedirect(): never {
  redirect("/karyawan?tab=coaching");
}
