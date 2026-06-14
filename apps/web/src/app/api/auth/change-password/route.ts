import { cookies } from "next/headers";

import { gatewayFetch } from "@/lib/gateway";
import { SESSION_COOKIE } from "../login/route";

export const dynamic = "force-dynamic";

// Self change-password — forward cookie JWT sbg Bearer ke apps/api.
export async function POST(req: Request) {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return Response.json({ error: "unauthenticated" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const res = await gatewayFetch("/auth/change-password", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  return Response.json(await res.json(), { status: res.status });
}
