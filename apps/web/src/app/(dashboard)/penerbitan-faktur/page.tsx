import { redirect } from "next/navigation";

// Penerbitan Faktur kini tab "Penerbitan & Revisi Faktur" di menu Faktur (K7,
// evaluasi menu 19 Nov 2026). Rute lama dipertahankan sebagai redirect supaya
// tautan yang sudah beredar (termasuk dari pesan WA alarm fakturis) tidak 404.
// Path ini tetap dimiliki entri features `penerbitan-faktur` (findNavItem).
export default function PenerbitanFakturRedirect(): never {
  redirect("/do-belum-faktur?tab=penerbitan");
}
