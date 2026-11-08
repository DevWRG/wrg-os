// Hak akses F10 Register Cek (/register-cek) — ambil alih F29.
//
// Kunci izin sendiri ('register-cek'): lihat = daftar & saldo; TAMBAH = input, ajukan, serahkan, cair,
// tolak bank, batal (kasir); UBAH = setujui / tolak (HoD Finance). Pembuat cek tak bisa menyetujui
// ceknya sendiri (dicek di API). Fitur BARU default TERTUTUP — Sync Fitur menyemai baris deny untuk
// semua grup, jadi fallback identitasnya `false` (admin/superuser tetap lolos lewat canOrLegacy).

import { canOrLegacy } from "@/lib/perms";
import type { AccessUser } from "@/lib/pricelist-access";

export const FITUR = "register-cek";

/** Aksi status yang butuh izin UBAH (penyetuju). Sama dengan AKSI_PENYETUJU di apps/api/src/repo/cek-keluar.ts. */
export const AKSI_PENYETUJU = ["setujui", "tolak"] as const;
export const AKSI_CEK = ["ajukan", "setujui", "tolak", "serahkan", "cair", "tolak_bank", "batal"] as const;
export type AksiCek = (typeof AKSI_CEK)[number];

export const izinAksi = (aksi: string): "create" | "edit" | null =>
  !(AKSI_CEK as readonly string[]).includes(aksi) ? null : (AKSI_PENYETUJU as readonly string[]).includes(aksi) ? "edit" : "create";

export function canViewRegisterCek(u?: AccessUser | null): boolean {
  if (!u) return false;
  return canOrLegacy(u, FITUR, false);
}
