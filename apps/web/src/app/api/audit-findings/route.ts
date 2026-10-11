import { gatewayFetch, relay } from "@/lib/gateway";
import { sessionUser } from "@/lib/admin-guard";
import { canViewAuditFindings, canCreateAuditFinding } from "@/lib/audit-finding-access";

export const dynamic = "force-dynamic";

// F60 — gateway → apps/api GET/POST /audit-findings. Gate DI SINI (layer WEB,
// pola sama dana-ops route.ts), bukan hanya nav.ts — domain post-fraud, jadi
// dicek juga di jalur API langsung, tidak cukup menyembunyikan menunya saja.
export async function GET(req: Request) {
  const me = await sessionUser();
  if (!me) return Response.json({ error: "unauthenticated" }, { status: 401 });
  if (!canViewAuditFindings(me)) return Response.json({ error: "forbidden" }, { status: 403 });
  const qs = new URL(req.url).search;
  return relay(await gatewayFetch(`/audit-findings${qs}`));
}

export async function POST(req: Request) {
  const me = await sessionUser();
  if (!me) return Response.json({ error: "unauthenticated" }, { status: 401 });
  if (!canCreateAuditFinding(me)) return Response.json({ error: "forbidden" }, { status: 403 });
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  return relay(
    await gatewayFetch("/audit-findings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...body, created_by: me.id }),
    }),
  );
}
