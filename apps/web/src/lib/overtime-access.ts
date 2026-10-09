// Hak akses halaman Lembur (/overtime) — rekap pengajuan #OVERTIME untuk HR
// + tombol putus untuk HoD. Satu tingkat lihat: siapa pun yang berizin fitur
// 'overtime' di matriks Akses Grup (HR diberi grup itu oleh admin).
//
// Fitur BARU default TERTUTUP (Sync Fitur menyemai deny untuk semua grup), jadi
// fallback identitasnya `false`. Kelola aturan siapa boleh mengajukan =
// admin/superuser saja (isOvertimeAdmin), bukan sekadar pemegang fitur.

import { canOrLegacy } from "@/lib/perms";
import { type AccessUser } from "@/lib/pricelist-access";

export function canViewOvertime(u?: AccessUser | null): boolean {
  return canOrLegacy(u, "overtime", false);
}

export function isOvertimeAdmin(u?: (AccessUser & { superuser?: boolean | null }) | null): boolean {
  return (u?.role ?? "").trim().toLowerCase() === "admin" || u?.superuser === true;
}
