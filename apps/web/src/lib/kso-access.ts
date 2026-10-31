// Hak akses Simulator KSO (/kso-simulator).
//
// Satu tingkat saja: siapa pun yang berizin fitur 'kso-simulator' boleh pakai.
// Isinya alat bantu menyusun penawaran di depan faskes — harga alat & reagen
// memang harus dilihat sales yang menghitungnya. Yang tidak boleh melihat,
// tidak diberi fitur ini di matriks Akses Grup.
//
// Fitur BARU default TERTUTUP: setelah deploy, Sync Fitur menyemai baris izin
// deny untuk semua grup, jadi menu ini tidak muncul sampai admin mencentangnya.
// Karena itu fallback identitasnya `false`, bukan `!!u` — jangan disamakan
// dengan pricebook (fitur lama yang sudah terlanjur terbuka untuk semua).

import { canOrLegacy } from "@/lib/perms";
import { type AccessUser } from "@/lib/pricelist-access";

export function canViewKso(u?: AccessUser | null): boolean {
  return canOrLegacy(u, "kso-simulator", false);
}

// F169 — mencatat pindah/tarik alat KSO (riwayat penempatan, migrasi 217).
// Keputusan user 13 Okt 2026: tombolnya di menu Daftar Alat dan HANYA TEKNISI
// yang boleh menekannya. Kunci izin SENDIRI ('kso-mutasi-alat', disemai lewat
// `features` item Daftar Alat di nav.ts) supaya bisa dicentang untuk grup teknisi
// tanpa membuka 'kso-simulator' (yang ikut membuka revenue per faskes di
// Produktivitas KSO). Menulis butuh tingkat EDIT; VIEW cukup untuk membuka menunya.
// Admin/superuser tetap lolos lewat canOrLegacy — sama dengan semua fitur lain.
export function canMutasiAlatKso(u?: AccessUser | null): boolean {
  return canOrLegacy(u, "kso-mutasi-alat", false, "edit");
}

// Siapa yang boleh membuka Daftar Alat: pemegang 'kso-simulator' ATAU teknisi.
export function canBukaDaftarAlat(u?: AccessUser | null): boolean {
  return canViewKso(u) || canOrLegacy(u, "kso-mutasi-alat", false);
}

// F145 Fase B (migrasi 264, Pedoman Komite KSO Forum v01) — kelola harga beli reagen & HPP alat.
// Kunci SENDIRI supaya Finance bisa diberi ubah tanpa membuka hal lain; tanpa gate lama (fitur baru
// tertutup) dan role admin TIDAK otomatis (role admin juga dipakai HOD) — API
// repo/kso-harga-beli.ts izinHargaBeli yang menentukan, ini hanya untuk tombol & BFF.
export const FITUR_HARGA_BELI = { key: "kso-simulator-hargabeli", name: "Simulator KSO — kelola harga beli reagen & HPP alat (Finance)" };

export function canKelolaHargaBeli(u?: AccessUser | null, aksi: "view" | "edit" = "view"): boolean {
  const v = u && (u as { role?: string | null }).role === "admin" ? { ...u, role: null } : u;
  if (aksi === "view") return canOrLegacy(v, FITUR_HARGA_BELI.key, false, "view") || canOrLegacy(v, FITUR_HARGA_BELI.key, false, "edit");
  return canOrLegacy(v, FITUR_HARGA_BELI.key, false, "edit");
}
