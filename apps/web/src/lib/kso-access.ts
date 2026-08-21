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
