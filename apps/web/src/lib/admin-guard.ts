import { cookies } from "next/headers";

import { gatewayFetch } from "./gateway";
import { SESSION_COOKIE } from "@/app/api/auth/login/route";
import type { PermBag } from "@/lib/perms";

export interface SessionUserSrv extends PermBag {
  id: string; email: string; role: string; name?: string; title?: string | null;
  am_id?: string | null; hod_key?: string | null; is_am?: boolean | null; is_hod?: boolean | null;
}

// Session user dari cookie JWT (via apps/api /auth/me). null kalau tak login.
export async function sessionUser(): Promise<SessionUserSrv | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    const res = await gatewayFetch("/auth/me", { headers: { authorization: `Bearer ${token}` } });
    if (!res.ok) return null;
    const d = await res.json();
    return (d?.user ?? d) ?? null;
  } catch {
    return null;
  }
}

// Guard untuk route admin: balikan {ok} atau Response 401/403 siap-return.
// Admin = role 'admin' (lama) ATAU anggota grup superuser (RBAC).
export async function requireAdmin(): Promise<{ ok: true } | { ok: false; res: Response }> {
  const u = await sessionUser();
  if (!u) return { ok: false, res: Response.json({ error: "unauthenticated" }, { status: 401 }) };
  if (u.role !== "admin" && u.superuser !== true) {
    return { ok: false, res: Response.json({ error: "forbidden (admin only)" }, { status: 403 }) };
  }
  return { ok: true };
}

// Guard untuk fitur HoD (mis. List Raport Karyawan): admin/superuser ATAU HoD
// (app_user.hod_key ter-set → is_hod dari /auth/me). Balikan {ok} / Response siap-return.
export async function requireHodOrAdmin(): Promise<{ ok: true; me: SessionUserSrv } | { ok: false; res: Response }> {
  const u = await sessionUser();
  if (!u) return { ok: false, res: Response.json({ error: "unauthenticated" }, { status: 401 }) };
  if (u.role !== "admin" && u.superuser !== true && u.is_hod !== true) {
    return { ok: false, res: Response.json({ error: "forbidden (HoD/admin only)" }, { status: 403 }) };
  }
  return { ok: true, me: u };
}
