// Hak akses F151 CN (Kredit Note) — menu /cn + hak per tahap.
//
// Kunci izin sendiri ('cn'): view = lihat, create = buat kontrak/ajukan CN, edit = geser status.
// Datanya nilai rebate per customer, jadi fitur BARU default TERTUTUP (Sync Fitur + centang di Akses Grup).
//
// Hak per TAHAP ditegakkan di BFF (api tak tahu role), pola F35/F138:
//   ditinjau    : HoD Business yang dipilih pengaju (hod_business_key)
//   disetujui   : HoD Sales yang dipilih pengaju   (hod_sales_key) — approver akhir sisi bisnis
//   divalidasi  : Finance  (grup 'finance-hod' / HoD ber-peran Finance di master_hod / title finance)
//   terealisasi : GA       (grup 'ga' / HoD ber-peran GA di master_hod / title ga) — mengisi bukti transfer
//   ditolak     : pemegang tahap yang sedang berjalan (di tahap divalidasi: GA atau Finance)
//   dibatalkan  : pengaju sendiri, selama belum disetujui
// Admin/superuser boleh stand-in di semua tahap (anti-lockout, pola sama perms.ts can()).
// Tak ada nama orang di kode: daftar HoD per peran = master_hod.peran (diedit lewat UI), dibaca api
// GET /cn/peran lalu diteruskan sebagai `peran`. Tanpa `peran` (mis. nav sinkron) jatuh ke grup/title saja.
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

/** hod_key per peran dari master_hod (api GET /cn/peran). */
export type PeranCn = { finance_hod_keys: string[]; ga_hod_keys: string[] };

const FINANCE_TITLES = ["finance", "hod finance"];
const GA_TITLES = ["ga", "hod ga", "general affairs"];

const norm = (s?: string | null): string => (s ?? "").trim().toLowerCase();
const isAdmin = (u: AccessUser): boolean => u.superuser === true || norm(u.role) === "admin";

const diGrup = (u: AccessUser, key: string): boolean => !!u.groups?.some((g) => g.key === key);
const hodDi = (u: AccessUser, keys?: readonly string[]): boolean => !!u.hod_key && !!keys?.includes(u.hod_key);

export const isFinanceCn = (u: AccessUser, peran?: PeranCn): boolean =>
  diGrup(u, "finance-hod") || hodDi(u, peran?.finance_hod_keys) || FINANCE_TITLES.includes(norm(u.title));
export const isGaCn = (u: AccessUser, peran?: PeranCn): boolean =>
  diGrup(u, "ga") || hodDi(u, peran?.ga_hod_keys) || GA_TITLES.includes(norm(u.title));

export const canViewCn = (u?: AccessUser | null): boolean => canOrLegacy(u, "cn", false);
export const canCreateCn = (u?: AccessUser | null): boolean => canOrLegacy(u, "cn", false, "create");
export const canEditCn = (u?: AccessUser | null): boolean => canOrLegacy(u, "cn", false, "edit");

/** Direktur (+ admin/superuser) mengaktifkan atau membatalkan kontrak CN. */
export const canKelolaKontrakCn = (u?: AccessUser | null): boolean => !!u && (isAdmin(u) || norm(u.role) === "direktur");

/** Pelaku pantas memegang tahap `ke` untuk pengajuan ini? `pelaku` = nama sesi (sama dengan yang dicatat sebagai requested_by). */
export function canGeserCn(me: AccessUser | null | undefined, p: TahapCn, ke: CnStatus, pelaku: string, peran?: PeranCn): boolean {
  if (!me) return false;
  if (isAdmin(me)) return true;
  switch (ke) {
    case "ditinjau": return !!p.hod_business_key && me.hod_key === p.hod_business_key;
    case "disetujui": return me.hod_key === p.hod_sales_key;
    case "divalidasi": return isFinanceCn(me, peran);
    case "terealisasi": return isGaCn(me, peran);
    case "dibatalkan": return !!p.requested_by && p.requested_by === pelaku;
    case "ditolak":
      switch (p.status) {
        case "diajukan": return p.hod_business_key ? me.hod_key === p.hod_business_key : me.hod_key === p.hod_sales_key;
        case "ditinjau": return me.hod_key === p.hod_sales_key;
        case "disetujui": return isFinanceCn(me, peran);
        case "divalidasi": return isGaCn(me, peran) || isFinanceCn(me, peran);
        default: return false;
      }
    default: return false;
  }
}

/** Langkah yang boleh diambil pelaku sekarang (untuk menampilkan tombol; server tetap memeriksa ulang). */
export function langkahCn(me: AccessUser | null | undefined, p: TahapCn, pelaku: string, peran?: PeranCn): CnStatus[] {
  const kandidat: Record<CnStatus, CnStatus[]> = {
    diajukan: p.hod_business_key ? ["ditinjau", "ditolak", "dibatalkan"] : ["disetujui", "ditolak", "dibatalkan"],
    ditinjau: ["disetujui", "ditolak", "dibatalkan"],
    disetujui: ["divalidasi", "ditolak"],
    divalidasi: ["terealisasi", "ditolak"],
    terealisasi: [], ditolak: [], dibatalkan: [],
  };
  return kandidat[p.status].filter((ke) => canGeserCn(me, p, ke, pelaku, peran));
}
