// Hak akses F151 CN (Kredit Note) — menu /cn + hak per tahap.
//
// Kunci izin sendiri ('cn'): view = lihat, create = buat kontrak/ajukan CN, edit = geser status.
// Datanya nilai rebate per customer, jadi fitur BARU default TERTUTUP (Sync Fitur + centang di Akses Grup).
//
// Hak per TAHAP ditegakkan di BFF (api tak tahu role), pola F35/F138:
//   ditinjau    : HoD Business yang dipilih pengaju (hod_business_key)
//   disetujui   : HoD Sales yang dipilih pengaju   (hod_sales_key) — approver akhir sisi bisnis
//   divalidasi  : Finance  (hod_key 'ika' / title finance)
//   terealisasi : GA       (hod_key 'husni' / title ga) — mengisi bukti transfer
//   ditolak     : pemegang tahap yang sedang berjalan (di tahap divalidasi: GA atau Finance)
//   dibatalkan  : pengaju sendiri, selama belum disetujui
// Admin/superuser boleh stand-in di semua tahap (anti-lockout, pola sama perms.ts can()).
// Aktivasi/pembatalan kontrak = Direktur (+ admin/superuser).

import { canOrLegacy, type PermBag } from "@/lib/perms";

export type CnStatus = "diajukan" | "ditinjau" | "disetujui" | "divalidasi" | "terealisasi" | "ditolak" | "dibatalkan";

export interface AccessUser extends PermBag {
  hod_key?: string | null;
  title?: string | null;
  name?: string;
  email?: string;
}

export interface TahapCn {
  status: CnStatus;
  hod_sales_key: string;
  hod_business_key: string | null;
  requested_by: string | null;
}

export const FINANCE_HOD_KEY = "ika";
export const GA_HOD_KEY = "husni";
const FINANCE_TITLES = ["finance", "hod finance"];
const GA_TITLES = ["ga", "hod ga", "general affairs"];

const norm = (s?: string | null): string => (s ?? "").trim().toLowerCase();
const isAdmin = (u: AccessUser): boolean => u.superuser === true || norm(u.role) === "admin";

export const isFinanceCn = (u: AccessUser): boolean => u.hod_key === FINANCE_HOD_KEY || FINANCE_TITLES.includes(norm(u.title));
export const isGaCn = (u: AccessUser): boolean => u.hod_key === GA_HOD_KEY || GA_TITLES.includes(norm(u.title));

export const canViewCn = (u?: AccessUser | null): boolean => canOrLegacy(u, "cn", false);
export const canCreateCn = (u?: AccessUser | null): boolean => canOrLegacy(u, "cn", false, "create");
export const canEditCn = (u?: AccessUser | null): boolean => canOrLegacy(u, "cn", false, "edit");

/** Direktur (+ admin/superuser) mengaktifkan atau membatalkan kontrak CN. */
export const canKelolaKontrakCn = (u?: AccessUser | null): boolean => !!u && (isAdmin(u) || norm(u.role) === "direktur");

/** Pelaku pantas memegang tahap `ke` untuk pengajuan ini? `pelaku` = nama sesi (sama dengan yang dicatat sebagai requested_by). */
export function canGeserCn(me: AccessUser | null | undefined, p: TahapCn, ke: CnStatus, pelaku: string): boolean {
  if (!me) return false;
  if (isAdmin(me)) return true;
  switch (ke) {
    case "ditinjau": return !!p.hod_business_key && me.hod_key === p.hod_business_key;
    case "disetujui": return me.hod_key === p.hod_sales_key;
    case "divalidasi": return isFinanceCn(me);
    case "terealisasi": return isGaCn(me);
    case "dibatalkan": return !!p.requested_by && p.requested_by === pelaku;
    case "ditolak":
      switch (p.status) {
        case "diajukan": return p.hod_business_key ? me.hod_key === p.hod_business_key : me.hod_key === p.hod_sales_key;
        case "ditinjau": return me.hod_key === p.hod_sales_key;
        case "disetujui": return isFinanceCn(me);
        case "divalidasi": return isGaCn(me) || isFinanceCn(me);
        default: return false;
      }
    default: return false;
  }
}

/** Langkah yang boleh diambil pelaku sekarang (untuk menampilkan tombol; server tetap memeriksa ulang). */
export function langkahCn(me: AccessUser | null | undefined, p: TahapCn, pelaku: string): CnStatus[] {
  const kandidat: Record<CnStatus, CnStatus[]> = {
    diajukan: p.hod_business_key ? ["ditinjau", "ditolak", "dibatalkan"] : ["disetujui", "ditolak", "dibatalkan"],
    ditinjau: ["disetujui", "ditolak", "dibatalkan"],
    disetujui: ["divalidasi", "ditolak"],
    divalidasi: ["terealisasi", "ditolak"],
    terealisasi: [], ditolak: [], dibatalkan: [],
  };
  return kandidat[p.status].filter((ke) => canGeserCn(me, p, ke, pelaku));
}
