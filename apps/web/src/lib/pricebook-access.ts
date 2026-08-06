// Hak akses Price Book (F142). Tiga menu, tiga pembaca yang berbeda:
//
//   /pricebook            KATALOG + Harga per Produk + Di Luar Keagenan — semua user
//     yang berizin fitur 'pricebook' / 'pricelist'. Isinya harga jual resmi yang
//     memang untuk dipakai sales di lapangan.
//
//   /pricebook/ringkasan  RINGKASAN — Direktur + HoD (+ admin). Nilai katalog per
//     lini, top brand, dan konsentrasi principal adalah bacaan portofolio, bukan
//     alat jualan. Tidak memuat HPP/margin/sub-dealer, tapi tetap ditutup dari
//     sales karena sifat bacaannya.
//
//   /pricebook/setup      SETUP HARGA — HoD Business / Purchasing (+ admin) saja.
//     Ini satu-satunya muka yang memuat HPP & margin (HANDOVER §1/§9 melarang
//     keduanya keluar ke sales) → gate-nya di lib/pricelist-access
//     (canEditPricelistSetup), murni jabatan, bukan visibilitas menu.
//
// Ringkasan & Setup sengaja menu SENDIRI, bukan tab di /pricebook: pembacanya beda
// dari pembaca katalog, dan menu terpisah bikin izinnya bisa dicentang sendiri di
// matriks Akses Grup (satu tab tidak punya baris izin sendiri).
//
// Seperti gate lain: matriks Akses Grup menang atas gate identitas (canOrLegacy).

import { canOrLegacy } from "@/lib/perms";
import { type AccessUser } from "@/lib/pricelist-access";

const norm = (s?: string | null): string => (s ?? "").trim().toLowerCase();

export function canViewPricebook(u?: AccessUser | null): boolean {
  return canOrLegacy(u, "pricebook", !!u);
}

// Direktur + HoD + admin. HoD dikenali dari `is_hod` (app_user.hod_key ter-set,
// lihat /auth/me) — sama dengan gate Raport Karyawan; title 'hod ...' ikut diterima
// karena tidak semua HoD punya hod_key (mis. HoD Business yang bukan HoD wilayah).
export function canViewPricebookSummary(u?: AccessUser | null): boolean {
  if (!u) return false;
  const r = norm(u.role);
  const legacy = r === "direktur" || r === "admin" || u.superuser === true
    || u.is_hod === true || norm(u.title).startsWith("hod");
  return canOrLegacy(u, "pricebook-ringkasan", legacy);
}
