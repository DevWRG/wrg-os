// Hak akses F154 Jadwal Kunjungan Rutin Teknisi (/jadwal-teknisi).
//
// Fitur 'jadwal-teknisi' di matriks Akses Grup (tertutup default; Sync Fitur). Sebelum
// matriks diatur: admin/superuser, Direktur, dan HoD Aftersales (hod_key 'muhid' —
// master_hod) atau jabatan yang memuat "aftersales". Teknisi TIDAK punya akun dashboard
// (prod 18 Okt) — jadwal sampai ke mereka lewat WA (terbit + #JADWAL).
// Aksi ubah (susun/terbit/edit/wilayah/frekuensi) = izin edit di matriks bila diatur.

import { canOrLegacy } from "@/lib/perms";
import { type AccessUser } from "@/lib/pricelist-access";

export const FITUR = "jadwal-teknisi";
const norm = (s?: string | null): string => (s ?? "").trim().toLowerCase();

const legacy = (u: AccessUser): boolean => {
  const r = norm(u.role);
  return r === "admin" || r === "direktur" || u.superuser === true
    || norm((u as AccessUser & { hod_key?: string | null }).hod_key) === "muhid" || norm(u.title).includes("aftersales");
};

export function canViewJadwalTeknisi(u?: AccessUser | null): boolean {
  return !!u && canOrLegacy(u, FITUR, legacy(u));
}
export function canEditJadwalTeknisi(u?: AccessUser | null): boolean {
  return !!u && canOrLegacy(u, FITUR, legacy(u), "edit");
}
