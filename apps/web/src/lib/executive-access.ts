// Hak akses Executive Command Center (Director Dashboard, F76) berbasis role.
// Audience utama = Direktur; admin/superuser tetap dapat akses penuh (testing).
// Dipakai sebagai `show` di nav.ts (override RBAC can()) dan guard halaman.

import { type AccessUser } from "@/lib/pricelist-access";

const norm = (s?: string | null): string => (s ?? "").trim().toLowerCase();

export function canViewExecutive(u?: AccessUser | null): boolean {
  const r = norm(u?.role);
  return !!u && (r === "direktur" || r === "admin" || u.superuser === true);
}
