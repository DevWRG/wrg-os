// Helper izin RBAC sisi web. Sumber: /auth/me (user.permissions + user.superuser).
// Lihat apps/api/src/repo/rbac.ts. Default aman: bila izin TIDAK tersedia
// (auth mati / belum login / DB off), can() = true → UI tak diblok (selaras
// rollout non-breaking; enforcement sebenarnya nyusul saat data izin ada).

export type Action = "view" | "create" | "edit" | "delete";

export interface EffectivePerm {
  active: boolean; view: boolean; create: boolean; edit: boolean; delete: boolean;
}
export interface PermBag {
  role?: string;
  superuser?: boolean;
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

// Apakah bag izin benar-benar terisi (untuk memutuskan apakah gating menu aktif).
export function hasPerms(s: PermBag | null | undefined): boolean {
  return !!(s && s.permissions && Object.keys(s.permissions).length > 0);
}
