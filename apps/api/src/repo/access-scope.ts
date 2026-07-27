// F127 Sales Analytics — row-level scope (implementasi F122 di level data).
// Auth model: BFF (apps/web) tepercaya via x-service-token; identitas user
// diteruskan sbg header `x-user-id` (= app_user.id). Api resolve scope dari DB.
//
// Tingkatan scope:
//   - admin / superuser        → lihat SEMUA (cabangScope null, amOnly false)
//   - AM (app_user.am_id + master_user.role='AM') → HANYA data sendiri (amOnly + amId)
//   - HoD (app_user.hod_key + hod_territory) → hanya cabang timnya (cabangScope)
//   - selain itu               → lihat semua

import { db } from "../db.js";
import { effectivePermissions } from "./rbac.js";

export interface DataScope {
  userId: string | null;
  amOnly: boolean; // true → batasi ke amId saja
  amId: string | null; // am_id user (bila AM)
  cabang: string | null; // cabang user (dari master_user), utk konteks
  superuser: boolean;
  cabangScope?: string[] | null; // HoD → daftar cabang timnya; null/undefined = tanpa batas cabang
  hodKey?: string | null;
}

// Scope "lihat semua" (default aman bila tak ada user / DB mati).
export const FULL_SCOPE: DataScope = { userId: null, amOnly: false, amId: null, cabang: null, superuser: false, cabangScope: null, hodKey: null };

const isAmRole = (role: unknown): boolean => /^am$/i.test(String(role ?? "").trim());

// Resolusi scope dari app_user.id (header x-user-id). Aman terhadap DB mati /
// user tak ditemukan → FULL_SCOPE (feature-permission tetap menjaga akses menu).
export async function resolveScope(userId: string | null | undefined): Promise<DataScope> {
  const id = (userId ?? "").trim();
  if (!id) return FULL_SCOPE;
  const sql = db();
  const [u] = await sql`SELECT id, am_id, hod_key, role FROM app_user WHERE id = ${id}`;
  if (!u) return { ...FULL_SCOPE, userId: id };

  let superuser = false;
  try {
    superuser = (await effectivePermissions(id)).superuser;
  } catch {
    /* DB/RBAC belum siap → anggap non-superuser */
  }
  const amId = u.am_id ? String(u.am_id) : null;
  const hodKey = u.hod_key ? String(u.hod_key) : null;

  // Admin / superuser → lihat semua.
  if (superuser || /^admin$/i.test(String(u.role ?? ""))) {
    return { userId: id, amOnly: false, amId, cabang: null, superuser: true, hodKey, cabangScope: null };
  }

  // AM sejati → hanya data sendiri.
  if (amId) {
    const [m] = await sql`SELECT role, cabang FROM master_user WHERE am_id = ${amId}`;
    if (m && isAmRole(m.role)) {
      return { userId: id, amOnly: true, amId, cabang: m.cabang ? String(m.cabang) : null, superuser: false, hodKey, cabangScope: null };
    }
  }

  // HoD dgn hod_key + territory ter-map → scope ke cabang timnya.
  if (hodKey) {
    const rows = await sql<{ cabang: string }[]>`SELECT cabang FROM hod_territory WHERE hod_key = ${hodKey}`;
    const cabangScope = rows.map((r) => String(r.cabang)).filter(Boolean);
    if (cabangScope.length) {
      return { userId: id, amOnly: false, amId, cabang: null, superuser: false, hodKey, cabangScope };
    }
  }

  // Selain itu (HoD tanpa territory ter-map, office, dll) → lihat semua.
  return { userId: id, amOnly: false, amId, cabang: null, superuser, hodKey, cabangScope: null };
}

// true bila scope membatasi data (AM self ATAU HoD cabang-tim).
export function isRestricted(s: DataScope): boolean {
  return (s.amOnly && !!s.amId) || !!(s.cabangScope && s.cabangScope.length);
}

// ── Klausa SQL row-level (satu definisi, dipakai lintas repo) ──
//
// Dipakai dengan menempelkan hasilnya ke WHERE query. Dua bentuk karena sumber
// kepemilikan datanya beda:
//   scopeAccurateClause  → data Accurate; query WAJIB sudah join
//                          `accurate_salesman acs` + `master_user mu`.
//   scopeSalesPlanClause → data internal sales_plan; query WAJIB punya alias
//                          `sp` (sales_plan) + `mu` (master_user).
//
// Catatan penting: pada scope terbatas, baris yang TIDAK bisa diatribusikan ke
// AM mana pun (mis. invoice tanpa salesman ter-link) otomatis TIDAK ikut —
// itu disengaja: lebih baik hilang dari daftar AM daripada bocor ke AM yang salah.

type Sql = ReturnType<typeof db>;
type Frag = ReturnType<Sql>;

// Bentuk dasar: caller menunjuk kolom am_id & cabang-nya sendiri (fragment SQL),
// jadi aturannya tetap SATU definisi walau nama alias tabelnya beda per query.
export function scopeOnClause(sql: Sql, s: DataScope, amIdCol: Frag, cabangCol: Frag) {
  if (s.amOnly && s.amId) return sql`AND ${amIdCol} = ${s.amId}`;
  if (s.cabangScope && s.cabangScope.length) {
    return sql`AND ${cabangCol} = ANY(${s.cabangScope}::text[])`;
  }
  return sql``;
}

export function scopeAccurateClause(sql: Sql, s: DataScope) {
  return scopeOnClause(sql, s, sql`mu.am_id`, sql`COALESCE(NULLIF(mu.cabang,''), NULLIF(acs.cabang_override,''))`);
}

export function scopeSalesPlanClause(sql: Sql, s: DataScope) {
  return scopeOnClause(sql, s, sql`sp.am_id`, sql`NULLIF(mu.cabang,'')`);
}

// Customers/Accounts: kepemilikan dari kolom EKSPLISIT crm_account.owner_am_id
// (migrasi 064) — bukan diturunkan dari invoice terakhir, supaya faskes yang
// belum pernah transaksi tetap bisa di-scope. Query WAJIB punya alias `oa`
// (crm_account) + `omu` (master_user pemilik). Akun tak-bertuan (owner NULL)
// tidak muncul pada scope terbatas — admin yang menugaskan pemiliknya.
export function scopeAccountOwnerClause(sql: Sql, s: DataScope) {
  return scopeOnClause(sql, s, sql`oa.owner_am_id`, sql`NULLIF(omu.cabang,'')`);
}
