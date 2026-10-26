// Hak akses F155 Bon Sparepart Teknisi (/bon-sparepart).
//
// Fitur 'bon-sparepart' di matriks Akses Grup (tertutup default; Sync Fitur). Sebelum matriks
// diatur: admin/superuser, Direktur, HoD Aftersales (hod_key 'muhid') atau jabatan yang memuat
// "aftersales"/"gudang" (Admin Gudang). Aksi tulis (buat bon, batal, tautkan SJ, rekonsiliasi)
// = izin edit di matriks bila diatur. Teknisi melapor lewat WA (#BON) — tak punya akun dashboard.

import { canOrLegacy } from "@/lib/perms";
import { type AccessUser } from "@/lib/pricelist-access";

export const FITUR = "bon-sparepart";
const norm = (s?: string | null): string => (s ?? "").trim().toLowerCase();

const legacy = (u: AccessUser): boolean => {
  const r = norm(u.role);
  const t = norm(u.title);
  return r === "admin" || r === "direktur" || u.superuser === true
    || norm((u as AccessUser & { hod_key?: string | null }).hod_key) === "muhid" || t.includes("aftersales") || t.includes("gudang");
};

export function canViewBonSparepart(u?: AccessUser | null): boolean {
  return !!u && canOrLegacy(u, FITUR, legacy(u));
}
export function canEditBonSparepart(u?: AccessUser | null): boolean {
  return !!u && canOrLegacy(u, FITUR, legacy(u), "edit");
}
