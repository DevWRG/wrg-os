import { cookies } from "next/headers";

import { gatewayFetch } from "@/lib/gateway";
import { SESSION_COOKIE } from "../login/route";

export const dynamic = "force-dynamic";

// GET /api/auth/me → verifikasi cookie sesi via apps/api, balikan user.
export async function GET() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return Response.json({ error: "unauthenticated" }, { status: 401 });
  try {
    const res = await gatewayFetch("/auth/me", {
      headers: { authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    return Response.json(data, { status: res.status });
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
