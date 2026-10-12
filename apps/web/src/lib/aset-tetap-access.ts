// Hak akses F34 Aset Tetap (/aset-tetap).
//
// Kunci izin sendiri ('aset-tetap'). Isinya nilai buku seluruh aset perusahaan,
// jadi view dan edit dipisah: Finance/Direktur melihat; yang mengisi lapisan
// override (tanggal perolehan asli, tautan alat KSO) dan memicu sinkron cukup
// yang diberi 'edit'.
//
// Fitur BARU default TERTUTUP: Sync Fitur menyemai izin deny untuk semua grup,
// jadi fallback identitasnya `false` (admin/superuser lolos lewat canOrLegacy).

import { canOrLegacy } from "@/lib/perms";
import { type AccessUser } from "@/lib/pricelist-access";

export function canViewAsetTetap(u?: AccessUser | null): boolean {
  return canOrLegacy(u, "aset-tetap", false);
}

export function canEditAsetTetap(u?: AccessUser | null): boolean {
  return canOrLegacy(u, "aset-tetap", false, "edit");
}
