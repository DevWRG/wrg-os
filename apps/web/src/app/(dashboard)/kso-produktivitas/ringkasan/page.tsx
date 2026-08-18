import { redirect } from "next/navigation";

// Ringkasan KSO sempat berdiri sebagai MENU & rute sendiri (#911/#913, live ~1 jam),
// lalu dijadikan TAB atas keputusan user 2026-08-18.
//
// Rutenya sengaja TIDAK dihapus, hanya diarahkan: URL ini sudah pernah tayang di prod
// dan halaman KSO lumrah dikirim sebagai tautan lewat WA. Menghapusnya berarti tautan
// yang sudah beredar berujung 404 — kegagalan yang menimpa orang lain, bukan kita, dan
// yang tidak akan pernah kita dengar. Berkas kecil ini menutup kemungkinan itu.
//
// redirect() Next.js berjalan di server sebelum apa pun dirender, jadi tidak ada
// kedipan halaman kosong. Gate akses tidak perlu diulang di sini: tujuannya
// (/kso-produktivitas) sudah meng-gate dengan canViewKso, dan berkas ini tidak memuat
// data apa pun.
export default function KsoRingkasanRedirect(): never {
  redirect("/kso-produktivitas?tab=ringkasan");
}
