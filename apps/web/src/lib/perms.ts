// Helper izin RBAC sisi web. Sumber: /auth/me (user.permissions + user.superuser
// + user.rbac). Lihat apps/api/src/repo/rbac.ts. Default aman: bila izin TIDAK
// tersedia (auth mati / belum login / DB off), can() = true → UI tak diblok
// (selaras rollout non-breaking; enforcement nyusul saat data izin ada).
//
// PENTING: "tanpa izin" ≠ "izin tak tersedia". User yang login tapi belum
// di-assign grup dapat `permissions: {}` — itu berarti TANPA AKSES, bukan
// alasan fail-open. Pembedanya flag `rbac` dari /auth/me (true = matriks
// terbaca dari DB). Sebelum flag ini ada, user tanpa grup lolos hasPerms()
// dan melihat seluruh sidebar + seluruh rute.

export type Action = "view" | "create" | "edit" | "delete";

export interface EffectivePerm {
  active: boolean; view: boolean; create: boolean; edit: boolean; delete: boolean;
}
export interface PermBag {
  role?: string | null;
  superuser?: boolean | null;
  // true = matriks izin sudah terbaca dari DB (walau hasilnya kosong).
  rbac?: boolean | null;
  hod_key?: string | null; // key HoD (rocky/yogi/...) → gate menu "NPK Saya"
  groups?: { id: number; key: string; name: string }[];
  permissions?: Record<string, EffectivePerm>;
}

export function can(s: PermBag | null | undefined, feature: string, action: Action = "view"): boolean {
  if (!s || !s.permissions) return true; // izin tak tersedia → jangan blokir
  // superuser ATAU role admin lama = all-access (anti-lockout; selaras requireAdmin).
  // Penting: tetap berlaku walau data RBAC (grup/membership) belum lengkap.
  if (s.superuser || s.role === "admin") return true;
  const p = s.permissions[feature];
  if (!p || !p.active) return false;
  return action === "view" ? p.view : action === "create" ? p.create : action === "edit" ? p.edit : p.delete;
}

// Apakah data izin TERSEDIA (bukan "terisi") — penentu gating menu aktif atau
// fail-open. rbac=true sudah cukup: matriks terbaca dari DB, kosong pun berarti
// user itu memang belum diberi akses apa pun. Cek `permissions` non-kosong tetap
// dipertahankan agar web yang lebih baru tetap menggate saat apps/api belum
// di-deploy (belum mengirim flag `rbac`).
export function hasPerms(s: PermBag | null | undefined): boolean {
  if (!s) return false;
  if (s.rbac === true) return true;
  return !!(s.permissions && Object.keys(s.permissions).length > 0);
}

// Gate hibrida untuk fitur yang punya gate identitas legacy (Pricelist, Karyawan
// 360, Executive, …). Aturan: BEGITU grup user punya baris izin untuk fitur ini,
// matriks Akses Grup yang menentukan — dua arah (dicentang = boleh, dilepas =
// tidak). Selama belum diatur, jatuh ke gate identitas lama supaya tak ada yang
// mendadak kehilangan akses. admin/superuser selalu lolos (anti-lockout).
//
// Tanpa ini, item ber-`show` di nav.ts sepenuhnya mengabaikan RBAC → admin
// mencentang fitur di Akses Grup tapi menunya tetap tak muncul.
export function canOrLegacy(
  s: PermBag | null | undefined, feature: string, legacy: boolean, action: Action = "view",
): boolean {
  if (!s || !s.permissions) return legacy; // izin tak tersedia → pakai gate lama
  if (s.superuser || s.role === "admin") return true;
  return s.permissions[feature] ? can(s, feature, action) : legacy;
}
