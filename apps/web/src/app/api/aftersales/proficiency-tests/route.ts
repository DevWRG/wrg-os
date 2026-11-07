import { gatewayFetch, relay } from "@/lib/gateway";
import { requireFeature } from "@/lib/feature-guard";

export const dynamic = "force-dynamic";

// F25 Uji Profisiensi Document Registry — gateway → apps/api /aftersales/proficiency-tests. Role min Karyawan.
export async function GET() {
  const guard = await requireFeature("/proficiency-tests", "view");
  if (!guard.ok) return guard.res;
  const res = await gatewayFetch("/aftersales/proficiency-tests");
  return relay(res);
}

export async function POST(req: Request) {
  const guard = await requireFeature("/proficiency-tests", "create");
  if (!guard.ok) return guard.res;
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const res = await gatewayFetch("/aftersales/proficiency-tests", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return relay(res);
}
