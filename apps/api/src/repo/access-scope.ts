// F127 Sales Analytics — row-level scope (implementasi nyata F122 di level data).
// Auth model: BFF (apps/web) tepercaya via x-service-token; identitas user
// diteruskan sbg header `x-user-id` (= app_user.id). Api resolve scope dari DB.
//
// MVP scope: AM (punya app_user.am_id + master_user.role='AM') → HANYA data
// dirinya (filter am_id). Selain itu (admin/HoD/office/superuser, atau tanpa
// x-user-id) → semua. Team-level HoD scoping menyusul (butuh mapping login→hod_key).

import { db } from "../db.js";
import { effectivePermissions } from "./rbac.js";

export interface DataScope {
  userId: string | null;
  amOnly: boolean; // true → batasi ke amId saja
  amId: string | null; // am_id user (bila AM)
  cabang: string | null; // cabang user (dari master_user), utk konteks
  superuser: boolean;
}

// Scope "lihat semua" (default aman bila tak ada user / DB mati).
export const FULL_SCOPE: DataScope = { userId: null, amOnly: false, amId: null, cabang: null, superuser: false };

const isAmRole = (role: unknown): boolean => /^am$/i.test(String(role ?? "").trim());

// Resolusi scope dari app_user.id (header x-user-id). Aman terhadap DB mati /
// user tak ditemukan → FULL_SCOPE (feature-permission tetap menjaga akses menu).
export async function resolveScope(userId: string | null | undefined): Promise<DataScope> {
  const id = (userId ?? "").trim();
  if (!id) return FULL_SCOPE;
  const sql = db();
  const [u] = await sql`SELECT id, am_id, role FROM app_user WHERE id = ${id}`;
  if (!u) return { ...FULL_SCOPE, userId: id };

  let superuser = false;
  try {
    superuser = (await effectivePermissions(id)).superuser;
  } catch {
    /* DB/RBAC belum siap → anggap non-superuser */
  }
  const amId = u.am_id ? String(u.am_id) : null;

  // Bukan AM (tak ada am_id) atau superuser/admin → lihat semua.
  if (superuser || !amId || /^admin$/i.test(String(u.role ?? ""))) {
    return { userId: id, amOnly: false, amId, cabang: null, superuser };
  }

  // Verifikasi peran roster: hanya AM sejati yang dibatasi self-view.
  const [m] = await sql`SELECT role, cabang FROM master_user WHERE am_id = ${amId}`;
  const amOnly = !!m && isAmRole(m.role);
  return {
    userId: id,
    amOnly,
    amId,
    cabang: m?.cabang ? String(m.cabang) : null,
    superuser,
  };
}
