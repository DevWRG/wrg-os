import { cookies } from "next/headers";

import { SESSION_COOKIE } from "../login/route";

export const dynamic = "force-dynamic";

// POST /api/auth/logout → hapus cookie sesi.
export async function POST() {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
  return Response.json({ ok: true });
}
