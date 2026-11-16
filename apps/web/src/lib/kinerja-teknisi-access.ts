// Hak akses menu Kinerja Teknisi (/kinerja-teknisi, grup Aftersales) — keputusan user 16 Nov 2026.
//
//   - `kinerja-teknisi`        → buka menu. Teknisi yang dicentang hanya melihat DIRINYA SENDIRI.
//   - `kinerja-teknisi-semua`  → lihat semua teknisi (HoD Aftersales lewat Akses Grup).
// Fallback (sebelum Sync Fitur): direktur / admin / superuser.
// Cakupan teknisi DITEGAKKAN di apps/api (repo/kinerja-teknisi.ts) dari x-user-id; di sini hanya
// menu + tampilan pilihan teknisi.
import { canOrLegacy } from "@/lib/perms";
import { type AccessUser } from "@/lib/pricelist-access";

export const FITUR_KINERJA = "kinerja-teknisi";
export const FITUR_KINERJA_SEMUA = "kinerja-teknisi-semua";

const norm = (s?: string | null): string => (s ?? "").trim().toLowerCase();
const fallback = (u: AccessUser): boolean => {
  const r = norm(u.role);
  return r === "direktur" || r === "admin" || u.superuser === true;
};

export function canViewKinerjaTeknisi(u?: AccessUser | null): boolean {
  if (!u) return false;
  return canOrLegacy(u, FITUR_KINERJA, fallback(u));
}

export function canViewKinerjaSemua(u?: AccessUser | null): boolean {
  if (!u) return false;
  return canOrLegacy(u, FITUR_KINERJA_SEMUA, fallback(u));
}
