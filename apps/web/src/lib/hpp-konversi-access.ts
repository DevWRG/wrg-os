// Hak akses Konversi satuan HPP (migrasi 309) — tab di Setup Harga.
//
// Isinya HPP (internal, HANDOVER §1/§9: jangan sampai ke sales), jadi fitur BARU dengan kunci
// izin sendiri 'hpp-konversi-satuan' (view = lihat daftar, edit = simpan/hapus konversi).
// Fallback identitas selama grup belum diatur di matriks Akses Grup (admin/superuser selalu
// lolos lewat canOrLegacy):
//   - siapa pun yang boleh mengedit Setup Harga (HoD Business / Purchasing / admin) — HPP-nya
//     memang mereka yang setel;
//   - Finance (grup 'finance-hod' / title finance, pola cn-access.ts) — Finance yang tahu isi
//     kemasan vs satuan faktur dan memakai angkanya (F150 laba kotor area, F67 Margin Reward).
// Gate edit Setup Harga sendiri (harga/diskon/publish) TIDAK ikut dibuka untuk Finance.

import { isFinanceCn } from "@/lib/cn-access";
import { canEditPricelistSetup } from "@/lib/pricelist-access";
import { canOrLegacy, type PermBag } from "@/lib/perms";

export const FITUR_HPP_KONVERSI = { key: "hpp-konversi-satuan", name: "Konversi satuan HPP (tab di Setup Harga)" };

export interface AccessUser extends PermBag {
  title?: string | null;
  hod_key?: string | null;
}

const legacy = (u: AccessUser): boolean => canEditPricelistSetup(u) || isFinanceCn(u);

export function canViewHppKonversi(u?: AccessUser | null): boolean {
  if (!u) return false;
  return canOrLegacy(u, FITUR_HPP_KONVERSI.key, legacy(u));
}

export function canEditHppKonversi(u?: AccessUser | null): boolean {
  if (!u) return false;
  return canOrLegacy(u, FITUR_HPP_KONVERSI.key, legacy(u), "edit");
}
