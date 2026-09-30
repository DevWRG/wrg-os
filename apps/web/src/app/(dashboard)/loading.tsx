import { SkeletonPage } from "@/components/ui/loading";

// Penanda muat untuk SELURUH menu dashboard. 112 dari 128 halaman adalah Server
// Component yang mengambil datanya di server — sebelum berkas ini ada, pindah menu
// berarti layar DIAM di halaman lama sampai fetch selesai: tidak ada apa pun yang
// menyatakan permintaannya sedang jalan, dan pada menu yang berat itu terbaca
// sebagai aplikasi menggantung (pengguna mengklik menunya dua kali).
//
// Satu berkas di level grup rute menutup semua rute anak yang belum punya
// loading.tsx sendiri — sidebar & topbar dari layout tetap di tempatnya, hanya isi
// <main> yang dirangkakan. Rute yang bentuknya jauh berbeda boleh menaruh
// loading.tsx sendiri di foldernya; itu otomatis menang atas yang ini.
export default function DashboardLoading() {
  return <SkeletonPage cards={4} rows={8} cols={5} />;
}
