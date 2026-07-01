import { cookies } from "next/headers";

import { gatewayFetch } from "./gateway";
import { SESSION_COOKIE } from "@/app/api/auth/login/route";

// Session user dari cookie JWT (via apps/api /auth/me). null kalau tak login.
export async function sessionUser(): Promise<{ id: string; email: string; role: string; name?: string; title?: string | null } | null> {
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
export async function requireAdmin(): Promise<{ ok: true } | { ok: false; res: Response }> {
  const u = await sessionUser();
  if (!u) return { ok: false, res: Response.json({ error: "unauthenticated" }, { status: 401 }) };
  if (u.role !== "admin") return { ok: false, res: Response.json({ error: "forbidden (admin only)" }, { status: 403 }) };
  return { ok: true };
}
