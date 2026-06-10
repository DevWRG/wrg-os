import { cookies } from "next/headers";

import { gatewayFetch } from "@/lib/gateway";

export const dynamic = "force-dynamic";

export const SESSION_COOKIE = "wrg_session";

// POST /api/auth/login → verifikasi via apps/api, set cookie httpOnly berisi JWT.
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  let res: Response;
  try {
    res = await gatewayFetch("/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
  const data = await res.json();
  if (!res.ok || !data.token) {
    return Response.json({ error: data.error ?? "login gagal" }, { status: res.status || 401 });
  }
  const jar = await cookies();
  jar.set(SESSION_COOKIE, data.token as string, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24, // 24 jam
  });
  return Response.json({ user: data.user });
}
