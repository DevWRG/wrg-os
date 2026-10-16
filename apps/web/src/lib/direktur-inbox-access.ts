// Hak akses F59 Direktur Inbox (/direktur-inbox).
//
// Isinya antrean approval bernilai uang (PO, dana operasional, insentif) — bacaan Direktur,
// bukan konsumsi umum. Fallback identitas: role direktur / admin / superuser SAJA (HoD tidak,
// keputusan user 16 Okt 2026). Izin 'direktur-inbox' tetap bisa diatur di matriks Akses Grup:
// begitu Sync Fitur dijalankan dan grup punya baris izinnya, matriks yang menang
// (canOrLegacy) — jadi Direktur perlu dicentang di grupnya setelah Sync Fitur.

import { canOrLegacy } from "@/lib/perms";
import { type AccessUser } from "@/lib/pricelist-access";

export function canViewDirekturInbox(u?: AccessUser | null): boolean {
  if (!u) return false;
  const r = (u.role ?? "").trim().toLowerCase();
  return canOrLegacy(u, "direktur-inbox", r === "direktur" || r === "admin" || u.superuser === true);
}
