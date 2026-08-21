// Hak akses menu NPK level AM/Sales (F66, migrasi 078). Dipakai sebagai `show`
// di nav.ts — dan karena layout dashboard men-gate rute dari katalog menu yang
// sama (findNavItem + navVisible → redirect), helper ini sekaligus jadi gate
// halamannya. Jangan gate dengan render kondisional: page & layout dirender
// paralel, isi halaman tetap masuk RSC payload walau tak ditampilkan.
//
// Aturan role (keputusan pemilik produk):
//   /npk/am       → Direktur/admin/superuser + SEMUA HoD, isinya seluruh AM.
//                   Sengaja TIDAK dibatasi hod_territory seperti Visits/AR.
//   /npk/am-self  → staff AM/sales, hanya NPK dirinya sendiri.
// Pembatasan baris tetap dikerjakan server (repo/npk-am.ts visibleAms) — helper
// ini cuma soal "menu/halaman ini boleh dibuka atau tidak".
//
// Matriks Akses Grup menang begitu fitur di-set untuk grup si user (canOrLegacy).

import { canOrLegacy } from "@/lib/perms";
import { type AccessUser } from "@/lib/pricelist-access";

const norm = (s?: string | null): string => (s ?? "").trim().toLowerCase();

const isDirekturish = (u: AccessUser): boolean =>
  norm(u.role) === "admin" || norm(u.role) === "direktur" || u.superuser === true;

const isHod = (u: AccessUser): boolean => !!u.hod_key || u.is_hod === true;

// Punya identitas AM: am_id ter-set (dari /auth/me) atau flag is_am.
const isAm = (u: AccessUser): boolean => !!u.am_id || u.is_am === true;

// Matrix semua AM — Direktur + HoD.
export function canViewNpkAm(u?: AccessUser | null): boolean {
  return canOrLegacy(u, "npk-am", !!u && (isDirekturish(u) || isHod(u)));
}

// NPK diri sendiri untuk staff AM/sales. Direktur & HoD tidak diberi menu ini
// lewat gate identitas (HoD punya "NPK Saya" sendiri di /npk/self, Direktur
// lihat matrix) — tapi matriks Akses Grup tetap bisa membukanya bila perlu.
export function canViewNpkAmSelf(u?: AccessUser | null): boolean {
  return canOrLegacy(u, "npk-am-self", !!u && isAm(u));
}
