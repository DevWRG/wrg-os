// Hak akses halaman Lembur (/overtime) — rekap pengajuan #OVERTIME untuk HR
// + tombol putus untuk HoD. Dua sumbu terpisah (pola resolveScope):
//   • MENU  = matriks Akses Grup fitur 'overtime' (canViewOvertime);
//   • BARIS = overtimeScope(): HoD hanya melihat pengajuan divisinya, HR /
//     admin / direktur melihat semua.
//
// Fitur BARU default TERTUTUP (Sync Fitur menyemai deny untuk semua grup), jadi
// fallback identitasnya hanya HoD (supaya HoD yang DM-nya gagal tetap punya
// jalan memutus begitu fitur belum diatur). Kelola aturan siapa boleh
// mengajukan = admin/superuser saja (isOvertimeAdmin), bukan sekadar pemegang fitur.

import { can, canOrLegacy } from "@/lib/perms";
import { type AccessUser } from "@/lib/pricelist-access";

type OvertimeUser = AccessUser & { superuser?: boolean | null; hod_key?: string | null };

export function canViewOvertime(u?: OvertimeUser | null): boolean {
  return canOrLegacy(u, "overtime", u?.is_hod === true);
}

export function isOvertimeAdmin(u?: OvertimeUser | null): boolean {
  return (u?.role ?? "").trim().toLowerCase() === "admin" || u?.superuser === true;
}

// Baris mana yang boleh dilihat. null = tak boleh membuka sama sekali.
// HoD yang juga diberi 'overtime' + edit (mis. HoD HR yang merekap) = semua.
export type OvertimeScope = { all: true } | { all: false; hodKey: string } | null;

export function overtimeScope(u?: OvertimeUser | null): OvertimeScope {
  if (!u || !canViewOvertime(u)) return null;
  const role = (u.role ?? "").trim().toLowerCase();
  if (role === "admin" || role === "direktur" || u.superuser === true) return { all: true };
  if (u.is_hod !== true) return { all: true }; // staf HR pemegang fitur
  if (can(u, "overtime", "edit")) return { all: true };
  const key = (u.hod_key ?? "").trim();
  return key ? { all: false, hodKey: key } : null;
}
