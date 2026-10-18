// Hak akses F31 Tukar Faktur Tracker + Klinik Calendar (/tukar-faktur).
//
// Isinya daftar faktur & jatuh tempo customer — bacaan Finance/AR. Fallback identitas
// (selama grup belum punya baris izinnya): role direktur / admin / superuser SAJA.
// Begitu Sync Fitur dijalankan, matriks Akses Grup yang menang (canOrLegacy) — jadi
// Finance/AR dicentang di grupnya setelah Sync Fitur.

import { canOrLegacy } from "@/lib/perms";
import { type AccessUser } from "@/lib/pricelist-access";

export function canViewTukarFaktur(u?: AccessUser | null): boolean {
  if (!u) return false;
  const r = (u.role ?? "").trim().toLowerCase();
  return canOrLegacy(u, "tukar-faktur", r === "direktur" || r === "admin" || u.superuser === true);
}
