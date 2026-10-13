// Hak akses menu Onboarding Karyawan Baru (F56). Dua sumbu terpisah:
//   • MENU  = matriks Akses Grup fitur 'onboarding' (canViewOnboarding). Fitur BARU tertutup
//     default; gate identitas lama (fitur belum diatur) = admin/superuser/Direktur + HoD.
//   • BARIS = apps/api (audienceOf di repo/onboarding.ts): admin/superuser/Direktur semua,
//     HoD hanya cabang timnya.
// Template checklist hanya untuk admin/superuser/Direktur (canManageOnboardingTemplates) —
// selaras audiens "all" di api, yang tetap menolak yang lain dengan 403.

import { canOrLegacy } from "./perms";
import type { AccessUser } from "./pricelist-access";

type OnboardingUser = AccessUser & { superuser?: boolean | null };

const norm = (s?: string | null): string => (s ?? "").trim().toLowerCase();

export function canManageOnboardingTemplates(u?: OnboardingUser | null): boolean {
  if (!u) return false;
  const r = norm(u.role);
  return r === "admin" || r === "direktur" || u.superuser === true;
}

export function canViewOnboarding(u?: OnboardingUser | null): boolean {
  if (!u) return false;
  return canOrLegacy(u, "onboarding", canManageOnboardingTemplates(u) || u.is_hod === true);
}
