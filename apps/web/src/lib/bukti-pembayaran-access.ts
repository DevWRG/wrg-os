// Hak akses F32 Bukti Pembayaran (/bukti-pembayaran).
//
// Isinya foto bukti bayar + kode pengajuan — data keuangan, jadi fitur BARU: kunci izin
// 'bukti-pembayaran' (view = lihat & unduh, create = unggah), tertutup untuk semua
// kecuali yang tercantum di fallback sampai Sync Fitur + centang di Akses Grup.
//
// Fallback identitas (dipakai selama grup belum diatur di matriks; admin/superuser
// selalu lolos lewat canOrLegacy):
//   LIHAT  : Direktur + Finance
//   UNGGAH : Finance saja (admin/superuser lewat anti-lockout) — Direktur hanya membaca
// Finance = hod_key 'ika' / title finance (pola cn-access.ts).
// Tak ada aksi ubah/hapus: bukti append-only (lihat migrasi 238).

import { isFinanceCn } from "@/lib/cn-access";
import { canOrLegacy, type PermBag } from "@/lib/perms";

export const FITUR = "bukti-pembayaran";

export interface AccessUser extends PermBag {
  hod_key?: string | null;
  title?: string | null;
}

const peran = (u: AccessUser): string => (u.role ?? "").trim().toLowerCase();
const isDirektur = (u: AccessUser): boolean => peran(u) === "direktur";
// admin/superuser ikut di fallback: bila bag izin tak tersedia, canOrLegacy jatuh ke fallback
// dan tak sempat memberi jalan anti-lockout-nya (pola kas-station-access).
const isAdmin = (u: AccessUser): boolean => u.superuser === true || peran(u) === "admin";

export function canViewBuktiPembayaran(u?: AccessUser | null): boolean {
  if (!u) return false;
  return canOrLegacy(u, FITUR, isAdmin(u) || isDirektur(u) || isFinanceCn(u));
}

export function canUnggahBuktiPembayaran(u?: AccessUser | null): boolean {
  if (!u) return false;
  return canOrLegacy(u, FITUR, isAdmin(u) || isFinanceCn(u), "create");
}
