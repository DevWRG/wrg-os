// Hak akses menu Riwayat Alat (/riwayat-alat, grup Aftersales) — F176, keputusan user 17 Nov 2026.
// Satu kunci `riwayat-alat`: pemegangnya (teknisi, HoD Aftersales, …) melihat SEMUA alat — alat berpindah
// faskes & wilayah, teknisi berikutnya butuh riwayat lengkapnya. Riwayat tak memuat angka keuangan.
// Fallback (sebelum Sync Fitur): direktur / admin / superuser.
import { canOrLegacy } from "@/lib/perms";
import { type AccessUser } from "@/lib/pricelist-access";

export const FITUR_RIWAYAT_ALAT = "riwayat-alat";

export function canViewRiwayatAlat(u?: AccessUser | null): boolean {
  if (!u) return false;
  const r = (u.role ?? "").trim().toLowerCase();
  return canOrLegacy(u, FITUR_RIWAYAT_ALAT, r === "direktur" || r === "admin" || u.superuser === true);
}
