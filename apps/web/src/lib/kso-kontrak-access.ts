// Hak akses F47 Kontrak KSO (/kso-kontrak).
//
// Kunci izin SENDIRI ('kso-kontrak'), terpisah dari 'kso-simulator': halaman ini
// menulis data (kontrak, status renewal), sedangkan menu KSO lain hanya membaca.
// View dan edit dipisah — tim sales boleh melihat jatuh tempo, yang mengubah
// kontrak cukup tim KSO/admin.
//
// Fitur BARU default TERTUTUP: setelah deploy, Sync Fitur menyemai baris izin
// deny untuk semua grup, jadi fallback identitasnya `false` (admin/superuser
// tetap lolos lewat canOrLegacy).

import { canOrLegacy } from "@/lib/perms";
import { type AccessUser } from "@/lib/pricelist-access";

export function canViewKsoKontrak(u?: AccessUser | null): boolean {
  return canOrLegacy(u, "kso-kontrak", false);
}

export function canEditKsoKontrak(u?: AccessUser | null): boolean {
  return canOrLegacy(u, "kso-kontrak", false, "edit");
}
